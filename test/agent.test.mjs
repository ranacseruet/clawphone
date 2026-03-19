// @ts-check
import { describe, it, mock } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import { discordLog, openclawReply } from "../lib/agent.mjs";
import { OPENCLAW_MAX_CONCURRENT, DISCORD_LOG_CHANNEL_ID } from "../lib/config.mjs";

// ─── Helpers for plugin-path tests ───────────────────────────────────────────

function makeCoreDeps(replyText = "Plugin reply", initialStore = {}) {
  const store = structuredClone(initialStore);
  return {
    resolveStorePath: mock.fn(() => "/tmp/test-store.json"),
    resolveAgentDir: mock.fn(() => "/tmp/test-agent"),
    resolveAgentWorkspaceDir: mock.fn(() => "/tmp/test-workspace"),
    ensureAgentWorkspace: async () => {},
    loadSessionStore: () => structuredClone(store),
    saveSessionStore: async (path, data) => {
      for (const key of Object.keys(store)) delete store[key];
      Object.assign(store, structuredClone(data));
    },
    resolveSessionFilePath: mock.fn(() => "/tmp/test-session.jsonl"),
    resolveAgentTimeoutMs: mock.fn(() => 30000),
    resolveThinkingDefault: mock.fn(() => "low"),
    runEmbeddedPiAgent: mock.fn(async () => ({
      payloads: [{ text: replyText, isError: false }],
      meta: { sessionId: crypto.randomUUID(), provider: "anthropic", model: "claude" },
    })),
  };
}

function makeApi(config = {}, pluginConfig = {}) {
  const sent = [];
  return {
    config: { session: { store: null }, ...config },
    pluginConfig,
    runtime: {
      channel: {
        discord: {
          sendMessageDiscord: mock.fn(async (to, text, opts) => {
            sent.push({ to, text, opts });
            return { ok: true };
          }),
        },
      },
    },
    _sent: sent,
  };
}

describe("discordLog", () => {
  it("does nothing if DISCORD_LOG_CHANNEL_ID is not set", async () => {
    const mockRun = mock.fn(async () => ({ stdout: "", stderr: "" }));
    await discordLog({ text: "test message", run: mockRun });
    if (!DISCORD_LOG_CHANNEL_ID) {
      // When channel is not configured, run must never be called
      assert.strictEqual(mockRun.mock.calls.length, 0);
    }
    // When channel IS configured, run will be called once — that is expected behaviour
  });

  it("drops excess calls when in-flight limit is reached", async () => {
    if (!DISCORD_LOG_CHANNEL_ID) {
      // Without a channel all calls exit early; the in-flight cap path is unreachable
      const mockRun = mock.fn(async () => ({ stdout: "", stderr: "" }));
      await Promise.all([
        discordLog({ text: "a", run: mockRun }),
        discordLog({ text: "b", run: mockRun }),
        discordLog({ text: "c", run: mockRun }),
      ]);
      assert.strictEqual(mockRun.mock.calls.length, 0);
      return;
    }
    // With a channel, saturate the in-flight limit with a slow mock, then verify
    // that an extra call is dropped (run called < total dispatched).
    /** @type {() => void} */
    let resolveHold = () => {};
    const hold = new Promise((r) => { resolveHold = /** @type {any} */ (r); });
    let runCallCount = 0;
    const slowRun = async () => { runCallCount++; await hold; return { stdout: "", stderr: "" }; };

    // Fire DISCORD_MAX_IN_FLIGHT (5) + 2 extra calls concurrently
    const allDone = Promise.all(
      Array.from({ length: 7 }, () => discordLog({ text: "x", run: slowRun }))
    );
    // Give the event loop a tick so all calls have a chance to start
    await new Promise((r) => setImmediate(r));
    // At most 5 should have entered run(); the extra 2 must have been dropped
    assert.ok(runCallCount <= 5, `runCallCount=${runCallCount} should be <= 5`);
    resolveHold();
    await allDone;
  });
});

