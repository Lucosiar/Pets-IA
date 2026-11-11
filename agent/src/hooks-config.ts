/**
 * The hooks Pets IA adds to Claude Code (~/.claude/settings.json) and Codex (~/.codex/hooks.json).
 * Both files share one shape — `{ hooks: { Event: [{ matcher?, hooks: [handler] }] } }` — so one
 * merge serves both. Each handler runs `petsia hook <tool>`, which forwards the event to the
 * agent and always exits 0 without output, so it never blocks or changes what the tool does.
 */
import type { SessionSource } from "../../shared/protocol.ts";

/** Claude Code events the agent needs to track session state. */
export const CLAUDE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "SessionEnd",
] as const;

/** Codex hook events (the hooks engine, stable since Codex CLI 0.124). */
export const CODEX_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "SessionEnd",
] as const;

export const EVENTS: Record<SessionSource, readonly string[]> = { claude: CLAUDE_EVENTS, codex: CODEX_EVENTS };

/** Marks our handlers so uninstall and reinstall find them, whatever path the binary had. */
const MARKER = (source: SessionSource) => ` hook ${source}`;

export type HookPlatform = "darwin" | "win32" | "linux";

/**
 * The command line that runs `petsia hook <source>`, quoted for the shell each tool uses:
 * Claude Code runs hooks with bash (Git Bash on Windows); Codex on Windows uses the native
 * command interpreter, where a bare quoted path is not a command in PowerShell, so it goes through cmd.
 */
export function hookCommand(binary: string, source: SessionSource, platform: HookPlatform = process.platform as HookPlatform): string {
  if (platform === "win32") {
    if (source === "claude") return `"${binary.replaceAll("\\", "/")}"${MARKER(source)}`;
    return `cmd.exe /d /s /c ""${binary.replaceAll("/", "\\")}"${MARKER(source)}"`;
  }
  return `'${binary.replaceAll("'", `'\\''`)}'${MARKER(source)}`;
}

/** The `hooks` block for one tool, forwarding every event it needs. Synchronous, so events arrive in order. */
export function buildHooks(source: SessionSource, command: string) {
  return Object.fromEntries(EVENTS[source].map((event) => [event, [{ hooks: [{ type: "command", command, timeout: 2 }] }]]));
}

type Handler = { type?: string; url?: string; command?: unknown; [k: string]: unknown };
type MatcherGroup = { matcher?: string; hooks: Handler[] };
export type HooksFile = { hooks?: Record<string, MatcherGroup[]>; [k: string]: unknown };

/** True for handlers this project installed. */
export function isOurHook(handler: Handler, source: SessionSource) {
  if (handler.type !== "command" || typeof handler.command !== "string") return false;
  return /petsia(\.exe)?["']?/i.test(handler.command) && handler.command.includes(MARKER(source).trim());
}

/** `file` with our hooks removed, then added back when `command` is given; everything else stays as it was. */
export function mergeHooks(file: HooksFile, source: SessionSource, command: string | null): HooksFile {
  const hooks: Record<string, MatcherGroup[]> = {};
  for (const [event, groups] of Object.entries(file.hooks ?? {})) {
    const kept = groups
      .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((h) => !isOurHook(h, source)) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length > 0) hooks[event] = kept;
  }
  if (command) {
    for (const [event, groups] of Object.entries(buildHooks(source, command))) hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  const { hooks: _, ...rest } = file;
  return Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
}

export function hasOurHooks(file: HooksFile, source: SessionSource) {
  return Object.values(file.hooks ?? {}).some((groups) => groups.some((group) => (group.hooks ?? []).some((h) => isOurHook(h, source))));
}
