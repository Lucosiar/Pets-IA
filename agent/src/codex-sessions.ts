/**
 * Recent Codex sessions, from its rollout files: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl.
 * Undocumented but stable for a long time; if it changes, the + list simply shows no Codex sessions.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionOrigin } from "../../shared/protocol.ts";
import { CODEX_SESSIONS_DIR } from "./config.ts";
import { codexOrigin, firstPrompt, parseCodexMeta } from "./origin.ts";
import { isSessionId } from "./protocol-guard.ts";

export interface CodexSession {
  sessionId: string;
  title: string | null;
  cwd: string;
  origin: SessionOrigin;
  lastActivityAt: number;
  path: string;
}

const DAYS_BACK = 21;
const HEAD_BYTES = 256 * 1024;

async function dirsNewestFirst(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => /^\d+$/.test(n)).sort((a, b) => Number(b) - Number(a));
}

/** Codex sessions from the last few weeks, most recently active first. */
export async function listCodexSessions(dir = CODEX_SESSIONS_DIR, limit = 60, now = Date.now()): Promise<CodexSession[]> {
  const files: { path: string; mtime: number }[] = [];
  const oldest = now - DAYS_BACK * 24 * 60 * 60 * 1000;

  outer: for (const year of await dirsNewestFirst(dir)) {
    for (const month of await dirsNewestFirst(join(dir, year))) {
      for (const day of await dirsNewestFirst(join(dir, year, month))) {
        const dayStart = Date.UTC(Number(year), Number(month) - 1, Number(day));
        if (dayStart + 24 * 60 * 60 * 1000 < oldest) break outer;
        const folder = join(dir, year, month, day);
        for (const name of await readdir(folder).catch(() => [] as string[])) {
          if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
          const path = join(folder, name);
          const info = await stat(path).catch(() => null);
          if (info) files.push({ path, mtime: info.mtimeMs });
        }
      }
    }
  }

  files.sort((a, b) => b.mtime - a.mtime);
  const sessions: CodexSession[] = [];
  for (const { path, mtime } of files.slice(0, limit)) {
    const head = await Bun.file(path).slice(0, HEAD_BYTES).text().catch(() => "");
    const meta = parseCodexMeta(head);
    if (!meta || !isSessionId(meta.id)) continue;
    sessions.push({ sessionId: meta.id, title: firstPrompt(head), cwd: meta.cwd, origin: codexOrigin(meta), lastActivityAt: mtime, path });
  }
  return sessions;
}
