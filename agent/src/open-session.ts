/**
 * Opens a session where it lives, by deep link:
 * - Claude, desktop app: `claude://code/continue?session=local_…` (undocumented); the app restarts the session if needed.
 * - Claude, VS Code: `vscode://anthropic.claude-code/open?session=<id>` (documented).
 * - Claude, closed and unknown to the app: `claude --desktop --resume <id>` (documented, CLI ≥ 2.1.285).
 * - Codex app (and closed Codex sessions): `codex://threads/<id>` (documented).
 * - Codex, VS Code: the project folder in VS Code (`vscode://file/<cwd>`); the extension has no session link.
 * - Running in a terminal: refused, since resuming it would start a second process on the same conversation.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SessionOrigin, SessionSource } from "../../shared/protocol.ts";
import { CLAUDE_LIVE_DIR, DESKTOP_SESSIONS_DIR, IS_WINDOWS } from "./config.ts";
import { findDesktopSession } from "./desktop-sessions.ts";
import { isSessionId } from "./protocol-guard.ts";

const LOCAL_ID = /^local_[A-Za-z0-9-]{1,64}$/;

/** Either a URL for the OS to open, or a command to run. */
export type OpenPlan = { ok: true; url: string } | { ok: true; command: string[] } | { ok: false; error: string };
export type OpenResult = { ok: true } | { ok: false; error: string };

export interface OpenTarget {
  id: string;
  source: SessionSource;
  origin: SessionOrigin;
  cwd: string;
  live: boolean;
}

interface LiveSession {
  pid: number;
  sessionId: string;
  entrypoint?: string;
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0); // signal 0 only checks that the process exists
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A running Claude Code process for this session, from the CLI's internal ~/.claude/sessions/<pid>.json. */
async function findLiveClaude(id: string, dir: string): Promise<LiveSession | undefined> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.endsWith(".json")) continue;
    const info: LiveSession | null = await Bun.file(join(dir, name)).json().catch(() => null);
    if (info?.sessionId === id && isAlive(info.pid)) return info;
  }
}

/** `vscode://file/` takes forward slashes, with a leading one before a Windows drive letter. */
export function vscodeFolderUrl(cwd: string) {
  const path = cwd.replaceAll("\\", "/");
  return `vscode://file${path.startsWith("/") ? "" : "/"}${encodeURI(path)}`;
}

const TERMINAL = "Se está ejecutando en una terminal: ábrela allí";

/** Picks how to open the session, without doing it. */
export async function planOpen(
  target: OpenTarget,
  { liveDir = CLAUDE_LIVE_DIR, desktopDir = DESKTOP_SESSIONS_DIR } = {},
): Promise<OpenPlan> {
  const { id, source, origin, cwd, live } = target;
  if (!isSessionId(id)) return { ok: false, error: "id de sesión no válido" };

  if (source === "codex") {
    if (origin === "vscode") return cwd ? { ok: true, url: vscodeFolderUrl(cwd) } : { ok: false, error: "No sé en qué carpeta está" };
    if (origin === "terminal" && live) return { ok: false, error: TERMINAL };
    return { ok: true, url: `codex://threads/${id}` };
  }

  const desktop = await findDesktopSession(id, desktopDir);
  if (desktop && LOCAL_ID.test(desktop.localId)) return { ok: true, url: `claude://code/continue?session=${desktop.localId}` };
  if (origin === "vscode") return { ok: true, url: `vscode://anthropic.claude-code/open?session=${id}` };
  const running = await findLiveClaude(id, liveDir);
  if (running) {
    if (/vscode/i.test(running.entrypoint ?? "")) return { ok: true, url: `vscode://anthropic.claude-code/open?session=${id}` };
    return { ok: false, error: TERMINAL };
  }
  return { ok: true, command: ["claude", "--desktop", "--resume", id] };
}

/** The argv that hands a URL to the OS's handler for its scheme. */
export function urlOpener(url: string, windows = IS_WINDOWS): string[] {
  // rundll32 avoids cmd's `start`, which would read the & in query strings as a command separator.
  return windows ? ["rundll32.exe", "url.dll,FileProtocolHandler", url] : ["open", url];
}

/** On Windows `claude` may be an npm .cmd shim, which only cmd can run. */
function resolveCommand(argv: string[]): string[] {
  const [name, ...args] = argv;
  const found = Bun.which(name!) ?? name!;
  return IS_WINDOWS && /\.(cmd|bat)$/i.test(found) ? ["cmd.exe", "/d", "/c", found, ...args] : [found, ...args];
}

export async function openSession(target: OpenTarget): Promise<OpenResult> {
  const plan = await planOpen(target);
  if (!plan.ok) return plan;
  const argv = "url" in plan ? urlOpener(plan.url) : resolveCommand(plan.command);
  try {
    const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "pipe", windowsHide: true });
    const code = await proc.exited;
    // rundll32 and `open` return before the app has the link; only a failing exit means trouble.
    if (code !== 0 && !argv[0]!.toLowerCase().startsWith("rundll32")) {
      const detail = (await new Response(proc.stderr).text()).trim();
      return { ok: false, error: detail || `${argv[0]} terminó con código ${code}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
