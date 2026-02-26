// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert";

import {
  THINKING_PHRASES,
  POLL_FILLER_PHRASES,
  getRandomThinkingPhrase,
  PORT,
  TWILIO_VOICE,
  TWILIO_SPEECH_MODEL,
  SMS_MAX_CHARS,
  MAX_SAYABLE_LENGTH,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  SPEECH_WAIT_PAUSE_SECONDS,
  fromPluginConfig,
} from "../lib/config.mjs";

describe("config", () => {
  describe("constants", () => {
    it("has sensible default PORT", () => {
      assert.strictEqual(typeof PORT, "number");
      assert.ok(PORT > 0 && PORT < 65536);
    });

    it("has TWILIO_VOICE defined", () => {
      assert.strictEqual(typeof TWILIO_VOICE, "string");
      assert.ok(TWILIO_VOICE.length > 0);
    });

    it("has SMS_MAX_CHARS as number", () => {
      assert.strictEqual(typeof SMS_MAX_CHARS, "number");
      assert.ok(SMS_MAX_CHARS > 0);
    });

    it("has MAX_SAYABLE_LENGTH", () => {
      assert.strictEqual(typeof MAX_SAYABLE_LENGTH, "number");
      assert.ok(MAX_SAYABLE_LENGTH > 0);
    });

    it("has RATE_LIMIT_MAX as a non-negative number", () => {
      assert.strictEqual(typeof RATE_LIMIT_MAX, "number");
      assert.ok(RATE_LIMIT_MAX >= 0);
    });

    it("has RATE_LIMIT_WINDOW_MS as a positive number", () => {
      assert.strictEqual(typeof RATE_LIMIT_WINDOW_MS, "number");
      assert.ok(RATE_LIMIT_WINDOW_MS > 0);
    });

    it("has SPEECH_WAIT_PAUSE_SECONDS defaulting to 1", () => {
      assert.strictEqual(typeof SPEECH_WAIT_PAUSE_SECONDS, "number");
      assert.strictEqual(SPEECH_WAIT_PAUSE_SECONDS, 1);
    });

    it("has TWILIO_SPEECH_MODEL defaulting to phone_call", () => {
      assert.strictEqual(typeof TWILIO_SPEECH_MODEL, "string");
      assert.strictEqual(TWILIO_SPEECH_MODEL, "phone_call");
    });
  });

  describe("fromPluginConfig — SPEECH_WAIT_PAUSE_SECONDS", () => {
    it("defaults to 1 when not provided", () => {
      const cfg = fromPluginConfig({});
      assert.strictEqual(cfg.SPEECH_WAIT_PAUSE_SECONDS, 1);
    });

    it("maps speechWaitPauseSeconds from plugin config", () => {
      const cfg = fromPluginConfig({ speechWaitPauseSeconds: 2 });
      assert.strictEqual(cfg.SPEECH_WAIT_PAUSE_SECONDS, 2);
    });
  });

  describe("fromPluginConfig — TWILIO_SPEECH_MODEL", () => {
    it("defaults to phone_call when not provided", () => {
      const cfg = fromPluginConfig({});
      assert.strictEqual(cfg.TWILIO_SPEECH_MODEL, "phone_call");
    });

    it("maps twilioSpeechModel from plugin config", () => {
      const cfg = fromPluginConfig({ twilioSpeechModel: "googlev2_telephony" });
      assert.strictEqual(cfg.TWILIO_SPEECH_MODEL, "googlev2_telephony");
    });
  });

  describe("THINKING_PHRASES", () => {
    it("is a non-empty array", () => {
      assert.ok(Array.isArray(THINKING_PHRASES));
      assert.ok(THINKING_PHRASES.length > 0);
    });

    it("contains only strings", () => {
      for (const phrase of THINKING_PHRASES) {
        assert.strictEqual(typeof phrase, "string");
        assert.ok(phrase.length > 0);
      }
    });
  });

  describe("getRandomThinkingPhrase", () => {
    it("returns a string from THINKING_PHRASES", () => {
      const phrase = getRandomThinkingPhrase();
      assert.strictEqual(typeof phrase, "string");
      assert.ok(THINKING_PHRASES.includes(phrase));
    });

    it("returns different phrases over multiple calls (probabilistic)", () => {
      const results = new Set();
      // Call many times to check randomness
      for (let i = 0; i < 100; i++) {
        results.add(getRandomThinkingPhrase());
      }
      // Should get more than one unique phrase (unless extremely unlucky)
      assert.ok(results.size > 1, "Expected multiple unique phrases");
    });
  });

  describe("POLL_FILLER_PHRASES", () => {
    it("is a non-empty array", () => {
      assert.ok(Array.isArray(POLL_FILLER_PHRASES));
      assert.ok(POLL_FILLER_PHRASES.length > 0);
    });

    it("contains only non-empty strings", () => {
      for (const phrase of POLL_FILLER_PHRASES) {
        assert.strictEqual(typeof phrase, "string");
        assert.ok(phrase.length > 0);
      }
    });

    it("has exactly 2 phrases (caps filler at 2 poll cycles)", () => {
      assert.strictEqual(POLL_FILLER_PHRASES.length, 2);
    });
  });

  describe("fromPluginConfig — POLL_FILLER_PHRASES", () => {
    it("includes POLL_FILLER_PHRASES as a non-empty array", () => {
      const cfg = fromPluginConfig({});
      assert.ok(Array.isArray(cfg.POLL_FILLER_PHRASES));
      assert.ok(cfg.POLL_FILLER_PHRASES.length > 0);
    });

    it("POLL_FILLER_PHRASES contains only non-empty strings", () => {
      const cfg = fromPluginConfig({});
      for (const phrase of cfg.POLL_FILLER_PHRASES) {
        assert.strictEqual(typeof phrase, "string");
        assert.ok(phrase.length > 0);
      }
    });
  });
});