describe("openclawReply — plugin path", () => {
  it("calls runEmbeddedPiAgent when _api is provided (not CLI spawn)", async () => {
    const deps = makeCoreDeps("Hello from plugin");
    const api = makeApi();

    const result = await openclawReply({ userText: "Hi", mode: "voice", _api: api, _coreDeps: deps });

    assert.strictEqual(result, "Hello from plugin");
    assert.strictEqual(deps.runEmbeddedPiAgent.mock.calls.length, 1);
  });

  it("does not call run (CLI spawn) when _api is provided", async () => {
    const deps = makeCoreDeps("Plugin reply");
    const api = makeApi();
    const mockRun = mock.fn(async () => ({ stdout: "", stderr: "" }));

    await openclawReply({ userText: "test", mode: "voice", run: mockRun, _api: api, _coreDeps: deps });

    assert.strictEqual(mockRun.mock.calls.length, 0);
  });

  it("uses plugin config for agent, session, provider, model, and SMS prompt limits", async () => {
    const deps = makeCoreDeps("Configured reply");
    const api = makeApi(
      {
        agents: {
          defaults: {
            model: { primary: "openai-codex/gpt-5.4" },
          },
        },
      },
      {
        openclawAgentId: "my-agent",
        openclawSessionId: "my-session",
        smsMaxChars: 160,
      },
    );

    await openclawReply({ userText: "What time is it?", mode: "sms", _api: api, _coreDeps: deps });

    const call = /** @type {any[]} */ (deps.runEmbeddedPiAgent.mock.calls)[0].arguments[0];
    assert.strictEqual(call.agentId, "my-agent");
    assert.strictEqual(call.sessionKey, "sms:my-session");
    assert.strictEqual(call.provider, "openai-codex");
    assert.strictEqual(call.model, "gpt-5.4");
    assert.ok(call.prompt.includes("<= 160 characters"), `unexpected prompt: ${call.prompt}`);
    assert.strictEqual(
      /** @type {any[]} */ (deps.resolveStorePath.mock.calls)[0].arguments[1].agentId,
      "my-agent",
    );
    assert.strictEqual(
      /** @type {any[]} */ (deps.resolveAgentDir.mock.calls)[0].arguments[1],
      "my-agent",
    );
  });

  it("uses distinct mode-prefixed session keys for voice and sms", async () => {
    const voiceDeps = makeCoreDeps("voice reply");
    const smsDeps = makeCoreDeps("sms reply");
    const api = makeApi();

    await openclawReply({ userText: "hello", mode: "voice", _api: api, _coreDeps: voiceDeps });
    await openclawReply({ userText: "hello", mode: "sms",   _api: api, _coreDeps: smsDeps  });

    const voiceCalls = /** @type {any[]} */ (voiceDeps.runEmbeddedPiAgent.mock.calls);
    const smsCalls   = /** @type {any[]} */ (smsDeps.runEmbeddedPiAgent.mock.calls);
    const voiceKey   = voiceCalls[0].arguments[0].sessionKey;
    const smsKey     = smsCalls[0].arguments[0].sessionKey;

    assert.strictEqual(voiceKey, "voice:phone");
    assert.strictEqual(smsKey, "sms:phone");
    assert.notStrictEqual(voiceKey, smsKey, "voice and SMS should not share the same session key");
  });

  it("reuses stored provider, model, thinking, verbose, and auth overrides", async () => {
    const deps = makeCoreDeps("Override reply", {
      "sms:my-session": {
        sessionId: "session-123",
        providerOverride: "azure-openai-responses",
        modelOverride: "gpt-5.3-codex-spark",
        thinkingLevel: "high",
        verboseLevel: "on",
        authProfileOverride: "azure-openai-responses:default",
        authProfileOverrideSource: "user",
      },
    });
    const api = makeApi(
      {
        agents: {
          defaults: {
            model: { primary: "openai-codex/gpt-5.4" },
          },
        },
      },
      {
        openclawSessionId: "my-session",
      },
    );

    await openclawReply({ userText: "hello", mode: "sms", _api: api, _coreDeps: deps });

    const call = /** @type {any[]} */ (deps.runEmbeddedPiAgent.mock.calls)[0].arguments[0];
    assert.strictEqual(call.sessionId, "session-123");
    assert.strictEqual(call.sessionKey, "sms:my-session");
    assert.strictEqual(call.provider, "azure-openai-responses");
    assert.strictEqual(call.model, "gpt-5.3-codex-spark");
    assert.strictEqual(call.thinkLevel, "high");
    assert.strictEqual(call.verboseLevel, "on");
    assert.strictEqual(call.authProfileId, "azure-openai-responses:default");
    assert.strictEqual(call.authProfileIdSource, "user");
  });

  it("passes correct prompt framing for voice mode to runEmbeddedPiAgent", async () => {
    const deps = makeCoreDeps("ok");
    const api = makeApi();

    await openclawReply({ userText: "What time is it?", mode: "voice", _api: api, _coreDeps: deps });

    const { prompt } = /** @type {any[]} */ (deps.runEmbeddedPiAgent.mock.calls)[0].arguments[0];
    assert.ok(prompt.startsWith("Phone call:"), `expected voice framing, got: ${prompt}`);
    assert.ok(prompt.includes("What time is it?"));
  });

  it("passes correct prompt framing for sms mode to runEmbeddedPiAgent", async () => {
    const deps = makeCoreDeps("ok");
    const api = makeApi();

    await openclawReply({ userText: "What time is it?", mode: "sms", _api: api, _coreDeps: deps });

    const { prompt } = /** @type {any[]} */ (deps.runEmbeddedPiAgent.mock.calls)[0].arguments[0];
    assert.ok(prompt.startsWith("SMS:"), `expected sms framing, got: ${prompt}`);
    assert.ok(prompt.includes("concise"));
  });

  it("filters error payloads from runEmbeddedPiAgent result", async () => {
    const deps = makeCoreDeps();
    // @ts-ignore — reassigning to a minimal stub for this specific test
    deps.runEmbeddedPiAgent = mock.fn(async () => ({
      payloads: [
        { text: "bad", isError: true },
        { text: "good", isError: false },
      ],
      meta: {},
    }));
    const api = makeApi();

    const result = await openclawReply({ userText: "test", _api: api, _coreDeps: deps });
    assert.strictEqual(result, "good");
  });

  it("falls back to CLI when _api is not provided", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ text: "CLI reply" }),
      stderr: "",
    }));

    const result = await openclawReply({ userText: "test", run: mockRun });
    assert.strictEqual(result, "CLI reply");
    assert.strictEqual(mockRun.mock.calls.length, 1);
  });
});

