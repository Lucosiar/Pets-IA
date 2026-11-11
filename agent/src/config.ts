/**
 * Where Pets IA and the tools it watches live on disk, per platform. The data dir holds
 * config.json with the pairing token (created on first run, mode 600 on macOS), petsia.db the
 * SQLite store, and bin/ the installed binaries. Both overlays read the token from here too
 * (Sources/PetsCore/AgentConfig.swift, windows/PetsIA/AgentConfig.cs).
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOOK_PORT = 7787;
export const IS_WINDOWS = process.platform === "win32";
export const IS_MAC = process.platform === "darwin";

const HOME = homedir();
const env = (name: string, fallback: string) => process.env[name] || fallback;
/** %LOCALAPPDATA% and %APPDATA% on Windows. */
const LOCAL_APPDATA = env("LOCALAPPDATA", join(HOME, "AppData", "Local"));
const ROAMING_APPDATA = env("APPDATA", join(HOME, "AppData", "Roaming"));

export const DATA_DIR = IS_WINDOWS ? join(LOCAL_APPDATA, "PetsIA") : join(HOME, "Library", "Application Support", "pets-ia");
export const BIN_DIR = join(DATA_DIR, "bin");
export const LOG_DIR = IS_WINDOWS ? join(DATA_DIR, "logs") : join(HOME, "Library", "Logs", "pets-ia");
export const CONFIG_FILE = join(DATA_DIR, "config.json");

/** The `petsia` binary's file name. */
export const CLI_NAME = IS_WINDOWS ? "petsia.exe" : "petsia";

// ── Claude Code ─────────────────────────────────────────────────────────────
export const CLAUDE_HOME = join(HOME, ".claude");
export const CLAUDE_SETTINGS = join(CLAUDE_HOME, "settings.json");
/** The CLI's internal `<pid>.json` per running process; holds `entrypoint`. */
export const CLAUDE_LIVE_DIR = join(CLAUDE_HOME, "sessions");
/** The Claude desktop app's data folder (Electron userData). */
const CLAUDE_APP_DIR = IS_WINDOWS ? join(ROAMING_APPDATA, "Claude") : join(HOME, "Library", "Application Support", "Claude");
export const DESKTOP_SESSIONS_DIR = join(CLAUDE_APP_DIR, "claude-code-sessions");
export const CLAUDE_APP_LOG = IS_WINDOWS ? join(CLAUDE_APP_DIR, "logs", "main.log") : join(HOME, "Library", "Logs", "Claude", "main.log");

// ── Codex ───────────────────────────────────────────────────────────────────
export const CODEX_HOME = env("CODEX_HOME", join(HOME, ".codex"));
export const CODEX_HOOKS = join(CODEX_HOME, "hooks.json");
export const CODEX_SESSIONS_DIR = join(CODEX_HOME, "sessions");

export interface Config {
  dataDir: string;
  dbPath: string;
  token: string;
}

export async function loadConfig(): Promise<Config> {
  await mkdir(DATA_DIR, { recursive: true });
  const file = Bun.file(CONFIG_FILE);
  const saved: { token?: string } = (await file.exists()) ? await file.json().catch(() => ({})) : {};

  if (!saved.token) {
    saved.token = randomBytes(24).toString("base64url");
    await Bun.write(CONFIG_FILE, JSON.stringify(saved, null, 2) + "\n");
    if (!IS_WINDOWS) await chmod(CONFIG_FILE, 0o600);
  }

  return { dataDir: DATA_DIR, dbPath: join(DATA_DIR, "petsia.db"), token: saved.token };
}
