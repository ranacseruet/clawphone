// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert";

import {
  say,
  sayAndHangup,
  sayAndRedirect,
  greetingWithGather,
  replyWithGather,
  thinkingRedirect,
  pauseAndRedirect,
  fillerAndRedirect,
} from "../lib/twiml.mjs";
import { TWILIO_VOICE, TWILIO_SPEECH_MODEL, GATHER_TIMEOUT_SECONDS, GATHER_FOLLOWUP_TIMEOUT_SECONDS, SPEECH_WAIT_PAUSE_SECONDS } from "../lib/config.mjs";

describe("TwiML builders", () => {
  describe("say", () => {
    it("wraps text in Say element with voice", () => {
      const result = say("Hello world");
      assert.ok(result.includes('<?xml version="1.0"'));
      assert.ok(result.includes("<Response>"));
      assert.ok(result.includes(`voice="${TWILIO_VOICE}"`));
      assert.ok(result.includes(">Hello world</Say>"));
    });

    it("escapes XML special characters", () => {
      const result = say("Hello <world> & \"friends\"");
      assert.ok(result.includes("&lt;world&gt;"));
      assert.ok(result.includes("&amp;"));
      // " does not need escaping in XML element content (only in attributes)
      assert.ok(result.includes('"friends"'));
    });
  });

  describe("sayAndHangup", () => {
    it("includes Hangup after Say", () => {
      const result = sayAndHangup("Goodbye");
      assert.ok(result.includes(">Goodbye</Say>"));
      assert.ok(result.includes("<Hangup/>"));
    });
  });

  describe("sayAndRedirect", () => {
    it("includes Redirect after Say", () => {
      const result = sayAndRedirect("Please wait", "/next");
      assert.ok(result.includes(">Please wait</Say>"));
      assert.ok(result.includes('<Redirect method="POST">/next</Redirect>'));
    });

    it("escapes redirect URL", () => {
      const result = sayAndRedirect("Wait", "/path?key=value&foo=bar");
      assert.ok(result.includes("&amp;foo=bar"));
    });
  });

  describe("greetingWithGather", () => {
    it("includes greeting, gather, and fallback", () => {
      const result = greetingWithGather("Hi there");
      assert.ok(result.includes(">Hi there</Say>"));
      assert.ok(result.includes('<Gather input="speech"'));
      assert.ok(result.includes('action="/speech"'));
      assert.ok(result.includes(`timeout="${GATHER_TIMEOUT_SECONDS}"`));
      assert.ok(result.includes(`speechModel="${TWILIO_SPEECH_MODEL}"`));
      assert.ok(result.includes(">Beep.</Say>"));
      assert.ok(result.includes("I did not hear anything"));
      assert.ok(result.includes('<Redirect method="POST">/voice</Redirect>'));
    });

    it("allows custom beep and no-input text", () => {
      const result = greetingWithGather("Hi", "Start.", "Nothing heard.");
      assert.ok(result.includes(">Start.</Say>"));
      assert.ok(result.includes(">Nothing heard.</Say>"));
    });
  });

  describe("replyWithGather", () => {
    it("includes reply, gather, and fallback", () => {
      const result = replyWithGather("Here is my answer");
      assert.ok(result.includes(">Here is my answer</Say>"));
      assert.ok(result.includes('<Gather input="speech"'));
      assert.ok(result.includes(`timeout="${GATHER_FOLLOWUP_TIMEOUT_SECONDS}"`));
      assert.ok(result.includes(`speechModel="${TWILIO_SPEECH_MODEL}"`));
      assert.ok(result.includes("Say your next message"));
      // ' does not need escaping in XML element content (only in attributes)
      assert.ok(result.includes("I didn't catch anything"));
      assert.ok(result.includes('<Redirect method="POST">/speech</Redirect>'));
    });

    it("allows custom prompt and no-input text", () => {
      const result = replyWithGather("Answer", "Continue.", "Try again.");
      assert.ok(result.includes(">Continue.</Say>"));
      assert.ok(result.includes(">Try again.</Say>"));
    });
  });

  describe("thinkingRedirect", () => {
    it("says phrase and redirects", () => {
      const result = thinkingRedirect("Let me think...", "/speech-wait?key=123");
      assert.ok(result.includes(">Let me think...</Say>"));
      assert.ok(result.includes('<Redirect method="POST">/speech-wait?key=123</Redirect>'));
    });
  });

  describe("pauseAndRedirect", () => {
    it("pauses and redirects", () => {
      const result = pauseAndRedirect("/speech-wait?key=abc");
      assert.ok(result.includes(`<Pause length="${SPEECH_WAIT_PAUSE_SECONDS}"/>`));
      assert.ok(result.includes('<Redirect method="POST">/speech-wait?key=abc</Redirect>'));
    });
  });

  describe("fillerAndRedirect", () => {
    it("says filler phrase and redirects", () => {
      const result = fillerAndRedirect("Still working on it.", "/speech-wait?key=xyz&poll=2");
      assert.ok(result.includes(">Still working on it.</Say>"));
      assert.ok(result.includes('<Redirect method="POST">/speech-wait?key=xyz&amp;poll=2</Redirect>'));
    });

    it("does not include a Pause element", () => {
      const result = fillerAndRedirect("Almost there.", "/speech-wait?key=xyz&poll=3");
      assert.ok(!result.includes("<Pause"));
    });
  });

});
