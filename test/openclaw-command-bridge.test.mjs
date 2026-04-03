// @ts-check
import test from "node:test";
import assert from "node:assert/strict";

import { runSmsSlashCommand } from "../lib/openclaw-command-bridge.mjs";

test("runSmsSlashCommand handles only exact slash commands against the SMS session key", async () => {
  /**
   * Build a minimal _api mock that mirrors what the new implementation uses:
   * createReplyDispatcherWithTyping + withReplyDispatcher + dispatchReplyFromConfig.
   */
  function makeApi() {
    return {
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
            /**
             * Minimal stand-in: returns the three lifecycle markers and a deliver
             * wrapper so withReplyDispatcher can call run().
             */
            createReplyDispatcherWithTyping: ({ deliver }) => {
              let idle = false;
              let done = false;
              const dispatcher = {
                deliver,
                isIdle: () => idle,
                isDone: () => done,
              };
              return {
                dispatcher,
                replyOptions: {},
                markDispatchIdle: () => { idle = true; },
                markRunComplete: () => { done = true; },
              };
            },
            withReplyDispatcher: async ({ run }) => {
              await run();
            },
            /**
             * Simulate executing the command and delivering a reply that proves
             * ctx, cfg (configOverride), and CommandSource all flow through.
             */
            dispatchReplyFromConfig: async ({ ctx, configOverride, dispatcher }) => {
              const ownerList = JSON.stringify(configOverride?.commands?.ownerAllowFrom ?? []);
              const allowFrom = JSON.stringify(configOverride?.commands?.allowFrom);
              await dispatcher.deliver({
                text: `handled:${ctx.Body}:${ctx.SessionKey}:${ctx.CommandSource}:${ownerList}:${allowFrom}`,
              });
            },
          },
        },
      },
    };
  }

  const api = makeApi();

  const handled = await runSmsSlashCommand({
    text: "/status",
    sessionKey: "sms:phone",
    from: "+15550000001",
    to: "+15550000002",
    _api: api,
  });
  assert.deepEqual(handled, {
    handled: true,
    text: 'handled:/status:sms:phone:text:["*"]:null',  // null removes allowFrom via merge patch
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

test("runSmsSlashCommand throws when runtime helpers are missing", async () => {
  const apiNoCommands = {
    config: {},
    runtime: { channel: { commands: {}, reply: {} } },
  };
  await assert.rejects(
    () => runSmsSlashCommand({ text: "/status", sessionKey: "k", _api: apiNoCommands }),
    /OpenClaw runtime missing command detection helpers/
  );

  const apiNoReply = {
    config: { commands: { text: true } },
    runtime: {
      channel: {
        commands: {
          isControlCommandMessage: () => true,
          shouldHandleTextCommands: () => true,
        },
        reply: {
          finalizeInboundContext: () => ({}),
          // missing createReplyDispatcherWithTyping / withReplyDispatcher / dispatchReplyFromConfig
        },
      },
    },
  };
  await assert.rejects(
    () => runSmsSlashCommand({ text: "/status", sessionKey: "k", _api: apiNoReply }),
    /OpenClaw runtime missing reply dispatch helpers/
  );
});
