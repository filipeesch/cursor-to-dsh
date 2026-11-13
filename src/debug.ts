/**
 * Opt-in diagnostics for the plugin: everything here is silent unless the operator asks for it.
 */
export function debug(line: string): void {
  if (process.env.DSH_CURSOR_DEBUG) process.stderr.write(`[cursor-to-dsh] ${line}\n`);
}
