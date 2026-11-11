/**
 * SQLite persistence. Observed session state and the user's pins live in separate
 * tables: the first can be rebuilt from Claude at any time, the second cannot.
 */
import { Database } from "bun:sqlite";
import { DEFAULT_ICON, type SessionIcon, type SessionOrigin, type SessionSource, type SessionState } from "../../shared/protocol.ts";
import type { SessionRecord } from "./state.ts";

export interface Pin {
  sessionId: string;
  position: number;
  icon: SessionIcon;
}

interface SessionRow {
  id: string;
  source: string;
  origin: string;
  name: string | null;
  cwd: string;
  state: string;
  activity: string | null;
  live: number;
  pid: number | null;
  state_since: number;
  last_event_at: number;
}

interface PinRow {
  session_id: string;
  position: number;
  character: string;
  color: string;
}

export class Store {
  private db: Database;

  /** `path` may be ":memory:". */
  constructor(path = ":memory:") {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        source        TEXT NOT NULL DEFAULT 'claude',
        origin        TEXT NOT NULL DEFAULT 'terminal',
        name          TEXT,
        cwd           TEXT NOT NULL,
        state         TEXT NOT NULL,
        activity      TEXT,
        live          INTEGER NOT NULL,
        pid           INTEGER,
        state_since   INTEGER NOT NULL,
        last_event_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pins (
        session_id TEXT PRIMARY KEY,
        position   INTEGER NOT NULL,
        character  TEXT NOT NULL,
        color      TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  loadSessions(): SessionRecord[] {
    return this.db
      .query<SessionRow, []>("SELECT * FROM sessions")
      .all()
      .map((r) => ({
        id: r.id,
        source: (r.source === "codex" ? "codex" : "claude") as SessionSource,
        origin: (["desktop", "vscode", "app"].includes(r.origin) ? r.origin : "terminal") as SessionOrigin,
        name: r.name,
        cwd: r.cwd,
        state: r.state as SessionState,
        activity: r.activity,
        live: r.live === 1,
        pid: r.pid,
        stateSince: r.state_since,
        lastEventAt: r.last_event_at,
      }));
  }

  saveSession(s: SessionRecord) {
    this.db
      .query(
        `INSERT INTO sessions (id, source, origin, name, cwd, state, activity, live, pid, state_since, last_event_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source = excluded.source, origin = excluded.origin, name = excluded.name, cwd = excluded.cwd, state = excluded.state, activity = excluded.activity,
           live = excluded.live, pid = excluded.pid, state_since = excluded.state_since,
           last_event_at = excluded.last_event_at`,
      )
      .run(s.id, s.source, s.origin, s.name, s.cwd, s.state, s.activity, s.live ? 1 : 0, s.pid, s.stateSince, s.lastEventAt);
  }

  deleteSession(id: string) {
    this.db.query("DELETE FROM sessions WHERE id = ?").run(id);
  }

  loadPins(): Map<string, Pin> {
    const rows = this.db.query<PinRow, []>("SELECT * FROM pins ORDER BY position").all();
    return new Map(
      rows.map((r) => [r.session_id, { sessionId: r.session_id, position: r.position, icon: { character: r.character, color: r.color } }]),
    );
  }

  /** Appends to the pin order with `icon`; no-op if already pinned. */
  pin(sessionId: string, icon: SessionIcon = DEFAULT_ICON) {
    this.db
      .query(
        `INSERT OR IGNORE INTO pins (session_id, position, character, color, created_at)
         VALUES (?, (SELECT COALESCE(MAX(position) + 1, 0) FROM pins), ?, ?, ?)`,
      )
      .run(sessionId, icon.character, icon.color, Date.now());
  }

  unpin(sessionId: string) {
    this.db.query("DELETE FROM pins WHERE session_id = ?").run(sessionId);
  }

  /** Pins the session if it isn't yet, then sets its icon. */
  setIcon(sessionId: string, icon: SessionIcon) {
    this.db
      .query(
        `INSERT INTO pins (session_id, position, character, color, created_at)
         VALUES (?, (SELECT COALESCE(MAX(position) + 1, 0) FROM pins), ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET character = excluded.character, color = excluded.color`,
      )
      .run(sessionId, icon.character, icon.color, Date.now());
  }

  close() {
    this.db.close();
  }
}
