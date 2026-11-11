import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { listCodexSessions } from "./codex-sessions.ts";

test("lists recent rollouts, newest first, with title and origin", async () => {
  const root = mkdtempSync(`${tmpdir()}/petsia-codex-`);
  try {
    const write = (day: string, id: string, originator: string, prompt: string | null, mtime: number) => {
      const dir = `${root}/2026/11/${day}`;
      mkdirSync(dir, { recursive: true });
      const lines = [JSON.stringify({ type: "session_meta", payload: { id, cwd: "/w/app", originator, source: "cli", timestamp: "2026-11-10T10:00:00Z" } })];
      if (prompt) lines.push(JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: prompt } }));
      const path = `${dir}/rollout-2026-11-${day}T10-00-00-${id}.jsonl`;
      writeFileSync(path, lines.join("\n") + "\n");
      utimesSync(path, mtime / 1000, mtime / 1000);
    };
    const now = Date.UTC(2026, 10, 11, 12);
    write("10", "019dabc6-8fef-7681-a054-b5bb75fcb97d", "codex_vscode", "add tests", now - 5000);
    write("11", "019dabc6-8fef-7681-a054-b5bb75fcb97e", "Codex Desktop", null, now - 1000);
    writeFileSync(`${root}/2026/11/11/notes.txt`, "ignored");

    const sessions = await listCodexSessions(root, 10, now);
    expect(sessions.map((s) => [s.sessionId.slice(-1), s.origin, s.title])).toEqual([
      ["e", "app", null],
      ["d", "vscode", "add tests"],
    ]);
    expect(await listCodexSessions(`${root}/missing`)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
