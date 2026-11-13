/**
 * A durable trace of provider runs the plugin gave up on.
 *
 * The host sees only the terminal error; this file records what the run was doing, so a stall can
 * be diagnosed without reproducing it. Best effort: a write failure never affects the call.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { debug } from "./debug.ts";

export interface StallRecord {
  key: string;
  model: string;
  elapsedMs: number;
  lastEvent: string;
}

export function createStallDiagnostics(dir: string): (record: StallRecord) => void {
  const path = join(dir, "stall.log");
  let ready = false;
  return (record: StallRecord) => {
    debug(`stall key=${record.key.slice(0, 12)} model=${record.model} elapsed=${record.elapsedMs}ms last=${record.lastEvent}`);
    try {
      if (!ready) {
        mkdirSync(dir, { recursive: true });
        ready = true;
      }
      appendFileSync(path, `${new Date().toISOString()} ${JSON.stringify(record)}\n`);
    } catch {
      /* diagnostics are best effort */
    }
  };
}
