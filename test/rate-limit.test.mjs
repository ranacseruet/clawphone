// @ts-check
/**
 * Rate limiter integration tests.
 *
 * Creates a dedicated server instance (separate from server.test.mjs) with a
 * very low RATE_LIMIT_MAX so tests can exercise the limit without making many
 * requests.  Uses the same fake openclaw stub pattern to prevent real agent calls.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Fake openclaw stub (same pattern as server.test.mjs) ─────────────────────
const fakeBinDir = mkdtempSync(join(tmpdir(), "clawphone-rl-test-"));
const fakeOpenclawPath = join(fakeBinDir, "openclaw");
writeFileSync(
  fakeOpenclawPath,
  '#!/bin/sh\necho \'{"result":{"payloads":[{"text":"[test stub]"}]}}\'\n',
  "utf8"
);
chmodSync(fakeOpenclawPath, 0o755);
// Prepend only if not already first (avoids duplicate prepend if tests run together)
if (!process.env.PATH?.startsWith(fakeBinDir)) {
  process.env.PATH = `${fakeBinDir}:${process.env.PATH}`;
}

import { fromPluginConfig } from "../lib/config.mjs";
import { createServer } from "../lib/http-server.mjs";

/** @type {http.Server} */
let server;
let port;

before(async () => {
  server = await createServer({
    ...fromPluginConfig({}),
    PORT: 0,
    RATE_LIMIT_MAX: 2,           // low limit for fast testing
    RATE_LIMIT_WINDOW_MS: 60_000,
    ALLOW_FROM: [],              // allow all (not testing allowlist here)
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    SMS_FAST_TIMEOUT_MS: 200,
  });
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
});

after(() => {
  rmSync(fakeBinDir, { recursive: true, force: true });
  return new Promise((resolve) => server.close(() => resolve(undefined)));
});

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/**
 * @param {string} method
 * @param {string} path
 * @param {Record<string,string>|null} body
 * @returns {Promise<{ status: number, body: string, headers: import('node:http').IncomingMessage['headers'] }>}
 */
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const encoded = body == null ? "" : new URLSearchParams(body).toString();
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
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
    });
    req.on("error", reject);
    if (encoded) req.write(encoded);
    req.end();
  });
}

const post = (path, body) => request("POST", path, body);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("rate limiting", () => {
  describe("/voice rate limiting", () => {
    it("first request from a number is allowed → Gather TwiML", async () => {
      const res = await post("/voice", { From: "+15550010001", CallSid: "CA-rl-v1" });
      assert.strictEqual(res.status, 200);
      assert.match(res.body, /<Gather/);
    });

    it("second request from same number is allowed → Gather TwiML", async () => {
      const res = await post("/voice", { From: "+15550010001", CallSid: "CA-rl-v2" });
      assert.strictEqual(res.status, 200);
      assert.match(res.body, /<Gather/);
    });

    it("third request from same number is rate-limited → Hangup TwiML with message", async () => {
      const res = await post("/voice", { From: "+15550010001", CallSid: "CA-rl-v3" });
      assert.strictEqual(res.status, 200);
      assert.match(res.body, /<Hangup/);
      assert.match(res.body, /Too many requests/i);
    });

    it("request from a different number is not rate-limited → Gather TwiML", async () => {
      const res = await post("/voice", { From: "+15550010002", CallSid: "CA-rl-v4" });
      assert.strictEqual(res.status, 200);
      assert.match(res.body, /<Gather/);
    });
  });

  describe("/sms rate limiting", () => {
    it("first SMS from a number is allowed → normal reply TwiML", async () => {
      const res = await post("/sms", { From: "+15550020001", To: "+15550009999", Body: "hello" });
      assert.strictEqual(res.status, 200);
      assert.match(res.body, /<Message>/);
    });

    it("second SMS from same number is allowed → normal reply TwiML", async () => {
      const res = await post("/sms", { From: "+15550020001", To: "+15550009999", Body: "hello again" });
      assert.strictEqual(res.status, 200);
      assert.match(res.body, /<Message>/);
    });

    it("third SMS from same number is rate-limited → Too many requests TwiML", async () => {
      const res = await post("/sms", { From: "+15550020001", To: "+15550009999", Body: "yet again" });
      assert.strictEqual(res.status, 200);
      assert.match(res.body, /<Message>/);
      assert.match(res.body, /Too many requests/i);
    });

    it("SMS from a different number is not rate-limited → normal reply TwiML", async () => {
      const res = await post("/sms", { From: "+15550020002", To: "+15550009999", Body: "hi" });
      assert.strictEqual(res.status, 200);
      assert.match(res.body, /<Message>/);
      assert.doesNotMatch(res.body, /Too many requests/i);
    });
  });
});
