import { $ } from "bun";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BIN_DIR, CLAUDE_HOME, CODEX_HOME, CONFIG_FILE, DATA_DIR, IS_MAC, IS_WINDOWS, LOG_DIR, loadConfig } from "./config.ts";
import { petsJobs, remove, start, stop } from "./launchd.ts";
import { HOOK_FILES, writeHooks } from "./settings.ts";
import { addToRun, OVERLAY_EXE, removeFromRun, startOverlay, stopAll } from "./windows.ts";

/** What a release ships next to the `petsia` binary, and setup copies into BIN_DIR. */
export const SHIPPED = IS_WINDOWS ? ["petsia.exe", OVERLAY_EXE] : ["petsia", "petsia-overlay", "PetsIA_PetsCore.bundle"];

async function savedToken(): Promise<string | null> {
  const saved = await Bun.file(CONFIG_FILE).json().catch(() => null);
  return typeof saved?.token === "string" ? saved.token : null;
}

export async function setup() {
  if (!IS_MAC && !IS_WINDOWS) throw new Error("Pets IA funciona en macOS y Windows");
  const source = dirname(process.execPath);
  const missing = SHIPPED.filter((name) => !existsSync(join(source, name)));
  if (missing.length > 0) {
    throw new Error(`no encuentro ${missing.join(", ")} junto a ${process.execPath}; ejecuta setup desde una release`);
  }

  if (IS_WINDOWS) await stopAll(await savedToken());
  else for (const job of petsJobs({ binDir: BIN_DIR, logDir: LOG_DIR })) await stop(job.label);

  if (source.toLowerCase() !== BIN_DIR.toLowerCase()) await copyInto(source, BIN_DIR);
  await loadConfig();
  await mkdir(LOG_DIR, { recursive: true });

  const hooks: string[] = [];
  for (const tool of ["claude", "codex"] as const) {
    const home = tool === "claude" ? CLAUDE_HOME : CODEX_HOME;
    if (!existsSync(home)) {
      hooks.push(`${tool.padEnd(6)} : no instalado (${home} no existe); vuelve a ejecutar setup cuando lo instales`);
      continue;
    }
    const changed = await writeHooks(tool, { install: true });
    hooks.push(`${tool.padEnd(6)} : ${changed ? "añadidos a" : "ya estaban en"} ${HOOK_FILES[tool]}`);
  }

  if (IS_WINDOWS) {
    await addToRun(BIN_DIR);
    await startOverlay(BIN_DIR);
  } else {
    // A strip started by hand would hold the single-instance lock, and the LaunchAgent's copy would quit.
    await $`pkill -x petsia-overlay`.quiet().nothrow();
    for (const job of petsJobs({ binDir: BIN_DIR, logDir: LOG_DIR })) await start(job);
  }

  console.log(`Pets IA está instalado y en marcha.
  binarios : ${BIN_DIR}
  datos    : ${DATA_DIR}
  logs     : ${LOG_DIR}
  hooks
    ${hooks.join("\n    ")}`);
  if (existsSync(CODEX_HOME)) {
    console.log(`
Codex pide confirmar los hooks nuevos antes de usarlos: abre Codex y acéptalos
(en la terminal con /hooks; en la app, en Ajustes → Hooks → Trust).`);
  }
}

/** Each item lands under a temporary name, then replaces the old one in a single rename. */
async function copyInto(source: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const name of SHIPPED) {
    const temporary = join(target, `.${name}.new`);
    await rm(temporary, { recursive: true, force: true });
    if (IS_WINDOWS) await Bun.write(temporary, Bun.file(join(source, name)));
    else await $`cp -Rp ${join(source, name)} ${temporary}`.quiet();
    await retry(() => rm(join(target, name), { recursive: true, force: true }));
    await retry(() => rename(temporary, join(target, name)));
  }
}

/** Windows keeps a just-stopped .exe locked for a moment. */
async function retry(step: () => Promise<unknown>, tries = 20) {
  for (let i = 1; ; i++) {
    try {
      return await step();
    } catch (error) {
      if (i >= tries) throw error;
      await Bun.sleep(250);
    }
  }
}

export async function uninstall({ purge }: { purge: boolean }) {
  if (IS_WINDOWS) {
    await removeFromRun();
    await stopAll(await savedToken());
  } else {
    for (const job of petsJobs({ binDir: BIN_DIR, logDir: LOG_DIR })) await remove(job.label);
    await $`pkill -f ${`${BIN_DIR}/`}`.quiet().nothrow();
  }
  const removed: string[] = [];
  for (const tool of ["claude", "codex"] as const) if (await writeHooks(tool, { install: false }).catch(() => false)) removed.push(tool);
  // Windows won't delete a running .exe, and uninstall may be running from BIN_DIR itself.
  await rm(BIN_DIR, { recursive: true, force: true }).catch(() => console.log(`  (borra a mano ${BIN_DIR} si queda algo)`));

  const deleteData =
    purge || (process.stdin.isTTY && prompt(`¿Borrar también tus sesiones fijadas e iconos de ${DATA_DIR}? [s/N]`)?.trim().toLowerCase() === "s");
  if (deleteData) {
    await rm(DATA_DIR, { recursive: true, force: true }).catch(() => null);
    await rm(LOG_DIR, { recursive: true, force: true }).catch(() => null);
  }

  console.log(`Pets IA está desinstalado.
  hooks : ${removed.length > 0 ? `quitados de ${removed.join(" y ")}` : "no estaban"}
  datos : ${deleteData ? "borrados" : `guardados en ${DATA_DIR}`}`);
}
