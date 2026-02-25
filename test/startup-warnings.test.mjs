// @ts-check
/**
 * Tests for startup warnings emitted by createServer().
 *
 * createServer() writes warnings via createLogger() which calls
 * process.stdout.write() with JSON lines.  We capture stdout during the
 * createServer() call to assert the right messages are (or aren't) emitted.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fromPluginConfig } from "../lib/config.mjs";
import { createServer } from "../lib/http-server.mjs";

// ── Fake openclaw stub ────────────────────────────────────────────────────────
const fakeBinDir = mkdtempSync(join(tmpdir(), "clawphone-sw-test-"));
const fakeOpenclawPath = join(fakeBinDir, "openclaw");
writeFileSync(
  fakeOpenclawPath,
  '#!/bin/sh\necho \'{"result":{"payloads":[{"text":"[test stub]"}]}}\'\n',
  "utf8"
);
chmodSync(fakeOpenclawPath, 0o755);
if (!process.env.PATH?.startsWith(fakeBinDir)) {
  process.env.PATH = `${fakeBinDir}:${process.env.PATH}`;
}

after(() => rmSync(fakeBinDir, { recursive: true, force: true }));

/**
 * Run createServer() with the given config overrides, capturing all
 * process.stdout.write() output emitted during startup.
 *
 * Returns the parsed JSON log lines and closes the server before resolving.
 *
 * @param {object} overrides
 * @returns {Promise<Array<Record<string,unknown>>>}
 */
async function captureStartupWarnings(overrides) {
  const lines = /** @type {string[]} */ ([]);
  const original = process.stdout.write.bind(process.stdout);

  // @ts-ignore — intentional monkey-patch for test capture
  process.stdout.write = (/** @type {string|Buffer} */ chunk) => {
    lines.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    return true;
  };

  let server;
  try {
    server = await createServer({ ...fromPluginConfig({}), PORT: 0, TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", SMS_FAST_TIMEOUT_MS: 200, ...overrides });
  } finally {
    process.stdout.write = original;
  }

  await new Promise((resolve) => server.close(() => resolve(undefined)));

  return lines
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); }
      catch { return null; }
    })
    .filter(Boolean);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("startup warnings", () => {
  describe("ALLOW_FROM not set", () => {
    it("emits a warn-level log when ALLOW_FROM is empty", async () => {
      const logs = await captureStartupWarnings({ ALLOW_FROM: [] });
      const warning = logs.find(
        (l) => l.level === "warn" && typeof l.msg === "string" && l.msg.includes("ALLOW_FROM")
      );
      assert.ok(warning, "expected an ALLOW_FROM warning log line");
    });
  });

  describe("ALLOW_FROM set", () => {
    it("does not emit ALLOW_FROM warning when allowlist is configured", async () => {
      const logs = await captureStartupWarnings({ ALLOW_FROM: ["+15550001111"] });
      const warning = logs.find(
        (l) => l.level === "warn" && typeof l.msg === "string" && l.msg.includes("ALLOW_FROM")
      );
      assert.strictEqual(warning, undefined, "expected no ALLOW_FROM warning log line");
    });
  });

  describe("PUBLIC_BASE_URL not set with TWILIO_AUTH_TOKEN", () => {
    it("emits a warn-level log about skipped signature validation", async () => {
      const logs = await captureStartupWarnings({
        ALLOW_FROM: ["+15550001111"],
        TWILIO_AUTH_TOKEN: "test-token",
        PUBLIC_BASE_URL: "",
      });
      const warning = logs.find(
        (l) => l.level === "warn" && typeof l.msg === "string" && l.msg.includes("signature validation")
      );
      assert.ok(warning, "expected a signature validation warning log line");
    });
  });

  describe("PUBLIC_BASE_URL set with TWILIO_AUTH_TOKEN", () => {
    it("does not emit signature validation warning when both are configured", async () => {
      const logs = await captureStartupWarnings({
        ALLOW_FROM: ["+15550001111"],
        TWILIO_AUTH_TOKEN: "test-token",
        PUBLIC_BASE_URL: "https://example.com",
      });
      const warning = logs.find(
        (l) => l.level === "warn" && typeof l.msg === "string" && l.msg.includes("signature validation")
      );
      assert.strictEqual(warning, undefined, "expected no signature validation warning");
    });
  });
});
