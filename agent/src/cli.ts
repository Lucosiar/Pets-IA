export type Command =
  | { name: "agent" }
  | { name: "hook"; source: "claude" | "codex" }
  | { name: "setup" }
  | { name: "status" }
  | { name: "uninstall"; purge: boolean }
  | { name: "version" }
  | { name: "help"; error?: string };

export const USAGE = `Uso: petsia <comando>

  setup                instala el agente, la tira y los hooks de Claude Code y Codex, y los arranca
  status               muestra qué está instalado y en marcha
  uninstall [--purge]  lo quita todo; --purge borra también fijados e iconos sin preguntar
  agent                ejecuta el agente en primer plano (lo que arranca el sistema)
  hook <claude|codex>  reenvía un evento de hook al agente (lo usan los hooks)
  version              muestra la versión`;

export function parseCommand(args: string[]): Command {
  const [name, ...rest] = args;
  if (name === undefined || name === "help" || name === "--help" || name === "-h") return { name: "help" };
  if (name === "version" || name === "--version" || name === "-v") return { name: "version" };
  const extra = (allowed: string[]) => rest.find((arg) => !allowed.includes(arg));

  switch (name) {
    case "agent":
    case "setup":
    case "status": {
      const bad = extra([]);
      return bad ? { name: "help", error: `opción desconocida para ${name}: ${bad}` } : { name };
    }
    case "uninstall": {
      const bad = extra(["--purge"]);
      return bad ? { name: "help", error: `opción desconocida para uninstall: ${bad}` } : { name, purge: rest.includes("--purge") };
    }
    case "hook": {
      const [source, ...more] = rest;
      if ((source === "claude" || source === "codex") && more.length === 0) return { name, source };
      return { name: "help", error: "uso: petsia hook <claude|codex>" };
    }
    default:
      return { name: "help", error: `comando desconocido: ${name}` };
  }
}
