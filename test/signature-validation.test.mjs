// @ts-check
/**
 * Regression tests for Twilio webhook signature validation.
 *
 * The main server.test.mjs suite sets TWILIO_AUTH_TOKEN="" which causes
 * checkSignature() to skip validation entirely (correct for test isolation).
 * This file proves that the validation path itself works: a server instance
 * configured with a real auth token and PUBLIC_BASE_URL rejects requests
 * carrying a bad or missing x-twilio-signature with 403.
 *
 * Each test file runs in its own process under node --test, so this server
 * instance is fully isolated from the one in server.test.mjs.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import crypto from "node:crypto";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../lib/http-server.mjs";

// ── Fake openclaw stub ────────────────────────────────────────────────────────
const fakeBinDir = mkdtempSync(join(tmpdir(), "sig-val-test-"));
const fakeOpenclawPath = join(fakeBinDir, "openclaw");
writeFileSync(
  fakeOpenclawPath,
  '#!/bin/sh\necho \'{"result":{"payloads":[{"text":"[test stub]"}]}}\'\n',
  "utf8"
);
chmodSync(fakeOpenclawPath, 0o755);
process.env.PATH = `${fakeBinDir}:${process.env.PATH}`;

// ── Constants ─────────────────────────────────────────────────────────────────
const AUTH_TOKEN = "fake-auth-token-for-testing";
const BASE_URL = "http://localhost";

/**
 * Compute the Twilio webhook signature for a POST request.
 * Matches the algorithm Twilio.validateRequest() verifies against.
 *
 * @param {string} authToken
 * @param {string} url          Full URL including query string
 * @param {Record<string, string>} params  POST body params
 * @returns {string} Base64-encoded HMAC-SHA1
 */
function computeSignature(authToken, url, params) {
  let str = url;
  for (const key of Object.keys(params).sort()) {
    str += key + (params[key] ?? "");
  }
  return crypto.createHmac("sha1", authToken).update(str).digest("base64");
}

/**
 * Make an HTTP POST request to the test server.
 *
 * @param {{ path: string, body: Record<string, string>, port: number, signature?: string }} opts
 * @returns {Promise<{ status: number, body: string }>}
 */
function post({ path, body, port, signature }) {
  return new Promise((resolve, reject) => {
    const encoded = new URLSearchParams(body).toString();
    const headers = /** @type {Record<string, string | number>} */ ({
      "content-type": "application/x-www-form-urlencoded",
      "content-length": Buffer.byteLength(encoded),
    });
    if (signature !== undefined) {
      headers["x-twilio-signature"] = signature;
    }
    const req = http.request(
      { hostname: "localhost", port, path, method: "POST", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data })
        );
      }
    );
    req.on("error", reject);
    if (encoded) req.write(encoded);
    req.end();
  });
}

// ── Server config ─────────────────────────────────────────────────────────────

