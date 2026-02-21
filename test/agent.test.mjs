import { describe, it, mock } from "node:test";
import assert from "node:assert";

import { discordLog, openclawReply } from "../lib/agent.mjs";
import { OPENCLAW_MAX_CONCURRENT, DISCORD_LOG_CHANNEL_ID } from "../lib/config.mjs";

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
    let resolveHold;
    const hold = new Promise((r) => { resolveHold = r; });
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

describe("openclawReply", () => {
  it("calls openclaw agent with correct args for voice mode", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ result: { payloads: [{ text: "Hello from agent" }] } }),
      stderr: "",
    }));

    const result = await openclawReply({ userText: "Hi there", mode: "voice", run: mockRun });

    assert.strictEqual(result, "Hello from agent");
    assert.strictEqual(mockRun.mock.calls.length, 1);
    
    const [cmd, args] = mockRun.mock.calls[0].arguments;
    assert.strictEqual(cmd, "openclaw");
    assert.ok(args.includes("agent"));
    assert.ok(args.includes("--message"));
    
    // Find the message arg
    const messageIdx = args.indexOf("--message");
    const message = args[messageIdx + 1];
    assert.ok(message.includes("Phone call (Rana)"));
    assert.ok(message.includes("Hi there"));
  });

  it("calls openclaw agent with SMS instruction for sms mode", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: JSON.stringify({ result: { payloads: [{ text: "Short reply" }] } }),
      stderr: "",
    }));

    const result = await openclawReply({ userText: "Hello", mode: "sms", run: mockRun });

    assert.strictEqual(result, "Short reply");
    
    const [, args] = mockRun.mock.calls[0].arguments;
    const messageIdx = args.indexOf("--message");
    const message = args[messageIdx + 1];
    assert.ok(message.includes("SMS (Rana)"));
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
