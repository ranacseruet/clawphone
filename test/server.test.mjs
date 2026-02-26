// @ts-check
/**
 * Integration tests for server.mjs.
 *
 * Strategy:
 *  - Set critical env vars BEFORE any dynamic import so config.mjs picks them up
 *    (dotenv does not override vars that are already in process.env).
 *  - PORT=0 → OS assigns a free port; we read it back via server.address().port.
 *  - TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN cleared → twilioClient stays null,
 *    so no real Twilio SDK calls can be made even in the async SMS path.
 *  - DISCORD_LOG_CHANNEL_ID cleared → discordLog() returns immediately (no-op).
 *  - ALLOW_FROM fixed to a known test number.
 *  - A fake `openclaw` stub is injected onto PATH so openclawReply() never
 *    reaches the real agent or Discord, preventing notifications during tests.
 *  - voice-state.mjs is imported statically (no config dependency) so we can
 *    pre-populate pending turns for /speech-wait tests; it shares the same module
 *    instance as the one server.mjs imported.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPendingTurn,
  completeTurn,
  deleteTurn,
} from "../lib/voice-state.mjs";

// ── Fake openclaw stub ───────────────────────────────────────────────────────
// Prevent real openclaw (if on PATH) from spawning and touching Discord/agents.
const fakeBinDir = mkdtempSync(join(tmpdir(), "twilio-gw-test-"));
const fakeOpenclawPath = join(fakeBinDir, "openclaw");
writeFileSync(
  fakeOpenclawPath,
  '#!/bin/sh\necho \'{"result":{"payloads":[{"text":"[test stub]"}]}}\'\n',
  "utf8"
);
chmodSync(fakeOpenclawPath, 0o755);
process.env.PATH = `${fakeBinDir}:${process.env.PATH}`;

// ── Configure env before server / config loads ───────────────────────────────
process.env.PORT = "0"; // OS picks free port
process.env.ALLOW_FROM = "+15550001111";
process.env.TWILIO_ACCOUNT_SID = ""; // keeps twilioClient = null
process.env.TWILIO_AUTH_TOKEN = "";
process.env.DISCORD_LOG_CHANNEL_ID = ""; // discordLog() returns early (no-op)
// Short fast-path timeout so /sms tests complete quickly
process.env.SMS_FAST_TIMEOUT_MS = "200";

// Dynamic import: config.mjs is evaluated HERE with the env vars above already set
const { server } = await import("../server.mjs");

// ── Tiny HTTP helpers ────────────────────────────────────────────────────────

function request(method, path, body, port) {
  return new Promise((resolve, reject) => {
    const encoded =
      body == null
        ? ""
        : typeof body === "string"
        ? body
        : new URLSearchParams(body).toString();

    const options = {
      hostname: "localhost",
      port,
      path,
      method,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(encoded),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: data })
      );
    });
    req.on("error", reject);
    if (encoded) req.write(encoded);
    req.end();
  });
}

const post = (path, body, port) => request("POST", path, body, port);
const get = (path, port) => request("GET", path, null, port);

// ── Tests ────────────────────────────────────────────────────────────────────

describe("server integration", () => {
  let port;

  before(async () => {
    // server.listen() is async; wait for it to actually bind
    if (!server.listening) {
      await new Promise((r) => server.once("listening", r));
    }
    port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  });

  after(async () => {
    // Give fire-and-forget background tasks (openclawReply IIFEs) a moment to
    // settle so their error-catch branches register in the coverage report.
    await new Promise((r) => setTimeout(r, 200));
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    rmSync(fakeBinDir, { recursive: true, force: true });
  });

  // ── Health ──────────────────────────────────────────────────────────────

  it("GET /health → ok with fields", async () => {
    const res = await get("/health", port);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(typeof body.version, "string");
    assert.ok(body.version.length > 0);
    assert.strictEqual(typeof body.uptime, "number");
    assert.ok(body.uptime >= 0);
    assert.strictEqual(body.activeTurns, 0);
    assert.strictEqual(body.twilioConfigured, false); // test env: no Twilio creds
  });

  // ── 404 ─────────────────────────────────────────────────────────────────

  it("GET /unknown → 404", async () => {
    const res = await get("/unknown", port);
    assert.strictEqual(res.status, 404);
  });

  it("POST /unknown → 404", async () => {
    const res = await post("/unknown", {}, port);
    assert.strictEqual(res.status, 404);
  });

  // ── /voice ───────────────────────────────────────────────────────────────

  it("POST /voice from allowed number → Gather TwiML", async () => {
    const res = await post(
      "/voice",
      { From: "+15550001111", CallSid: "CA-v-allowed" },
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.headers["content-type"], /text\/xml/);
    assert.match(res.body, /<Gather/);
    assert.match(res.body, /input="speech"/);
  });

  it("POST /voice from denied number → Hangup TwiML", async () => {
    const res = await post(
      "/voice",
      { From: "+15559999999", CallSid: "CA-v-denied" },
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /<Hangup/);
    assert.match(res.body, /not authorized/i);
  });

  it("POST /voice with number missing + prefix → normalized and allowed", async () => {
    // "15550001111" (no +) should be normalized to "+15550001111" and pass
    const res = await post(
      "/voice",
      { From: "15550001111", CallSid: "CA-v-noplus" },
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /<Gather/);
  });

  it("POST /voice with oversized body → 413", async () => {
    const res = await post("/voice", "x=" + "a".repeat(70_000), port);
    assert.strictEqual(res.status, 413);
    assert.match(res.body, /exceeded/i);
  });

  // ── /speech ──────────────────────────────────────────────────────────────

  it("POST /speech from allowed number → thinking redirect TwiML", async () => {
    const res = await post(
      "/speech",
      { From: "+15550001111", CallSid: "CA-sp-1", SpeechResult: "Hello" },
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.headers["content-type"], /text\/xml/);
    assert.match(res.body, /<Redirect/);
    assert.match(res.body, /speech-wait/);
    // Must include poll=1 so the first /speech-wait poll can play a filler phrase
    assert.match(res.body, /poll=1/);
  });

  it("POST /speech with empty SpeechResult → still returns thinking redirect", async () => {
    const res = await post(
      "/speech",
      { From: "+15550001111", CallSid: "CA-sp-2", SpeechResult: "" },
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /<Redirect/);
    assert.match(res.body, /speech-wait/);
  });

  it("POST /speech from denied number → Hangup TwiML", async () => {
    const res = await post(
      "/speech",
      { From: "+15559999999", CallSid: "CA-sp-3", SpeechResult: "hi" },
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /<Hangup/);
  });

  it("POST /speech with oversized body → 413", async () => {
    const res = await post("/speech", "x=" + "a".repeat(70_000), port);
    assert.strictEqual(res.status, 413);
  });

  // ── /speech-wait ─────────────────────────────────────────────────────────

  it("POST /speech-wait with unknown key → Okay + Hangup TwiML", async () => {
    const res = await post("/speech-wait?key=no-such-key", "", port);
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /Okay/);
    assert.match(res.body, /<Hangup/);
  });

  it("POST /speech-wait with pending (not done) turn, no poll param → Pause + Redirect", async () => {
    const callSid = "CA-sw-pending";
    const key = `${callSid}:t1`;
    createPendingTurn({ key, callSid, from: "+15550001111", said: "waiting" });

    const res = await post(
      `/speech-wait?key=${encodeURIComponent(key)}`,
      "",
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /<Pause/);
    assert.match(res.body, /speech-wait/);

    deleteTurn(key);
  });

  it("POST /speech-wait with pending turn + poll=1 → filler phrase + Redirect (no Pause)", async () => {
    const callSid = "CA-sw-filler1";
    const key = `${callSid}:t1`;
    createPendingTurn({ key, callSid, from: "+15550001111", said: "waiting" });

    const res = await post(
      `/speech-wait?key=${encodeURIComponent(key)}&poll=1`,
      "",
      port
    );
    assert.strictEqual(res.status, 200);
    // Should have a Say element (filler phrase), not a Pause
    assert.match(res.body, /<Say/);
    assert.doesNotMatch(res.body, /<Pause/);
    assert.match(res.body, /speech-wait/);
    // Next poll param should be incremented to 2
    assert.match(res.body, /poll=2/);

    deleteTurn(key);
  });

  it("POST /speech-wait with pending turn + poll=2 → second filler phrase + Redirect (no Pause)", async () => {
    const callSid = "CA-sw-filler2";
    const key = `${callSid}:t1`;
    createPendingTurn({ key, callSid, from: "+15550001111", said: "waiting" });

    const res = await post(
      `/speech-wait?key=${encodeURIComponent(key)}&poll=2`,
      "",
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /<Say/);
    assert.doesNotMatch(res.body, /<Pause/);
    assert.match(res.body, /speech-wait/);
    assert.match(res.body, /poll=3/);

    deleteTurn(key);
  });

  it("POST /speech-wait with pending turn + poll=3 → silent Pause + Redirect (filler exhausted)", async () => {
    const callSid = "CA-sw-filler3";
    const key = `${callSid}:t1`;
    createPendingTurn({ key, callSid, from: "+15550001111", said: "waiting" });

    const res = await post(
      `/speech-wait?key=${encodeURIComponent(key)}&poll=3`,
      "",
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /<Pause/);
    assert.match(res.body, /speech-wait/);
    assert.match(res.body, /poll=4/);

    deleteTurn(key);
  });

  it("POST /speech-wait with completed turn → delivers reply + Gather", async () => {
    const callSid = "CA-sw-done";
    const key = `${callSid}:t2`;
    createPendingTurn({ key, callSid, from: "+15550001111", said: "test" });
    completeTurn(key, "Here is my answer.");

    const res = await post(
      `/speech-wait?key=${encodeURIComponent(key)}`,
      "",
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /Here is my answer/);
    assert.match(res.body, /<Gather/);
    // Turn should have been deleted by handler
    assert.strictEqual(res.body.includes("Here is my answer"), true);
  });

  it("POST /speech-wait with superseded key → Okay + Hangup (turn was deleted)", async () => {
    // createPendingTurn(key2) deletes key1 from pending by design, so polling
    // for key1 hits the "!item" branch and returns Okay + Hangup.
    const callSid = "CA-sw-stale";
    const key1 = `${callSid}:t3`;
    const key2 = `${callSid}:t4`;
    createPendingTurn({ key: key1, callSid, from: "+15550001111", said: "first" });
    createPendingTurn({ key: key2, callSid, from: "+15550001111", said: "second" });

    const res = await post(
      `/speech-wait?key=${encodeURIComponent(key1)}`,
      "",
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /Okay/);
    assert.match(res.body, /<Hangup/);

    deleteTurn(key2);
  });

  // ── /sms ─────────────────────────────────────────────────────────────────

  it("POST /sms from denied number → Unauthorized TwiML", async () => {
    const res = await post(
      "/sms",
      { From: "+15559999999", To: "+15550001111", Body: "hi" },
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.headers["content-type"], /text\/xml/);
    assert.match(res.body, /Unauthorized/);
  });

  it("POST /sms from allowed number → TwiML response (ack or fast reply)", async () => {
    // openclaw binary doesn't exist in test env → fast path fails →
    // server returns ack TwiML; startAsync fires in background but
    // twilioClient is null so no real SMS is sent.
    const res = await post(
      "/sms",
      { From: "+15550001111", To: "+15550002222", Body: "hello" },
      port
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.headers["content-type"], /text\/xml/);
    assert.match(res.body, /<Message>/);
  });

  it("POST /sms with oversized body → 413", async () => {
    const res = await post("/sms", "x=" + "a".repeat(70_000), port);
    assert.strictEqual(res.status, 413);
  });
});
