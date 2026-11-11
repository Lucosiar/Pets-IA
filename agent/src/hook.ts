/**
 * `petsia hook <claude|codex>`: what the tools' hooks run. Reads the event from stdin, adds what
 * only this process can see (which tool sent it and, for Claude, its entrypoint), and posts it to the
 * agent. Never prints and always exits 0, so a stopped agent never shows up as a hook error.
 */
import type { SessionSource } from "../../shared/protocol.ts";
import { HOOK_PORT } from "./config.ts";

export async function forwardHook(source: SessionSource, input: string = "", port = HOOK_PORT) {
  try {
    if (!input) input = await Bun.stdin.text();
    const event = JSON.parse(input);
    if (typeof event !== "object" || event === null) return;
    event._source = source;
    // Claude Code sets this in every process it starts: cli, claude-vscode, claude-desktop…
    if (process.env.CLAUDE_CODE_ENTRYPOINT) event._entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT;
    await fetch(`http://127.0.0.1:${port}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // Agent down, or not JSON: nothing to report.
  }
}
