/**
 * Start at login on Windows. One entry in the user's Run key starts the overlay
 * (petsia-overlay.exe), and the overlay keeps the agent (`petsia.exe agent`) running, restarting it
 * if it dies and stopping it on quit. No services, no admin rights, no scheduled tasks.
 */
import { $ } from "bun";
import { join } from "node:path";
import { HOOK_PORT } from "./config.ts";

export const OVERLAY_EXE = "petsia-overlay.exe";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "PetsIA";

export function overlayPath(binDir: string) {
  return join(binDir, OVERLAY_EXE);
}

export async function addToRun(binDir: string) {
  await $`reg.exe add ${RUN_KEY} /v ${RUN_VALUE} /t REG_SZ /d ${`"${overlayPath(binDir)}"`} /f`.quiet();
}

export async function removeFromRun() {
  await $`reg.exe delete ${RUN_KEY} /v ${RUN_VALUE} /f`.quiet().nothrow();
}

export async function inRun() {
  return (await $`reg.exe query ${RUN_KEY} /v ${RUN_VALUE}`.quiet().nothrow()).exitCode === 0;
}

export async function isRunning(image: string) {
  const out = await $`tasklist.exe /FI ${`IMAGENAME eq ${image}`} /NH`.quiet().nothrow().text();
  return out.toLowerCase().includes(image.toLowerCase());
}

/** Starts the overlay detached from this console; it then starts the agent. */
export async function startOverlay(binDir: string) {
  const path = overlayPath(binDir).replaceAll("'", "''");
  await $`powershell.exe -NoProfile -NonInteractive -Command ${`Start-Process -FilePath '${path}'`}`.quiet();
}

/** Stops the agent (through its own endpoint, so no other petsia.exe is touched) and the overlay. */
export async function stopAll(token: string | null) {
  await $`taskkill.exe /IM ${OVERLAY_EXE} /F`.quiet().nothrow();
  if (token) {
    await fetch(`http://127.0.0.1:${HOOK_PORT}/shutdown`, { method: "POST", headers: { "x-petsia-token": token }, signal: AbortSignal.timeout(2000) }).catch(
      () => null,
    );
  }
  // Give the agent a moment to let go of petsia.exe and the database.
  for (let i = 0; i < 30; i++) {
    const alive = await fetch(`http://127.0.0.1:${HOOK_PORT}/`, { signal: AbortSignal.timeout(300) }).then(() => true, () => false);
    if (!alive) return;
    await Bun.sleep(100);
  }
}
