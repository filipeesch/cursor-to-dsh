/**
 * Live check against real Cursor, without the host: drives CursorAdapter.stream() the way the
 * host agent loop does (assemble the reply, run the tool, call again with the result).
 *
 * It prints, per call, the provider's frames with their arrival time, the assembled reply and the
 * usage report when one arrived; with the recorder wired, each step's timing record is printed
 * too. That is the measurement the handoff window and the usage attribution are based on.
 *
 *   CURSOR_API_KEY=... node --experimental-strip-types scripts/live.ts [model]
 */
import { deflateSync } from "node:zlib";

import { CursorAdapter } from "../src/adapter.ts";
import { resolveSettings } from "../src/config.ts";
import { ModelCatalog } from "../src/cursor/catalog.ts";
import { ContextTierStore } from "../src/cursor/context-tier.ts";
import { HandoffWindow } from "../src/session/handoff-window.ts";
import { SessionRegistry } from "../src/session/registry.ts";
import { createCursorAgent, listCursorModels } from "../src/sdk.ts";

const model = process.argv[2] ?? "claude-haiku-5-5";
const key = process.env.CURSOR_API_KEY?.trim();
if (!key) {
  console.error("FAIL: CURSOR_API_KEY is not set");
  process.exit(1);
}

const settings = resolveSettings(undefined);
const timeline: string[] = [];
let callStarted = 0;
let seq = 0;

function stamp(line: string): void {
  timeline.push(`${String(Date.now() - callStarted).padStart(6)}ms ${line}`);
}

