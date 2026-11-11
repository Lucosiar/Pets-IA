import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ServerMessage } from "../../shared/protocol.ts";
import type { CodexSession } from "./codex-sessions.ts";
import type { DesktopSession } from "./desktop-sessions.ts";
import { SessionHub } from "./hub.ts";
import { planOpen, urlOpener, vscodeFolderUrl, type OpenTarget } from "./open-session.ts";
import { startServers } from "./server.ts";
import { Store } from "./store.ts";

const ID = "0603472f-b7c5-4dae-b7a1-142468264b30";
const TOKEN = "test-token";

const IDLE = "22222222-2222-4222-8222-222222222222";
const DESKTOP: DesktopSession[] = [
  { localId: "local_idle", sessionId: IDLE, title: "Idle work", cwd: "/Users/dev/idle", lastActivityAt: 5000, archived: false },
  { localId: "local_old", sessionId: "33333333-3333-4333-8333-333333333333", title: "Old", cwd: "/x", lastActivityAt: 1, archived: true },
];

const CODEX_ID = "019dabc6-8fef-7681-a054-b5bb75fcb97d";
const CODEX: CodexSession[] = [
  { sessionId: CODEX_ID, title: "add tests", cwd: "/w/app", origin: "vscode", lastActivityAt: 9000, path: "/x.jsonl" },
];

let servers: ReturnType<typeof startServers>;
let opened: OpenTarget[];
let shutdowns: number;

beforeEach(() => {
  opened = [];
  shutdowns = 0;
  servers = startServers({
    hub: new SessionHub(new Store()),
    token: TOKEN,
    hookPort: 0, // 0 = any free port
    panelPort: 0,
    open: async (target) => {
      opened.push(target);
      return { ok: true };
    },
    desktopSessions: async () => DESKTOP,
    codexSessions: async () => CODEX,
    onShutdown: () => shutdowns++,
  });
});
afterEach(() => servers.stop());

const hookUrl = () => `http://127.0.0.1:${servers.hookServer.port}/hook`;
const panelHttp = () => `http://127.0.0.1:${servers.panelServer.port}`;

function postHook(event: Record<string, unknown>, url = hookUrl()) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) });
}

/** Opens a panel connection; next() resolves with the following server message. */
async function connect(token = TOKEN) {
  const ws = new WebSocket(`ws://127.0.0.1:${servers.panelServer.port}/ws?token=${token}`);
  const inbox: ServerMessage[] = [];
  const waiting: ((m: ServerMessage) => void)[] = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMessage;
    const resolve = waiting.shift();
    if (resolve) resolve(msg);
    else inbox.push(msg);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const next = () =>
    inbox.length > 0 ? Promise.resolve(inbox.shift()!) : new Promise<ServerMessage>((resolve) => waiting.push(resolve));
  return { ws, next };
}

