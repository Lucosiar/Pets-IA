/**
 * Works out where a session runs (Claude desktop app, VS Code, Codex app or a terminal), which
 * decides how a click opens it. Every source here is best effort: when one is missing or its
 * format changes, the session reads as "terminal".
 */
import { join } from "node:path";
import type { SessionOrigin } from "../../shared/protocol.ts";
import { CLAUDE_LIVE_DIR } from "./config.ts";

/** Claude Code's CLAUDE_CODE_ENTRYPOINT: "cli", "claude-vscode", "claude-desktop", "sdk-ts"… */
export function originFromEntrypoint(entrypoint: unknown): SessionOrigin | undefined {
  if (typeof entrypoint !== "string" || !entrypoint) return undefined;
  if (/vscode|cursor|windsurf|jetbrains|ide/i.test(entrypoint)) return "vscode";
  if (/desktop/i.test(entrypoint)) return "desktop";
  return "terminal";
}

/** The entrypoint a running Claude Code process recorded in ~/.claude/sessions/<pid>.json. */
export async function claudeOriginForPid(pid: number, dir = CLAUDE_LIVE_DIR): Promise<SessionOrigin | undefined> {
  const info: { entrypoint?: unknown } | null = await Bun.file(join(dir, `${pid}.json`))
    .json()
    .catch(() => null);
  return originFromEntrypoint(info?.entrypoint);
}

export interface CodexMeta {
  id: string;
  cwd: string;
  originator: string;
  source: string;
  /** Epoch ms the session started. */
  startedAt: number;
}

/**
 * Codex's `originator` ("codex_cli_rs", "codex-tui", "codex_vscode", "Codex Desktop"…) and
 * `source` ("cli", "vscode", "exec"…) from the first line of its rollout file.
 */
export function codexOrigin(meta: Pick<CodexMeta, "originator" | "source">): SessionOrigin {
  if (/desktop|codex[ _-]?app/i.test(meta.originator)) return "app";
  if (/vscode|cursor|windsurf|ide/i.test(meta.originator) || /vscode|ide/i.test(meta.source)) return "vscode";
  return "terminal";
}

/** Rollout files can be huge, and their first line holds long instructions: read only the head. */
const HEAD_BYTES = 512 * 1024;

export async function readCodexMeta(transcriptPath: string): Promise<CodexMeta | null> {
  try {
    const head = await Bun.file(transcriptPath).slice(0, HEAD_BYTES).text();
    return parseCodexMeta(head);
  } catch {
    return null;
  }
}

export function parseCodexMeta(head: string): CodexMeta | null {
  const firstLine = head.split("\n", 1)[0] ?? "";
  try {
    const line = JSON.parse(firstLine);
    const p = line?.type === "session_meta" ? line.payload : null;
    if (p && typeof p.id === "string") {
      return {
        id: p.id,
        cwd: typeof p.cwd === "string" ? p.cwd : "",
        originator: typeof p.originator === "string" ? p.originator : "",
        source: typeof p.source === "string" ? p.source : "",
        startedAt: Date.parse(p.timestamp ?? line.timestamp ?? "") || 0,
      };
    }
  } catch {
    // The first line didn't fit in the head: fall back to picking fields out of the text.
  }
  const pick = (key: string) => head.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1] ?? "";
  const id = pick("id");
  if (!id) return null;
  return { id, cwd: pick("cwd").replaceAll("\\\\", "\\"), originator: pick("originator"), source: pick("source"), startedAt: Date.parse(pick("timestamp")) || 0 };
}

/** The first thing the user asked, as a title for sessions that have none. */
export function firstPrompt(head: string): string | null {
  for (const raw of head.split("\n")) {
    if (!raw.includes("user_message")) continue;
    try {
      const line = JSON.parse(raw);
      const message = line?.payload?.type === "user_message" ? line.payload.message : null;
      if (typeof message === "string" && message.trim()) return message.replace(/\s+/g, " ").trim().slice(0, 60);
    } catch {
      // a line cut off by the head limit
    }
  }
  return null;
}
