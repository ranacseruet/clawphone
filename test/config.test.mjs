import { describe, it } from "node:test";
import assert from "node:assert";

import {
  THINKING_PHRASES,
  getRandomThinkingPhrase,
  PORT,
  TWILIO_VOICE,
  SMS_MAX_CHARS,
  MAX_SAYABLE_LENGTH,
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
});
