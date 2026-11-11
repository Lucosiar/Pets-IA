import { PANEL_PORT } from "../../shared/protocol.ts";
import { BIN_DIR, IS_WINDOWS, LOG_DIR } from "./config.ts";
import { describe, petsJobs } from "./launchd.ts";
import { hooksInstalled } from "./settings.ts";
import { inRun, isRunning, OVERLAY_EXE } from "./windows.ts";

export async function status(version: string) {
  const health = await fetch(`http://127.0.0.1:${PANEL_PORT}/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.json() as Promise<{ sessions: number }>)
    .catch(() => null);

  let agent: string;
  let overlay: string;
  if (IS_WINDOWS) {
    agent = health ? "en marcha" : "parado";
    overlay = (await isRunning(OVERLAY_EXE)) ? "en marcha" : "parado";
    overlay += (await inRun()) ? " (arranca al iniciar sesión)" : " (no arranca al iniciar sesión)";
  } else {
    const [a, o] = petsJobs({ binDir: BIN_DIR, logDir: LOG_DIR });
    agent = await describe(a!.label);
    overlay = await describe(o!.label);
  }
  const hooks = async (tool: "claude" | "codex") => ((await hooksInstalled(tool)) ? "instalados" : "no instalados");

  console.log(`petsia ${version}
  agente  : ${agent}
  tira    : ${overlay}
  hooks   : Claude ${await hooks("claude")}, Codex ${await hooks("codex")}
  salud   : ${health ? `responde, ${health.sessions} sesiones` : `sin respuesta en :${PANEL_PORT}`}
  logs    : ${LOG_DIR}`);
}