/** @type {Parameters<typeof createServer>[0]} */
const config = {
  PORT: 0,
  ALLOW_FROM: [],
  TWILIO_ACCOUNT_SID: "",
  TWILIO_AUTH_TOKEN: AUTH_TOKEN,
  TWILIO_SMS_FROM: "",
  PUBLIC_BASE_URL: BASE_URL,
  SMS_MAX_CHARS: 1600,
  SMS_FAST_TIMEOUT_MS: 200,
  MAX_SAYABLE_LENGTH: 500,
  CALLER_NAME: "",
  AGENT_NAME: "",
  GREETING_TEXT: "Hello",
  getRandomThinkingPhrase: () => "One moment.",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Twilio signature validation", () => {
  /** @type {http.Server} */
  let server;
  let port = 0;

  before(async () => {
    server = await createServer(config, null);
    port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    rmSync(fakeBinDir, { recursive: true, force: true });
  });

  // ── /sms ──────────────────────────────────────────────────────────────────

  it("POST /sms — no signature → 403", async () => {
    const res = await post({
      path: "/sms",
      body: { From: "+15550001111", To: "+15550002222", Body: "hi" },
      port,
      // no signature header
    });
    assert.strictEqual(res.status, 403);
    assert.match(res.body, /Forbidden/i);
  });

  it("POST /sms — wrong signature → 403", async () => {
    const res = await post({
      path: "/sms",
      body: { From: "+15550001111", To: "+15550002222", Body: "hi" },
      port,
      signature: "nottherealsignature",
    });
    assert.strictEqual(res.status, 403);
  });

  it("POST /sms — valid signature → 200 (not rejected)", async () => {
    const body = { From: "+15550001111", To: "+15550002222", Body: "hi" };
    const sig = computeSignature(AUTH_TOKEN, `${BASE_URL}/sms`, body);
    const res = await post({ path: "/sms", body, port, signature: sig });
    assert.notStrictEqual(res.status, 403);
    assert.strictEqual(res.status, 200);
  });

  // ── /voice ────────────────────────────────────────────────────────────────

  it("POST /voice — no signature → 403", async () => {
    const res = await post({
      path: "/voice",
      body: { From: "+15550001111", CallSid: "CAv1" },
      port,
    });
    assert.strictEqual(res.status, 403);
  });

  it("POST /voice — wrong signature → 403", async () => {
    const res = await post({
      path: "/voice",
      body: { From: "+15550001111", CallSid: "CAv2" },
      port,
      signature: "badsig",
    });
    assert.strictEqual(res.status, 403);
  });

  it("POST /voice — valid signature → 200 (not rejected)", async () => {
    const body = { From: "+15550001111", CallSid: "CAv3" };
    const sig = computeSignature(AUTH_TOKEN, `${BASE_URL}/voice`, body);
    const res = await post({ path: "/voice", body, port, signature: sig });
    assert.notStrictEqual(res.status, 403);
    assert.strictEqual(res.status, 200);
  });

  // ── /speech ───────────────────────────────────────────────────────────────

  it("POST /speech — no signature → 403", async () => {
    const res = await post({
      path: "/speech",
      body: { From: "+15550001111", CallSid: "CAsp1", SpeechResult: "hello" },
      port,
    });
    assert.strictEqual(res.status, 403);
  });

  it("POST /speech — wrong signature → 403", async () => {
    const res = await post({
      path: "/speech",
      body: { From: "+15550001111", CallSid: "CAsp2", SpeechResult: "hello" },
      port,
      signature: "badsig",
    });
    assert.strictEqual(res.status, 403);
  });

  it("POST /speech — valid signature → 200 (not rejected)", async () => {
    const body = { From: "+15550001111", CallSid: "CAsp3", SpeechResult: "hello" };
    const sig = computeSignature(AUTH_TOKEN, `${BASE_URL}/speech`, body);
    const res = await post({ path: "/speech", body, port, signature: sig });
    assert.notStrictEqual(res.status, 403);
    assert.strictEqual(res.status, 200);
  });

  // ── /speech-wait ──────────────────────────────────────────────────────────

  it("POST /speech-wait — no signature → 403", async () => {
    const res = await post({
      path: "/speech-wait?key=testkey",
      body: {},
      port,
    });
    assert.strictEqual(res.status, 403);
  });

  it("POST /speech-wait — wrong signature → 403", async () => {
    const res = await post({
      path: "/speech-wait?key=testkey",
      body: {},
      port,
      signature: "badsig",
    });
    assert.strictEqual(res.status, 403);
  });

  it("POST /speech-wait — valid signature → 200 (not rejected)", async () => {
    // No matching turn exists; server returns Okay+Hangup (200), but not 403
    const path = "/speech-wait?key=testkey";
    const body = /** @type {Record<string, string>} */ ({});
    const sig = computeSignature(AUTH_TOKEN, `${BASE_URL}${path}`, body);
    const res = await post({ path, body, port, signature: sig });
    assert.notStrictEqual(res.status, 403);
    assert.strictEqual(res.status, 200);
  });
});
