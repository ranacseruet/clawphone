// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert";

import plugin from "../index.mjs";
import { fromPluginConfig } from "../lib/config.mjs";

describe("plugin manifest", () => {
  it("has correct id", () => {
    assert.strictEqual(plugin.id, "clawphone");
  });

  it("has a name string", () => {
    assert.strictEqual(typeof plugin.name, "string");
    assert.ok(plugin.name.length > 0);
  });

  it("exposes a register function", () => {
    assert.strictEqual(typeof plugin.register, "function");
  });

  it("register calls api.registerService with a name and start function", () => {
    let captured = null;
    plugin.register({
      registerService(config) { captured = config; },
    });
    assert.ok(captured, "registerService should have been called");
    assert.strictEqual(captured.name, "clawphone");
    assert.strictEqual(typeof captured.start, "function");
  });
});

describe("fromPluginConfig", () => {
  it("maps camelCase plugin config to SCREAMING_SNAKE_CASE shape", () => {
    const cfg = fromPluginConfig({
      port: 9000,
      twilioAccountSid: "ACtest",
      twilioAuthToken: "token",
      allowFrom: ["+15551234567"],
      publicBaseUrl: "https://example.com",
      smsMaxChars: 160,
      smsFastTimeoutMs: 5000,
      discordLogChannelId: "chan123",
      openclawSessionId: "my-session",
      openclawAgentId: "my-agent",
      openclawMaxConcurrent: 5,
    });

    assert.strictEqual(cfg.PORT, 9000);
    assert.deepStrictEqual(cfg.ALLOW_FROM, ["+15551234567"]);
    assert.strictEqual(cfg.TWILIO_ACCOUNT_SID, "ACtest");
    assert.strictEqual(cfg.TWILIO_AUTH_TOKEN, "token");
    assert.strictEqual(cfg.PUBLIC_BASE_URL, "https://example.com");
    assert.strictEqual(cfg.SMS_MAX_CHARS, 160);
    assert.strictEqual(cfg.SMS_FAST_TIMEOUT_MS, 5000);
    assert.strictEqual(cfg.DISCORD_LOG_CHANNEL_ID, "chan123");
    assert.strictEqual(cfg.OPENCLAW_PHONE_SESSION_ID, "my-session");
    assert.strictEqual(cfg.OPENCLAW_AGENT_ID, "my-agent");
    assert.strictEqual(cfg.OPENCLAW_MAX_CONCURRENT, 5);
  });

  it("applies all defaults for an empty config object", () => {
    const cfg = fromPluginConfig({});
    assert.strictEqual(cfg.PORT, 8787);
    assert.deepStrictEqual(cfg.ALLOW_FROM, []);
    assert.strictEqual(cfg.TWILIO_ACCOUNT_SID, "");
    assert.strictEqual(cfg.TWILIO_AUTH_TOKEN, "");
    assert.strictEqual(cfg.PUBLIC_BASE_URL, "");
    assert.strictEqual(cfg.SMS_MAX_CHARS, 280);
    assert.strictEqual(cfg.SMS_FAST_TIMEOUT_MS, 15000);
    assert.strictEqual(cfg.OPENCLAW_PHONE_SESSION_ID, "phone");
    assert.strictEqual(cfg.OPENCLAW_AGENT_ID, "phone");
    assert.strictEqual(cfg.OPENCLAW_MAX_CONCURRENT, 10);
  });

  it("includes static constants", () => {
    const cfg = fromPluginConfig({});
    assert.strictEqual(cfg.TWILIO_VOICE, "Google.en-US-Chirp3-HD-Charon");
    assert.strictEqual(cfg.MAX_SAYABLE_LENGTH, 600);
    assert.strictEqual(cfg.OPENCLAW_TIMEOUT_SECONDS, 120);
    assert.ok(Array.isArray(cfg.THINKING_PHRASES));
    assert.ok(cfg.THINKING_PHRASES.length > 0);
    assert.strictEqual(typeof cfg.getRandomThinkingPhrase, "function");
    assert.ok(cfg.THINKING_PHRASES.includes(cfg.getRandomThinkingPhrase()));
  });
});
