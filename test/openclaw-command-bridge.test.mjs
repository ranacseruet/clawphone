// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("runSmsSlashCommand handles only exact slash commands against the SMS session key", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "clawphone-command-bridge-"));
  const pluginSdkDir = join(tempDir, "plugin-sdk");
  mkdirSync(pluginSdkDir, { recursive: true });
  writeFileSync(
    join(pluginSdkDir, "commands-registry-test.js"),
    'export const c = (raw) => raw === "/status" ? "/status" : null;\n',
    "utf8",
  );
  writeFileSync(
    join(pluginSdkDir, "reply-test.js"),
    [
      "export const t = async (ctx) => ([",
      '  { text: `handled:${ctx.Body}:${ctx.SessionKey}:${ctx.CommandSource}` },',
      "]);",
      "",
    ].join("\n"),
    "utf8",
  );

  const prevDistRoot = process.env.CLAWPHONE_OPENCLAW_DIST_ROOT;
  process.env.CLAWPHONE_OPENCLAW_DIST_ROOT = tempDir;

  try {
    const bridgeUrl = new URL(`../lib/openclaw-command-bridge.mjs?ts=${Date.now()}`, import.meta.url);
    const { runSmsSlashCommand } = await import(bridgeUrl.href);

    const handled = await runSmsSlashCommand({
      text: "/status",
      sessionKey: "sms:phone",
      from: "+15550000001",
      to: "+15550000002",
    });
    assert.deepEqual(handled, {
      handled: true,
      text: "handled:/status:sms:phone:text",
    });

    const notACommand = await runSmsSlashCommand({
      text: "hello there",
      sessionKey: "sms:phone",
    });
    assert.deepEqual(notACommand, { handled: false });

    const notExact = await runSmsSlashCommand({
      text: "/status please",
      sessionKey: "sms:phone",
    });
    assert.deepEqual(notExact, { handled: false });
  } finally {
    if (prevDistRoot === undefined) delete process.env.CLAWPHONE_OPENCLAW_DIST_ROOT;
    else process.env.CLAWPHONE_OPENCLAW_DIST_ROOT = prevDistRoot;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
