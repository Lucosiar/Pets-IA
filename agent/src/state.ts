/**
 * Session state machine. Pure: no I/O, and callers pass the clock.
 *
 * Hook events are the authority: instant and detailed. Claude Code and Codex send the same
 * hook shape (Codex copied Claude Code's), so one machine handles both. For Claude, polls of
 * `claude agents --json` correct state that has gone stale (no hook for GRACE_MS) and are the only
 * reliable signal that a process has died; Codex has no such command, so its sessions expire
 * after long silences instead (expireQuiet).
 */
import { basename } from "node:path";
import type { SessionOrigin, SessionSource, SessionState } from "../../shared/protocol.ts";

export interface HookEvent {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  [field: string]: unknown;
}

/** One entry of `claude agents --json`, plus the origin the poller worked out. */
export interface AgentEntry {
  sessionId: string;
  name?: string;
  cwd: string;
  kind?: string;
  pid?: number;
  status?: "busy" | "waiting" | "idle";
  startedAt: number;
  origin?: SessionOrigin;
}

export interface SessionRecord {
  id: string;
  source: SessionSource;
  origin: SessionOrigin;
  /** Session title; only `claude agents` knows it. */
  name: string | null;
  /** Fixed at first sight: hooks report the shell's current directory, which moves. */
  cwd: string;
  state: SessionState;
  activity: string | null;
  live: boolean;
  pid: number | null;
  stateSince: number;
  /** Time of the last hook event; 0 if only the poll has seen the session. */
  lastEventAt: number;
}

/** How long hook-derived state wins over a contradicting poll. */
export const GRACE_MS = 10_000;

/** Tools that block until the user answers. */
const ASKS_USER: Record<string, string> = {
  AskUserQuestion: "Te ha hecho una pregunta",
  ExitPlanMode: "Plan listo para revisar",
  request_user_input: "Te ha hecho una pregunta",
};

const MAX_ACTIVITY = 48;

/** Codex sessions silent this long are taken for closed (it has no `claude agents` to ask). */
export const QUIET_WORKING_MS = 2 * 60 * 60 * 1000;
export const QUIET_RESTING_MS = 12 * 60 * 60 * 1000;

function newRecord(
  id: string,
  cwd: string,
  now: number,
  { source = "claude", origin = "terminal", state = "idle" }: { source?: SessionSource; origin?: SessionOrigin; state?: SessionState } = {},
): SessionRecord {
  return { id, source, origin, name: null, cwd, state, activity: null, live: true, pid: null, stateSince: now, lastEventAt: now };
}

export interface HookContext {
  source: SessionSource;
  /** Where the session runs, when the caller could tell; kept once known. */
  origin?: SessionOrigin;
}

export function applyHookEvent(
  prev: SessionRecord | undefined,
  e: HookEvent,
  now: number,
  { source, origin }: HookContext = { source: "claude" },
): SessionRecord {
  const base = prev ?? newRecord(e.session_id, e.cwd || "", now, { source, origin });
  const rec: SessionRecord = { ...base, source, origin: origin ?? base.origin, live: true, lastEventAt: now };
  const to = (state: SessionState, activity: string | null) => moveTo(rec, state, activity, now);

  switch (e.hook_event_name) {
    case "SessionStart":
      return e.source === "compact" ? rec : to("idle", null);

    case "UserPromptSubmit":
      return to("working", "Pensando…");

    case "PreToolUse": {
      const tool = String(e.tool_name ?? "");
      if (tool in ASKS_USER) return to("needs_input", ASKS_USER[tool]!);
      return to("working", describeTool(tool, e.tool_input));
    }

    case "PostToolUse":
    case "PostToolUseFailure":
      return to("working", describeTool(String(e.tool_name ?? ""), e.tool_input));

    case "PermissionRequest": // Codex; Claude reports the same through Notification
      return to("needs_permission", describeTool(String(e.tool_name ?? ""), e.tool_input) || "Necesita tu permiso");

    case "Notification":
      switch (e.notification_type) {
        case "permission_prompt":
          return to("needs_permission", oneLine(e.message) || "Necesita tu permiso");
        case "elicitation_dialog":
        case "agent_needs_input":
          return to("needs_input", oneLine(e.message) || "Esperando tu respuesta");
        case "idle_prompt": // still "working" here means the Stop was missed
          return rec.state === "working" || rec.state === "idle" ? to("done", null) : rec;
        default:
          return rec;
      }

    case "Stop":
    case "Interrupt": // Codex: the user stopped the turn
      return to("done", null);

    case "StopFailure":
      return to("error", oneLine(e.error) || "Error");

    case "SubagentStart":
      return to("working", `Subagente: ${e.agent_type ?? "tarea"}`);

    case "SubagentStop": // background subagents may finish after the turn; don't revive a finished session
      return rec;

    case "PreCompact":
      return to("compacting", "Compactando contexto");

    case "PostCompact":
      return to(e.trigger === "manual" ? "done" : "working", null);

    case "SessionEnd":
      return { ...to("ended", null), live: false, pid: null };

    default:
      return rec;
  }
}

