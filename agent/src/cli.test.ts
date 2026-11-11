import { expect, test } from "bun:test";
import { parseCommand } from "./cli.ts";

test("subcommands and their flags", () => {
  expect(parseCommand(["agent"])).toEqual({ name: "agent" });
  expect(parseCommand(["setup"])).toEqual({ name: "setup" });
  expect(parseCommand(["status"])).toEqual({ name: "status" });
  expect(parseCommand(["uninstall"])).toEqual({ name: "uninstall", purge: false });
  expect(parseCommand(["uninstall", "--purge"])).toEqual({ name: "uninstall", purge: true });
  expect(parseCommand(["hook", "claude"])).toEqual({ name: "hook", source: "claude" });
  expect(parseCommand(["hook", "codex"])).toEqual({ name: "hook", source: "codex" });
  expect(parseCommand(["--version"])).toEqual({ name: "version" });
  expect(parseCommand(["version"])).toEqual({ name: "version" });
});

test("no command, --help and mistakes show the usage", () => {
  expect(parseCommand([])).toEqual({ name: "help" });
  expect(parseCommand(["--help"])).toEqual({ name: "help" });
  expect(parseCommand(["install"])).toEqual({ name: "help", error: "comando desconocido: install" });
  expect(parseCommand(["setup", "--lan"])).toEqual({ name: "help", error: "opción desconocida para setup: --lan" });
  expect(parseCommand(["hook", "gemini"])).toMatchObject({ name: "help" });
});
