import { PANEL_PORT } from "../../shared/protocol.ts";
import { HOOK_PORT, loadConfig } from "./config.ts";
import { watchDesktopFocus } from "./desktop-focus.ts";
import { SessionHub } from "./hub.ts";
import { startPoller } from "./poller.ts";
import { startServers } from "./server.ts";
import { Store } from "./store.ts";

/** Runs until SIGINT, SIGTERM or an authenticated POST /shutdown. */
export async function runAgent() {
  const config = await loadConfig();
  const store = new Store(config.dbPath);
  const hub = new SessionHub(store);
  let servers: ReturnType<typeof startServers> | undefined;

  function shutdown() {
    clearInterval(pruneTimer);
    clearInterval(expireTimer);
    stopPoller();
    stopFocus();
    servers?.stop();
    store.close();
    process.exit(0);
  }

  servers = startServers({ hub, token: config.token, hookPort: HOOK_PORT, panelPort: PANEL_PORT, onShutdown: shutdown });
  const stopPoller = startPoller(hub);
  const stopFocus = watchDesktopFocus((id) => hub.setFocused(id));
  const pruneTimer = setInterval(() => hub.prune(), 10 * 60 * 1000);
  const expireTimer = setInterval(() => hub.expire(), 60 * 1000);

  hub.subscribe((change) => {
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    if (change.type === "removed") return console.log(`${time}  ${change.id.slice(0, 8)}  removed`);
    if (change.type === "focus") return console.log(`${time}  focus → ${change.id ? hub.get(change.id)?.name ?? change.id : "none"}`);
    const s = change.session;
    const flags = `${s.live ? "" : " (not live)"}${s.pinned ? " ★" : ""}`;
    console.log(`${time}  ${s.id.slice(0, 8)}  ${s.source}/${s.origin.padEnd(8)} ${s.state.padEnd(16)} ${s.name}${flags}  ${s.activity ?? ""}`);
  });

  console.log(`petsia agent
  hooks : http://127.0.0.1:${HOOK_PORT}/hook
  panel : ws://127.0.0.1:${PANEL_PORT}/ws
  data  : ${config.dbPath}
`);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
