// @ts-check
import test from "node:test";
import assert from "node:assert/strict";

import { runSmsSlashCommand } from "../lib/openclaw-command-bridge.mjs";

test("runSmsSlashCommand handles only exact slash commands against the SMS session key", async () => {
  const api = {
    config: { commands: { text: true } },
    runtime: {
      channel: {
        commands: {
          isControlCommandMessage: (raw) => raw === "/status",
          shouldHandleTextCommands: () => true,
        },
        reply: {
          finalizeInboundContext: (ctx) => ({
            ...ctx,
            CommandAuthorized: ctx.CommandAuthorized === true,
          }),
          dispatchReplyWithBufferedBlockDispatcher: async ({ ctx, dispatcherOptions }) => {
            await dispatcherOptions.deliver({
              text: `handled:${ctx.Body}:${ctx.SessionKey}:${ctx.CommandSource}`,
            });
          },
        },
      },
    },
  };

  const handled = await runSmsSlashCommand({
    text: "/status",
    sessionKey: "sms:phone",
    from: "+15550000001",
    to: "+15550000002",
    _api: api,
  });
  assert.deepEqual(handled, {
    handled: true,
    text: "handled:/status:sms:phone:text",
  });

  const notACommand = await runSmsSlashCommand({
    text: "hello there",
    sessionKey: "sms:phone",
    _api: api,
  });
  assert.deepEqual(notACommand, { handled: false });

  const notExact = await runSmsSlashCommand({
    text: "/status please",
    sessionKey: "sms:phone",
    _api: api,
  });
  assert.deepEqual(notExact, { handled: false });
});
