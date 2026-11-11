/**
 * Two loopback servers: hooks, and the overlay's WebSocket behind the pairing token.
 * Keeping them apart means the WebSocket can never inject hook events.
 */
import { timingSafeEqual } from "node:crypto";
import { basename } from "node:path";
import type { LibraryEntry, ServerMessage, SessionOrigin, SessionSource } from "../../shared/protocol.ts";
import { listCodexSessions, type CodexSession } from "./codex-sessions.ts";
import { listDesktopSessions, type DesktopSession } from "./desktop-sessions.ts";
import type { SessionHub } from "./hub.ts";
import { openSession, type OpenResult, type OpenTarget } from "./open-session.ts";
import { codexOrigin, originFromEntrypoint, readCodexMeta } from "./origin.ts";
import { parseClientMessage } from "./protocol-guard.ts";
import type { HookEvent } from "./state.ts";

export interface ServerOptions {
  hub: SessionHub;
  token: string;
  hookPort: number;
  panelPort: number;
  /** Replaceable so tests don't open real sessions or read real apps. */
  open?: (target: OpenTarget) => Promise<OpenResult>;
  desktopSessions?: () => Promise<DesktopSession[]>;
  codexSessions?: () => Promise<CodexSession[]>;
  /** Called by POST /shutdown with the token, which is how the Windows overlay stops the agent. */
  onShutdown?: () => void;
}

const TOPIC = "panel";
const LIBRARY_SIZE = 100;

export function startServers({
  hub,
  token,
  hookPort,
  panelPort,
  open = openSession,
  desktopSessions = () => listDesktopSessions(),
  codexSessions = () => listCodexSessions(),
  onShutdown,
}: ServerOptions) {
  interface Candidate {
    id: string;
    title: string | null;
    cwd: string;
    lastActivityAt: number;
    source: SessionSource;
    origin: SessionOrigin;
  }

  async function candidates(): Promise<Candidate[]> {
    const [desktop, codex] = await Promise.all([desktopSessions().catch(() => []), codexSessions().catch(() => [])]);
    return [
      ...desktop
        .filter((s) => !s.archived)
        .map((s) => ({ id: s.sessionId, title: s.title, cwd: s.cwd, lastActivityAt: s.lastActivityAt, source: "claude" as const, origin: "desktop" as const })),
      ...codex.map((s) => ({ id: s.sessionId, title: s.title, cwd: s.cwd, lastActivityAt: s.lastActivityAt, source: "codex" as const, origin: s.origin })),
    ].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  async function library(): Promise<LibraryEntry[]> {
    return (await candidates()).slice(0, LIBRARY_SIZE).map((s) => {
      const known = hub.get(s.id);
      return {
        id: s.id,
        name: s.title ?? known?.name ?? basename(s.cwd),
        cwd: s.cwd,
        lastActivityAt: s.lastActivityAt,
        pinned: known?.pinned ?? false,
        source: s.source,
        origin: known?.origin ?? s.origin,
      };
    });
  }

  /** Lets the overlay pin a session whose process isn't running, so the agent never saw it. */
  async function adoptFromLibrary(id: string) {
    const s = (await candidates()).find((c) => c.id === id);
    if (s) hub.adopt(s.id, s.source, s.origin, s.title, s.cwd, s.lastActivityAt);
  }

  /** Which tool sent the event and where its session runs; the origin is worked out once per session. */
  async function contextFor(event: HookEvent) {
    const source: SessionSource = event._source === "codex" ? "codex" : "claude";
    let origin: SessionOrigin | undefined;
    const known = hub.originOf(event.session_id);
    if (source === "claude") {
      origin = originFromEntrypoint(event._entrypoint);
    } else if (!known || known === "terminal") {
      const meta = typeof event.transcript_path === "string" ? await readCodexMeta(event.transcript_path) : null;
      if (meta) origin = codexOrigin(meta);
    }
    // A Claude session the desktop app knows is a desktop session, whatever process runs it.
    if (known === "desktop") origin = "desktop";
    return { source, origin };
  }

  const hookServer = Bun.serve({
    hostname: "127.0.0.1",
    port: hookPort,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "POST" && pathname === "/shutdown") {
        if (!sameSecret(req.headers.get("x-petsia-token"), token)) return new Response("unauthorized", { status: 401 });
        setTimeout(() => onShutdown?.(), 50);
        return new Response(null, { status: 204 });
      }
      if (req.method !== "POST" || pathname !== "/hook") return new Response("not found", { status: 404 });
      try {
        const event = (await req.json()) as HookEvent;
        if (typeof event?.session_id === "string" && typeof event.hook_event_name === "string") {
          hub.handleHook(event, await contextFor(event));
        }
      } catch {
        return new Response("bad json", { status: 400 });
      }
      return new Response(null, { status: 204 });
    },
  });

  const panelServer = Bun.serve({
    hostname: "127.0.0.1",
    port: panelPort,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ ok: true, sessions: hub.snapshot().length });
      if (url.pathname !== "/ws") return new Response("not found", { status: 404 });
      if (!sameSecret(url.searchParams.get("token"), token)) return new Response("unauthorized", { status: 401 });
      if (server.upgrade(req)) return;
      return new Response("expected a WebSocket", { status: 400 });
    },
    websocket: {
      maxPayloadLength: 4 * 1024,
      open(ws) {
        ws.subscribe(TOPIC);
        send(ws, { type: "snapshot", sessions: hub.snapshot(), focusedId: hub.focusedId });
      },
      async message(ws, raw) {
        const msg = parseClientMessage(String(raw));
        if (!msg) return send(ws, { type: "error", message: "mensaje no válido" });
        if (msg.type === "library") return send(ws, { type: "library", sessions: await library() });
        if (!hub.has(msg.id)) await adoptFromLibrary(msg.id);
        const target = hub.target(msg.id);
        if (!target) return send(ws, { type: "error", message: "sesión desconocida" });

        switch (msg.type) {
          case "open": {
            const result = await open(target);
            // The desktop log confirms focus a moment later; show it right away.
            if (result.ok) hub.setFocused(msg.id);
            else send(ws, { type: "error", message: result.error });
            break;
          }
          case "pin":
            hub.setPinned(msg.id, msg.pinned);
            break;
          case "icon":
            hub.setIcon(msg.id, msg.icon);
            break;
        }
      },
      close(ws) {
        ws.unsubscribe(TOPIC);
      },
    },
  });

  const unsubscribe = hub.subscribe((change) => panelServer.publish(TOPIC, JSON.stringify(change satisfies ServerMessage)));

  return {
    hookServer,
    panelServer,
    stop() {
      unsubscribe();
      hookServer.stop(true);
      panelServer.stop(true);
    },
  };
}

function send(ws: { send(data: string): unknown }, message: ServerMessage) {
  ws.send(JSON.stringify(message));
}

/** Constant-time, so response timing doesn't leak the token. */
function sameSecret(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
