import { afterEach, expect, test } from "bun:test";
import { forwardHook } from "./hook.ts";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => server?.stop(true));

test("forwards the event with its tool and Claude's entrypoint", async () => {
  const got: unknown[] = [];
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => (got.push(await req.json()), new Response(null, { status: 204 })) });
  process.env.CLAUDE_CODE_ENTRYPOINT = "claude-vscode";
  await forwardHook("claude", JSON.stringify({ hook_event_name: "Stop", session_id: "s" }), server.port);
  delete process.env.CLAUDE_CODE_ENTRYPOINT;
  expect(got).toEqual([{ hook_event_name: "Stop", session_id: "s", _source: "claude", _entrypoint: "claude-vscode" }]);
});

test("never throws: bad input or no agent", async () => {
  await forwardHook("codex", "not json", 1);
  await forwardHook("codex", JSON.stringify({ a: 1 }), 1);
});
