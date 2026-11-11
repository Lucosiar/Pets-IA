import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { SessionRecord } from "./state.ts";
import { Store } from "./store.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDb() {
  const dir = mkdtempSync(`${tmpdir()}/petsia-store-`);
  dirs.push(dir);
  return `${dir}/petsia.db`;
}

const codex: SessionRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  source: "codex",
  origin: "vscode",
  name: "pinned and closed",
  cwd: "/src",
  state: "ended",
  activity: null,
  live: false,
  pid: null,
  stateSince: 5,
  lastEventAt: 5,
};

test("sessions keep their source and origin across restarts", () => {
  const path = tempDb();
  const first = new Store(path);
  first.saveSession(codex);
  first.close();
  const again = new Store(path);
  expect(again.loadSessions()).toEqual([codex]);
  again.close();
});

test("pins keep their order and icon; pinning with an icon uses it", () => {
  const store = new Store();
  store.pin("a", { character: "default", color: "#4f7cff" });
  store.pin("b");
  store.pin("a"); // no-op
  store.setIcon("b", { character: "cat", color: "#ff5fa2" });
  expect([...store.loadPins().values()]).toEqual([
    { sessionId: "a", position: 0, icon: { character: "default", color: "#4f7cff" } },
    { sessionId: "b", position: 1, icon: { character: "cat", color: "#ff5fa2" } },
  ]);
  store.unpin("a");
  expect([...store.loadPins().keys()]).toEqual(["b"]);
});
