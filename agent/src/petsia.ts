import { runAgent } from "./agent.ts";
import { parseCommand, USAGE } from "./cli.ts";
import { forwardHook } from "./hook.ts";
import { setup, uninstall } from "./install.ts";
import { status } from "./status.ts";

declare const PETSIA_VERSION: string | undefined;
const VERSION = typeof PETSIA_VERSION === "string" ? PETSIA_VERSION : "dev";

const command = parseCommand(process.argv.slice(2));
try {
  switch (command.name) {
    case "hook":
      await forwardHook(command.source);
      process.exit(0);
    case "agent":
      await runAgent();
      break;
    case "setup":
      await setup();
      break;
    case "status":
      await status(VERSION);
      break;
    case "uninstall":
      await uninstall({ purge: command.purge });
      break;
    case "version":
      console.log(VERSION);
      break;
    case "help":
      if (command.error) console.error(`petsia: ${command.error}\n`);
      console.log(USAGE);
      process.exit(command.error ? 1 : 0);
  }
} catch (error) {
  if (command.name === "hook") process.exit(0); // a hook must never fail
  console.error(`petsia: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