async function waitFor(condition: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

test("a wrong token is rejected", async () => {
  expect((await fetch(`${panelHttp()}/ws?token=nope`)).status).toBe(401);
  expect((await fetch(`${panelHttp()}/ws`)).status).toBe(401);
});

test("shutdown needs the token", async () => {
  const url = `http://127.0.0.1:${servers.hookServer.port}/shutdown`;
  expect((await fetch(url, { method: "POST" })).status).toBe(401);
  expect((await fetch(url, { method: "POST", headers: { "x-petsia-token": TOKEN } })).status).toBe(204);
  await waitFor(() => shutdowns === 1);
});

test("hook events say which tool sent them and where it runs", async () => {
  const { ws, next } = await connect();
  await next(); // snapshot
  await postHook({ hook_event_name: "UserPromptSubmit", session_id: ID, cwd: "/tmp/demo", _source: "claude", _entrypoint: "claude-vscode" });
  expect(await next()).toMatchObject({ session: { id: ID, source: "claude", origin: "vscode", icon: { color: "#d97757" } } });
  await postHook({ hook_event_name: "SessionStart", session_id: CODEX_ID, cwd: "/w/app", _source: "codex", transcript_path: "/missing.jsonl" });
  expect(await next()).toMatchObject({ session: { id: CODEX_ID, source: "codex", origin: "terminal", icon: { color: "#4f7cff" } } });
  ws.close();
});

test("the panel port does not accept hook events", async () => {
  const res = await postHook({ hook_event_name: "Stop", session_id: ID, cwd: "/tmp" }, `${panelHttp()}/hook`);
  expect(res.status).toBe(404);
});

test("the panel gets a snapshot, then live updates from hooks", async () => {
  const { ws, next } = await connect();
  expect(await next()).toEqual({ type: "snapshot", sessions: [], focusedId: null });

  const res = await postHook({ hook_event_name: "UserPromptSubmit", session_id: ID, cwd: "/tmp/demo" });
  expect(res.status).toBe(204);
  expect(await next()).toMatchObject({ type: "session", session: { id: ID, name: "demo", state: "working", live: true } });
  ws.close();
});

test("pin, icon and open commands; anything else is refused", async () => {
  await postHook({ hook_event_name: "Stop", session_id: ID, cwd: "/tmp/demo" });
  const { ws, next } = await connect();
  await next(); // snapshot

  ws.send(JSON.stringify({ type: "pin", id: ID, pinned: true }));
  expect(await next()).toMatchObject({ type: "session", session: { id: ID, pinned: true, position: 0 } });

  ws.send(JSON.stringify({ type: "pin", id: ID, pinned: false }));
  expect(await next()).toMatchObject({ type: "session", session: { pinned: false } });

  ws.send(JSON.stringify({ type: "icon", id: ID, icon: { character: "crab", color: "#ff6a1a" } }));
  expect(await next()).toMatchObject({ type: "session", session: { pinned: true, icon: { character: "crab" } } });

  ws.send(JSON.stringify({ type: "open", id: ID }));
  await waitFor(() => opened.length === 1);
  expect(opened).toEqual([{ id: ID, source: "claude", origin: "terminal", cwd: "/tmp/demo", live: true }]);
  expect(await next()).toEqual({ type: "focus", id: ID });

  ws.send(JSON.stringify({ type: "open", id: "11111111-1111-1111-1111-111111111111" }));
  expect(await next()).toEqual({ type: "error", message: "sesión desconocida" });

  ws.send("rm -rf /");
  expect(await next()).toEqual({ type: "error", message: "mensaje no válido" });
  ws.close();
});

test("the library lists desktop and Codex sessions, and pinning one that isn't running adopts it", async () => {
  const { ws, next } = await connect();
  await next(); // snapshot

  ws.send(JSON.stringify({ type: "library" }));
  expect(await next()).toEqual({
    type: "library",
    sessions: [
      { id: CODEX_ID, name: "add tests", cwd: "/w/app", lastActivityAt: 9000, pinned: false, source: "codex", origin: "vscode" },
      { id: IDLE, name: "Idle work", cwd: "/Users/dev/idle", lastActivityAt: 5000, pinned: false, source: "claude", origin: "desktop" },
    ],
  });

  ws.send(JSON.stringify({ type: "pin", id: CODEX_ID, pinned: true }));
  expect(await next()).toMatchObject({ type: "session", session: { id: CODEX_ID, source: "codex", origin: "vscode", live: false } });
  expect(await next()).toMatchObject({ type: "session", session: { id: CODEX_ID, pinned: true, icon: { color: "#4f7cff" } } });

  ws.send(JSON.stringify({ type: "pin", id: IDLE, pinned: true }));
  expect(await next()).toMatchObject({ type: "session", session: { id: IDLE, name: "Idle work", live: false, state: "ended" } });
  expect(await next()).toMatchObject({ type: "session", session: { id: IDLE, pinned: true } });

  ws.send(JSON.stringify({ type: "library" }));
  expect(await next()).toMatchObject({ type: "library", sessions: [{ id: CODEX_ID, pinned: true }, { id: IDLE, pinned: true }] });
  ws.close();
});

test("planOpen picks the right deep link for each tool and place", async () => {
  const root = mkdtempSync(`${tmpdir()}/petsia-open-`);
  const liveDir = `${root}/live`;
  const desktopDir = `${root}/desktop`;
  mkdirSync(liveDir);
  mkdirSync(`${desktopDir}/account/org`, { recursive: true });
  const dirs = { liveDir, desktopDir };
  const claude = (extra: Partial<OpenTarget> = {}): OpenTarget => ({ id: ID, source: "claude", origin: "terminal", cwd: "/w", live: false, ...extra });
  const codex = (extra: Partial<OpenTarget> = {}): OpenTarget => ({ id: CODEX_ID, source: "codex", origin: "app", cwd: "/w/app", live: true, ...extra });
  try {
    expect(await planOpen(claude({ id: "not-a-uuid" }), dirs)).toEqual({ ok: false, error: "id de sesión no válido" });

    // Claude, closed and unknown to the app: resume it in the desktop app.
    expect(await planOpen(claude(), dirs)).toEqual({ ok: true, command: ["claude", "--desktop", "--resume", ID] });
    // Claude in VS Code: the extension's own link, running or not.
    expect(await planOpen(claude({ origin: "vscode" }), dirs)).toEqual({ ok: true, url: `vscode://anthropic.claude-code/open?session=${ID}` });

    // Running in a terminal: refused. process.pid makes the fake session count as running.
    writeFileSync(`${liveDir}/1.json`, JSON.stringify({ pid: process.pid, sessionId: ID, entrypoint: "cli" }));
    expect((await planOpen(claude({ live: true }), dirs)).ok).toBe(false);

    // Known to the desktop app: its link wins, whether or not a process runs.
    writeFileSync(`${desktopDir}/account/org/local_abc-123.json`, JSON.stringify({ sessionId: "local_abc-123", cliSessionId: ID }));
    expect(await planOpen(claude(), dirs)).toEqual({ ok: true, url: "claude://code/continue?session=local_abc-123" });

    expect(await planOpen(codex(), dirs)).toEqual({ ok: true, url: `codex://threads/${CODEX_ID}` });
    expect(await planOpen(codex({ origin: "terminal", live: false }), dirs)).toEqual({ ok: true, url: `codex://threads/${CODEX_ID}` });
    expect((await planOpen(codex({ origin: "terminal" }), dirs)).ok).toBe(false);
    expect(await planOpen(codex({ origin: "vscode" }), dirs)).toEqual({ ok: true, url: "vscode://file/w/app" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("folder links and URL openers per platform", () => {
  expect(vscodeFolderUrl("C:\\Users\\Lucía\\app")).toBe("vscode://file/C:/Users/Luc%C3%ADa/app");
  expect(vscodeFolderUrl("/Users/me/my app")).toBe("vscode://file/Users/me/my%20app");
  expect(urlOpener("codex://threads/x", true)).toEqual(["rundll32.exe", "url.dll,FileProtocolHandler", "codex://threads/x"]);
  expect(urlOpener("codex://threads/x", false)).toEqual(["open", "codex://threads/x"]);
});
