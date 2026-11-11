import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionSource } from "../../shared/protocol.ts";
import { BIN_DIR, CLAUDE_SETTINGS, CLI_NAME, CODEX_HOOKS } from "./config.ts";
import { hasOurHooks, hookCommand, mergeHooks, type HooksFile } from "./hooks-config.ts";

export const HOOK_FILES: Record<SessionSource, string> = { claude: CLAUDE_SETTINGS, codex: CODEX_HOOKS };

async function read(path: string): Promise<HooksFile> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  const text = (await file.text()).trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON; fix it and run setup again`);
  }
}

/**
 * Adds (install) or removes our hooks in one tool's file, backing it up first.
 * False when nothing changed.
 */
export async function writeHooks(source: SessionSource, { install }: { install: boolean }): Promise<boolean> {
  const path = HOOK_FILES[source];
  const exists = await Bun.file(path).exists();
  const before = await read(path);
  const command = install ? hookCommand(join(BIN_DIR, CLI_NAME), source) : null;
  const after = mergeHooks(before, source, command);
  if (JSON.stringify(after) === JSON.stringify(before)) return false;
  if (exists) await copyFile(path, `${path}.bak-petsia-${Date.now()}`);
  else await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(after, null, 2) + "\n");
  return true;
}

export async function hooksInstalled(source: SessionSource) {
  return hasOurHooks(await read(HOOK_FILES[source]).catch(() => ({})), source);
}
