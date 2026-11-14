/**
 * Best-effort persistence for the small facts the plugin must remember across restarts.
 *
 * Everything here is non-authoritative: a missing, unreadable or stale file degrades to the
 * plugin's defaults, never to a failed call.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { debug } from "../debug.ts";

/** `DSH_CURSOR_STATE_DIR`, else the host's DSH home, else `~/.dsh`. */
export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.DSH_CURSOR_STATE_DIR?.trim();
  if (explicit) return explicit;
  return join(env.HOME?.trim() || homedir(), ".dsh");
}

export function pluginStateDir(base: string): string {
  return join(base, "cursor-to-dsh");
}

export function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function writeJsonFile(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = path + "." + process.pid + ".tmp";
    writeFileSync(temporary, JSON.stringify(value));
    renameSync(temporary, path);
  } catch (err) {
    debug("could not persist " + path + ": " + (err instanceof Error ? err.message : String(err)));
  }
}

/** Read a gzip-compressed JSON document; anything unreadable reads as absent. */
export function readGzipJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Replace a gzip-compressed JSON document atomically; a write failure never affects a call. */
export function writeGzipJsonFile(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = path + "." + process.pid + ".tmp";
    writeFileSync(temporary, gzipSync(Buffer.from(JSON.stringify(value), "utf8")));
    renameSync(temporary, path);
  } catch (err) {
    debug("could not persist " + path + ": " + (err instanceof Error ? err.message : String(err)));
  }
}

/** A JSON object keyed by model id, used for the accepted context tier. */
export interface TierFile {
  version: 1;
  tiers: Record<string, string>;
}
