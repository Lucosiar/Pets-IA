import { $ } from "bun";
import type { SessionHub } from "./hub.ts";
import { claudeOriginForPid } from "./origin.ts";
import type { AgentEntry } from "./state.ts";

/**
 * Feeds `claude agents --json` to the hub every `intervalMs`, adding the origin of sessions the
 * hub hasn't placed yet. Returns a stop function. Without Claude Code installed it just logs once.
 */
export function startPoller(hub: SessionHub, intervalMs = 3000) {
  let stopped = false;
  let lastError = "";

  (async () => {
    while (!stopped) {
      try {
        const agents: AgentEntry[] = await $`claude agents --json`.quiet().json();
        for (const agent of agents) {
          if (agent.pid && (!hub.has(agent.sessionId) || hub.originOf(agent.sessionId) === "terminal")) {
            agent.origin = await claudeOriginForPid(agent.pid);
          }
        }
        hub.handleAgents(agents);
        lastError = "";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== lastError) console.error(`poll failed: ${message}`); // log each distinct failure once
        lastError = message;
      }
      await Bun.sleep(intervalMs);
    }
  })();

  return () => {
    stopped = true;
  };
}
