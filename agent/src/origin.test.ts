import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { claudeOriginForPid, codexOrigin, firstPrompt, originFromEntrypoint, parseCodexMeta, readCodexMeta } from "./origin.ts";

const META = (payload: Record<string, unknown>) =>
  JSON.stringify({ timestamp: "2026-04-20T16:44:37.772Z", type: "session_meta", payload: { id: "019dabc6-8fef-7681-a054-b5bb75fcb97d", timestamp: "2026-04-20T16:43:30.171Z", cwd: "/tmp/proj", ...payload } });

test("Claude entrypoints", () => {
  expect(originFromEntrypoint("cli")).toBe("terminal");
  expect(originFromEntrypoint("claude-vscode")).toBe("vscode");
  expect(originFromEntrypoint("claude-desktop")).toBe("desktop");
  expect(originFromEntrypoint(undefined)).toBeUndefined();
});

test("Claude's per-process file", async () => {
  const dir = mkdtempSync(`${tmpdir()}/petsia-live-`);
  try {
    writeFileSync(`${dir}/42.json`, JSON.stringify({ pid: 42, sessionId: "x", entrypoint: "claude-vscode" }));
    expect(await claudeOriginForPid(42, dir)).toBe("vscode");
    expect(await claudeOriginForPid(43, dir)).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codex originators", () => {
  expect(codexOrigin({ originator: "codex_cli_rs", source: "cli" })).toBe("terminal");
  expect(codexOrigin({ originator: "codex-tui", source: "cli" })).toBe("terminal");
  expect(codexOrigin({ originator: "codex_vscode", source: "vscode" })).toBe("vscode");
  // The app talks to Codex like an IDE does, so its originator must win over source.
  expect(codexOrigin({ originator: "Codex Desktop", source: "vscode" })).toBe("app");
});

test("Codex session_meta, whole or cut off", async () => {
  const line = META({ originator: "codex_vscode", source: "vscode" });
  expect(parseCodexMeta(`${line}\n{"type":"event_msg"}`)).toEqual({
    id: "019dabc6-8fef-7681-a054-b5bb75fcb97d",
    cwd: "/tmp/proj",
    originator: "codex_vscode",
    source: "vscode",
    startedAt: Date.parse("2026-04-20T16:43:30.171Z"),
  });
  // A first line longer than the head we read: fields still come out of the text.
  const cut = META({ originator: "codex-tui", source: "cli", instructions: "x".repeat(100) }).slice(0, -20);
  expect(parseCodexMeta(cut)).toMatchObject({ id: "019dabc6-8fef-7681-a054-b5bb75fcb97d", originator: "codex-tui" });
  expect(parseCodexMeta("garbage")).toBeNull();
  expect(await readCodexMeta("/no/such/file.jsonl")).toBeNull();
});

test("first prompt as a title", () => {
  const head = [
    META({}),
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "  arregla   el login\n" } }),
  ].join("\n");
  expect(firstPrompt(head)).toBe("arregla el login");
  expect(firstPrompt(META({}))).toBeNull();
});