/** Tile label such as "Bash: npm test", "Edit: state.ts" or "github: create_issue". */
export function describeTool(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  let label: string;

  if (tool === "apply_patch") {
    const files = [...String(i.command ?? i.input ?? i.patch ?? "").matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => basename(m[1]!.trim()));
    label = files.length > 0 ? `Edit: ${files.join(", ")}` : "Edit";
  } else if (tool.startsWith("mcp__")) {
    const [, server, ...name] = tool.split("__");
    label = `${server}: ${name.join("__")}`;
  } else if (str(i.file_path)) {
    label = `${tool}: ${basename(str(i.file_path))}`;
  } else {
    const detail = str(i.command) || str(i.pattern) || str(i.description) || str(i.query) || str(i.url);
    label = detail ? `${tool}: ${detail}` : tool;
  }
  return truncate(oneLine(label), MAX_ACTIVITY);
}

/** Merges one poll into `records`; returns only the records that changed. */
export function reconcile(
  records: ReadonlyMap<string, SessionRecord>,
  agents: AgentEntry[],
  now: number,
): SessionRecord[] {
  const changed: SessionRecord[] = [];
  const listed = new Set<string>();

  for (const agent of agents) {
    listed.add(agent.sessionId);
    const prev = records.get(agent.sessionId);
    const next = reconcileOne(prev, agent, now);
    if (!prev || !sameRecord(prev, next)) changed.push(next);
  }

  for (const rec of records.values()) {
    if (rec.source !== "claude") continue; // `claude agents` knows nothing of Codex
    if (rec.live && !listed.has(rec.id) && now - rec.lastEventAt > GRACE_MS) {
      changed.push({ ...moveTo(rec, "ended", null, now), live: false, pid: null });
    }
  }
  return changed;
}

function reconcileOne(prev: SessionRecord | undefined, agent: AgentEntry, now: number): SessionRecord {
  const polled = stateFromStatus(agent.status);

  if (!prev) {
    const fresh = newRecord(agent.sessionId, agent.cwd, now, { state: polled, origin: agent.origin });
    return { ...fresh, name: agent.name ?? null, pid: agent.pid ?? null, lastEventAt: 0 };
  }

  const rec: SessionRecord = {
    ...prev,
    name: agent.name ?? prev.name,
    cwd: agent.cwd,
    pid: agent.pid ?? prev.pid,
    origin: agent.origin ?? prev.origin,
    live: true,
  };

  if (prev.state === "ended") return moveTo(rec, polled, null, now);
  if (now - prev.lastEventAt <= GRACE_MS) return rec;

  // Hooks have gone quiet: correct only clear contradictions.
  const { state } = rec;
  if (agent.status === "idle" && (state === "working" || state === "compacting")) return moveTo(rec, "done", null, now);
  if (agent.status === "busy" && state !== "working" && state !== "compacting") return moveTo(rec, "working", null, now);
  if (agent.status === "waiting" && state === "working") return moveTo(rec, "needs_input", "Esperando tu respuesta", now);
  return rec;
}

/** Codex sessions that have been silent too long, marked closed; returns only those that changed. */
export function expireQuiet(records: Iterable<SessionRecord>, now: number): SessionRecord[] {
  const expired: SessionRecord[] = [];
  for (const rec of records) {
    if (rec.source !== "codex" || !rec.live) continue;
    const quiet = now - rec.lastEventAt;
    const busy = rec.state === "working" || rec.state === "compacting" || rec.state === "needs_permission" || rec.state === "needs_input";
    if (quiet > (busy ? QUIET_WORKING_MS : QUIET_RESTING_MS)) expired.push({ ...moveTo(rec, "ended", null, now), live: false, pid: null });
  }
  return expired;
}

function stateFromStatus(status: AgentEntry["status"]): SessionState {
  if (status === "busy") return "working";
  if (status === "waiting") return "needs_input";
  return "idle";
}

function moveTo(rec: SessionRecord, state: SessionState, activity: string | null, now: number): SessionRecord {
  return { ...rec, state, activity, stateSince: state === rec.state ? rec.stateSince : now };
}

function sameRecord(a: SessionRecord, b: SessionRecord) {
  return (Object.keys(a) as (keyof SessionRecord)[]).every((k) => a[k] === b[k]);
}

function oneLine(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