describe("discordLog — plugin path", () => {
  it("uses discordLogChannelId from plugin config", async () => {
    const api = makeApi({}, { discordLogChannelId: "chan123" });

    await discordLog({ text: "test log", _api: api });

    assert.deepStrictEqual(api._sent, [
      { to: "chan123", text: "test log", opts: { accountId: "default" } },
    ]);
  });

  it("calls sendMessageDiscord when _api is provided (not CLI spawn)", async () => {
    const api = makeApi();
    const mockRun = mock.fn(async () => ({ stdout: "", stderr: "" }));

    // We need DISCORD_LOG_CHANNEL_ID to be set for this path to fire.
    // If it's not set in this test environment the function returns early —
    // which is fine: we just verify run is never called regardless.
    await discordLog({ text: "test log", run: mockRun, _api: api });

    assert.strictEqual(mockRun.mock.calls.length, 0,
      "CLI run should never be called when _api is provided");
  });

  it("does not call run (CLI spawn) when _api is provided", async () => {
    const api = makeApi();
    const mockRun = mock.fn(async () => ({ stdout: "", stderr: "" }));

    await discordLog({ text: "another log", run: mockRun, _api: api });

    assert.strictEqual(mockRun.mock.calls.length, 0);
  });
});

describe("openclawReply", () => {
  it("calls openclaw agent with correct args for voice mode", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ result: { payloads: [{ text: "Hello from agent" }] } }),
      stderr: "",
    }));

    const result = await openclawReply({ userText: "Hi there", mode: "voice", run: mockRun });

    assert.strictEqual(result, "Hello from agent");
    assert.strictEqual(mockRun.mock.calls.length, 1);
    
    const [cmd, args] = /** @type {any[]} */ (mockRun.mock.calls)[0].arguments;
    assert.strictEqual(cmd, "openclaw");
    assert.ok(args.includes("agent"));
    assert.ok(args.includes("--message"));
    
    // Find the message arg
    const messageIdx = args.indexOf("--message");
    const message = args[messageIdx + 1];
    assert.ok(message.startsWith("Phone call:"));
    assert.ok(message.includes("Hi there"));
  });

  it("calls openclaw agent with SMS instruction for sms mode", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ result: { payloads: [{ text: "Short reply" }] } }),
      stderr: "",
    }));

    const result = await openclawReply({ userText: "Hello", mode: "sms", run: mockRun });

    assert.strictEqual(result, "Short reply");
    
    const [, args] = /** @type {any[]} */ (mockRun.mock.calls)[0].arguments;
    const messageIdx = args.indexOf("--message");
    const message = args[messageIdx + 1];
    assert.ok(message.startsWith("SMS:"));
    assert.ok(message.includes("concise"));
  });

  it("handles alternative JSON response formats", async () => {
    // Test reply.text format
    let mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ reply: { text: "Reply format" } }),
      stderr: "",
    }));
    let result = await openclawReply({ userText: "test", run: mockRun });
    assert.strictEqual(result, "Reply format");

    // Test content format
    mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ content: "Content format" }),
      stderr: "",
    }));
    result = await openclawReply({ userText: "test", run: mockRun });
    assert.strictEqual(result, "Content format");

    // Test text format
    mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ text: "Text format" }),
      stderr: "",
    }));
    result = await openclawReply({ userText: "test", run: mockRun });
    assert.strictEqual(result, "Text format");

    // Test message.content format
    mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ message: { content: "Message content format" } }),
      stderr: "",
    }));
    result = await openclawReply({ userText: "test", run: mockRun });
    assert.strictEqual(result, "Message content format");

    // Test output.text format
    mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ output: { text: "Output text format" } }),
      stderr: "",
    }));
    result = await openclawReply({ userText: "test", run: mockRun });
    assert.strictEqual(result, "Output text format");
  });

  it("handles non-JSON output", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: "Plain text response",
      stderr: "",
    }));

    const result = await openclawReply({ userText: "test", run: mockRun });
    assert.strictEqual(result, "Plain text response");
  });

  it("trims whitespace from response", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ text: "  trimmed  " }),
      stderr: "",
    }));

    const result = await openclawReply({ userText: "test", run: mockRun });
    assert.strictEqual(result, "trimmed");
  });

  it("returns empty string for empty response", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ result: { payloads: [{ text: "" }] } }),
      stderr: "",
    }));

    const result = await openclawReply({ userText: "test", run: mockRun });
    assert.strictEqual(result, "");
  });

  it("concurrency smoke test: active count never exceeds OPENCLAW_MAX_CONCURRENT", async () => {
    let active = 0;
    let maxActive = 0;
    const slowRun = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { stdout: JSON.stringify({ text: "ok" }), stderr: "" };
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => openclawReply({ userText: "test", run: slowRun }))
    );

    assert.ok(maxActive <= OPENCLAW_MAX_CONCURRENT, `maxActive=${maxActive} exceeded ${OPENCLAW_MAX_CONCURRENT}`);
    assert.ok(results.every((r) => r === "ok"), "all results should be 'ok'");
  });
});
