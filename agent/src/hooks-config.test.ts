import { describe, expect, test } from "bun:test";
import { buildHooks, CODEX_EVENTS, hasOurHooks, hookCommand, mergeHooks } from "./hooks-config.ts";

const theirs = { type: "command", command: "echo mine" };
const MAC_BIN = "/Users/me/Library/Application Support/pets-ia/bin/petsia";
const claude = hookCommand(MAC_BIN, "claude", "darwin");
const codex = hookCommand(MAC_BIN, "codex", "darwin");

describe("hookCommand", () => {
  test("quotes the binary for each tool's shell", () => {
    expect(claude).toBe(`'${MAC_BIN}' hook claude`);
    const win = "C:\\Users\\Lucía Cosío\\AppData\\Local\\PetsIA\\bin\\petsia.exe";
    // Claude Code runs hooks in Git Bash: forward slashes, double quotes.
    expect(hookCommand(win, "claude", "win32")).toBe(`"C:/Users/Lucía Cosío/AppData/Local/PetsIA/bin/petsia.exe" hook claude`);
    // Codex uses the native interpreter, which may be PowerShell: go through cmd.
    expect(hookCommand(win, "codex", "win32")).toBe(`cmd.exe /d /s /c ""${win}" hook codex"`);
  });
});

describe("mergeHooks", () => {
  test("install adds every event and keeps the user's hooks and other settings", () => {
    const merged = mergeHooks({ theme: "dark", hooks: { Stop: [{ hooks: [theirs] }] } }, "claude", claude);
    expect(merged.theme).toBe("dark");
    expect(merged.hooks?.Stop).toEqual([{ hooks: [theirs] }, ...buildHooks("claude", claude).Stop!]);
    expect(Object.keys(merged.hooks!).sort()).toEqual(Object.keys(buildHooks("claude", claude)).sort());
  });

  test("Codex gets its own events, PermissionRequest included", () => {
    const merged = mergeHooks({}, "codex", codex);
    expect(Object.keys(merged.hooks!).sort()).toEqual([...CODEX_EVENTS].sort());
    expect(merged.hooks!.PermissionRequest![0]!.hooks[0]!.command).toBe(codex);
  });

  test("installing again, even from another path, changes nothing twice", () => {
    const once = mergeHooks({}, "claude", claude);
    expect(mergeHooks(once, "claude", claude)).toEqual(once);
    const moved = hookCommand("/opt/petsia", "claude", "darwin");
    expect(mergeHooks(once, "claude", moved)).toEqual(mergeHooks({}, "claude", moved));
  });

  test("remove drops only ours, then empty groups, events and the hooks key", () => {
    const installed = mergeHooks({ hooks: { Stop: [{ hooks: [theirs] }] } }, "claude", claude);
    expect(mergeHooks(installed, "claude", null)).toEqual({ hooks: { Stop: [{ hooks: [theirs] }] } });
    expect(mergeHooks(mergeHooks({ model: "opus" }, "claude", claude), "claude", null)).toEqual({ model: "opus" });
  });

  test("each tool's hooks are left alone by the other's", () => {
    const both = mergeHooks(mergeHooks({}, "claude", claude), "codex", codex);
    expect(hasOurHooks(mergeHooks(both, "codex", null), "claude")).toBe(true);
  });
});

test("hasOurHooks", () => {
  expect(hasOurHooks({}, "claude")).toBe(false);
  expect(hasOurHooks({ hooks: { Stop: [{ hooks: [theirs] }] } }, "claude")).toBe(false);
  expect(hasOurHooks(mergeHooks({}, "claude", claude), "claude")).toBe(true);
  expect(hasOurHooks(mergeHooks({}, "claude", claude), "codex")).toBe(false);
});