function solidPng(size: number, [r, g, b]: number[]): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(4 + body.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 4 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.from([0, ...Array.from({ length: size }, () => [r, g, b]).flat()]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
  return png.toString("base64");
}

let sends = 0;
const createAgent = async (options: any) => {
  const agent = await createCursorAgent(options);
  const send = agent.send.bind(agent);
  agent.send = async (...args: any[]) => {
    sends++;
    const run = await send(...args);
    const stream = run.stream.bind(run);
    run.stream = async function* () {
      for await (const message of stream()) {
        stamp(String(message?.type ?? "?"));
        yield message;
      }
    };
    return run;
  };
  return agent;
};

const catalog = new ModelCatalog({ listModels: listCursorModels, resolveApiKey: async () => key });
const registry = new SessionRegistry();
const adapter = new CursorAdapter({
  createAgent,
  resolveApiKey: async () => key,
  cwdFor: () => process.cwd(),
  readImage: async (ref: any) => (ref.attachmentId === "red" ? { data: solidPng(32, [220, 20, 20]), mimeType: "image/png" } : undefined),
  catalog,
  tiers: new ContextTierStore(),
  registry,
  handoff: new HandoffWindow(),
  // The live check always records, so one run shows the timings the plugin would write.
  timing: { enabled: () => true, write: (record) => console.log("  timing " + JSON.stringify(record)) },
  readPolicy: settings.readPolicy,
  publishedWindow: () => undefined,
  stallTimeoutMs: settings.stallTimeoutMs,
  onStall: (_session: any, info: any) => console.log(`  STALL after ${info.elapsedMs}ms (last frame ${info.lastEvent})`),
});

const text = (value: string) => [{ type: "text", text: value }];
const msg = (role: string, value: string, extra: any = {}) => ({ id: `m${++seq}`, role, content: text(value), ...extra });
const secretTool = {
  name: "get_secret",
  description: "Returns the secret number. Always call it when asked for the secret.",
  parameters: { type: "object", properties: { label: { type: "string" } }, required: ["label"] },
};

async function call(messages: any[], tools: any[], options: { sessionId?: string; reasoningEffort?: string } = {}) {
  timeline.length = 0;
  callStarted = Date.now();
  const chunks: any[] = [];
  for await (const chunk of adapter.stream({
    provider: "cursor",
    model,
    messages,
    tools,
    sessionId: options.sessionId ?? "live-1",
    reasoningEffort: options.reasoningEffort,
  })) chunks.push(chunk);
  const elapsed = Date.now() - callStarted;
  const blocks = chunks.filter((chunk) => chunk.type === "block-end").map((chunk) => chunk.block);
  const finish = chunks.at(-1)?.reason;
  const usage = chunks.find((chunk) => chunk.type === "usage")?.usage;
  console.log(`  finish=${JSON.stringify(finish)} usage=${usage ? JSON.stringify(usage) : "none"} total=${elapsed}ms`);
  for (const line of timeline.slice(0, 40)) console.log("    " + line);
  if (timeline.length > 40) console.log(`    ... ${timeline.length - 40} more frames`);
  for (const block of blocks) console.log(`  ${block.type}: ${String(block.text ?? `${block.name}(${block.arguments}) id=${block.id}`).slice(0, 160)}`);
  return { blocks, finish, usage, assistant: { id: `m${++seq}`, role: "assistant", content: blocks } };
}

const fail = (why: string) => {
  console.error(`FAIL: ${why}`);
  registry.closeAll();
  process.exit(1);
};

await catalog.refresh();
const info = await adapter.resolveModel("cursor", model);
console.log(`model ${model}: context=${info.context?.contextWindow} efforts=${info.reasoning?.efforts.map((effort: any) => effort.id).join(",") ?? "-"}`);
console.log(`handoff base=${new HandoffWindow().windowFor(model)}ms stall=${settings.stallTimeoutMs}ms`);
console.log("timing records below show the plugin's own view of each step");

const system = msg("system", "You are a terse assistant.");
console.log("1) plain call");
const u1 = msg("user", "Reply with exactly: ok");
const r1 = await call([system, u1], [secretTool]);
if (r1.finish?.kind !== "stop") fail("plain call did not stop");

console.log("2) tool call handoff and continuation");
const u2 = msg("user", "What is the secret? Use get_secret with label 'demo', then answer with just the number.");
const history = [system, u1, r1.assistant, u2];
const r2 = await call(history, [secretTool]);
const toolCall = r2.blocks.find((block: any) => block.type === "tool-call");
if (r2.finish?.kind !== "tool-calls" || !toolCall) fail("expected a get_secret call");
const result = { id: `m${++seq}`, role: "tool", toolCallId: toolCall.id, isError: false, content: text("4217") };
const sendsBeforeResult = sends;
const r3 = await call([...history, r2.assistant, result], [secretTool]);
const answer = r3.blocks.filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
if (r3.finish?.kind !== "stop" || !answer.includes("4217")) fail(`expected the answer 4217, got ${JSON.stringify(answer)}`);
if (sends !== sendsBeforeResult) fail("the tool result started a new send instead of continuing the run");

console.log("3) tool added mid-session");
const u4 = msg("user", "Say hi.");
const r4 = await call([system, u4], [], { sessionId: "live-2" });
const u5 = msg("user", "Now get the secret with get_secret (label 'demo') and answer with just the number.");
const r5 = await call([system, u4, r4.assistant, u5], [secretTool], { sessionId: "live-2" });
if (r5.finish?.kind !== "tool-calls" || !r5.blocks.some((block: any) => block.type === "tool-call" && block.name === "get_secret")) fail("the added tool was not used");

console.log("4) image attachment");
const u6 = {
  id: `m${++seq}`,
  role: "user",
  content: [
    { type: "text", text: "What single colour fills this image? Answer with one lowercase word." },
    { type: "image", attachment: { attachmentId: "red", mediaType: "image/png", bytes: 0, width: 32, height: 32 } },
  ],
};
const r6 = await call([system, u6], [], { sessionId: "live-3" });
const colour = r6.blocks.filter((block: any) => block.type === "text").map((block: any) => block.text).join("").toLowerCase();
if (!colour.includes("red")) fail(`expected red, got ${JSON.stringify(colour)}`);

console.log("5) usage coverage");
const calls = [r1, r2, r3, r4, r5, r6];
console.log(`  calls=${calls.length} withUsage=${calls.filter((r) => r.usage !== undefined).length} sessions=${registry.count()}`);
console.log("PASS");
registry.closeAll();
