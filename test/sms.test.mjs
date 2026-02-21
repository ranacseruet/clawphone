import test from "node:test";
import assert from "node:assert/strict";

import { handleIncomingSms, twimlMessage, xmlEscape, normalizeSmsText } from "../lib/sms.mjs";

test("xmlEscape escapes XML special chars", () => {
  assert.equal(
    xmlEscape(`Tom & Rana <3 "hi" 'ok'`),
    "Tom &amp; Rana &lt;3 &quot;hi&quot; &apos;ok&apos;"
  );
});

test("twimlMessage wraps message in TwiML", () => {
  const xml = twimlMessage("hello");
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<Message>hello<\/Message>/);
});

test("normalizeSmsText normalizes unicode punctuation and enforces max length", () => {
  const out = normalizeSmsText("Hi — “there” …", { maxChars: 10 });
  // punctuation normalized + truncated
  assert.equal(out.length, 10);
  assert.match(out, /^Hi - "th/);
});

test("handleIncomingSms: fast path returns full reply and no async", async () => {
  const calls = { openclaw: 0, send: 0 };
  const res = await handleIncomingSms({
    form: { From: "+15550000001", To: "+15550000002", Body: "hi" },
    deps: {
      openclawReply: async () => {
        calls.openclaw++;
        return "fast reply";
      },
      twilioSendSms: async () => {
        calls.send++;
      },
      smsFrom: null,
    },
    fastTimeoutMs: 50,
    log: () => {},
  });

  assert.equal(res.didAck, false);
  assert.equal(res.startAsync, null);
  assert.match(res.twiml, /fast reply/);
  assert.equal(calls.openclaw, 1);
  assert.equal(calls.send, 0);
});

test("handleIncomingSms: slow path acks and sends async follow-up", async () => {
  const calls = { openclaw: 0, send: 0 };

  const openclawReply = async () => {
    calls.openclaw++;
    // first call will be timed out; second call (async) returns.
    if (calls.openclaw === 1) {
      await new Promise((r) => setTimeout(r, 200));
      return "too late";
    }
    return "async reply";
  };

  const twilioSendSms = async ({ to, from, body }) => {
    calls.send++;
    assert.equal(to, "+15550000001");
    assert.equal(from, "+15550000002");
    assert.equal(body, "async reply");
    return { sid: "SM123" };
  };

  const res = await handleIncomingSms({
    form: { From: "+15550000001", To: "+15550000002", Body: "hi" },
    deps: { openclawReply, twilioSendSms, smsFrom: null },
    fastTimeoutMs: 10,
    log: () => {},
  });

  assert.equal(res.didAck, true);
  assert.ok(typeof res.startAsync === "function");
  assert.match(res.twiml, /thinking/);

  await res.startAsync();

  assert.equal(calls.openclaw, 2);
  assert.equal(calls.send, 1);
});

test("handleIncomingSms: unauthorized number returns Unauthorized", async () => {
  const res = await handleIncomingSms({
    form: { From: "+15550000001", To: "+15550000002", Body: "hi" },
    allowFrom: ["+15559999999"], // Different number
    deps: {
      openclawReply: async () => "should not be called",
    },
    log: () => {},
  });

  assert.equal(res.didAck, false);
  assert.equal(res.startAsync, null);
  assert.match(res.twiml, /Unauthorized/);
});

test("handleIncomingSms: async path handles openclawReply error", async () => {
  const logs = [];
  const res = await handleIncomingSms({
    form: { From: "+15550000001", To: "+15550000002", Body: "hi" },
    deps: {
      openclawReply: async () => {
        throw new Error("Agent error");
      },
      twilioSendSms: async ({ body }) => {
        // Should receive error message
        assert.match(body, /Sorry/);
        return { sid: "SM123" };
      },
      smsFrom: null,
    },
    fastTimeoutMs: 10,
    log: (line) => logs.push(line),
  });

  assert.equal(res.didAck, true);
  await res.startAsync();
  // Should have logged the error
  assert.ok(logs.some((l) => l.includes("Agent error")));
});

test("handleIncomingSms: async path skips send if twilioSendSms not configured", async () => {
  const logs = [];
  const res = await handleIncomingSms({
    form: { From: "+15550000001", To: "+15550000002", Body: "hi" },
    deps: {
      openclawReply: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "delayed reply";
      },
      twilioSendSms: null, // Not configured
      smsFrom: null,
    },
    fastTimeoutMs: 10,
    log: (line) => logs.push(line),
  });

  assert.equal(res.didAck, true);
  await res.startAsync();
  // Should have logged the skip
  assert.ok(logs.some((l) => l.includes("twilioSendSms not configured")));
});

test("handleIncomingSms: async path handles send failure", async () => {
  const logs = [];
  const res = await handleIncomingSms({
    form: { From: "+15550000001", To: "+15550000002", Body: "hi" },
    deps: {
      openclawReply: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "reply";
      },
      twilioSendSms: async () => {
        throw new Error("Send failed");
      },
      smsFrom: null,
    },
    fastTimeoutMs: 10,
    log: (line) => logs.push(line),
  });

  assert.equal(res.didAck, true);
  await res.startAsync();
  // Should have logged the failure
  assert.ok(logs.some((l) => l.includes("async send failed")));
});

test("handleIncomingSms: uses custom smsFrom if provided", async () => {
  let sentFrom = null;
  const res = await handleIncomingSms({
    form: { From: "+15550000001", To: "+15550000002", Body: "hi" },
    deps: {
      openclawReply: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "reply";
      },
      twilioSendSms: async ({ from }) => {
        sentFrom = from;
        return { sid: "SM123" };
      },
      smsFrom: "+15553333333", // Custom from number
    },
    fastTimeoutMs: 10,
    log: () => {},
  });

  await res.startAsync();
  assert.equal(sentFrom, "+15553333333");
});

test("normalizeSmsText handles empty and null input", () => {
  assert.equal(normalizeSmsText(""), "");
  // null/undefined are converted to "" via (input || "") fallback
  assert.equal(normalizeSmsText(null), "");
  assert.equal(normalizeSmsText(undefined), "");
});

test("xmlEscape handles empty and null input", () => {
  assert.equal(xmlEscape(""), "");
  // null becomes "null" via String(null)
  assert.equal(xmlEscape(null), "null");
  // undefined triggers default param s="", so becomes ""
  assert.equal(xmlEscape(undefined), "");
  assert.equal(xmlEscape(), "");
});

test("twimlMessage uses default 'Okay' for empty text", () => {
  const xml = twimlMessage("");
  assert.match(xml, /<Message>Okay<\/Message>/);
});

// ─── xmlEscape: individual special chars ─────────────────────────────────────

test("xmlEscape escapes & individually", () => {
  assert.equal(xmlEscape("&"), "&amp;");
});

test("xmlEscape escapes < individually", () => {
  assert.equal(xmlEscape("<"), "&lt;");
});

test("xmlEscape escapes > individually", () => {
  assert.equal(xmlEscape(">"), "&gt;");
});

test('xmlEscape escapes " individually', () => {
  assert.equal(xmlEscape('"'), "&quot;");
});

test("xmlEscape escapes ' individually", () => {
  assert.equal(xmlEscape("'"), "&apos;");
});

test("xmlEscape escapes all 5 special chars in one string", () => {
  assert.equal(xmlEscape(`&<>"'`), "&amp;&lt;&gt;&quot;&apos;");
});

test("xmlEscape double-escapes already-escaped input (not idempotent by design)", () => {
  assert.equal(xmlEscape("&amp;"), "&amp;amp;");
});

// ─── Phone normalization edge cases ──────────────────────────────────────────

test("handleIncomingSms: From without + prefix is normalized and allowed", async () => {
  const res = await handleIncomingSms({
    form: { From: "15550000001", To: "+15550000002", Body: "hi" },
    allowFrom: ["+15550000001"],
    deps: {
      openclawReply: async () => "ok",
    },
    fastTimeoutMs: 50,
    log: () => {},
  });
  assert.equal(res.didAck, false);
  assert.match(res.twiml, /ok/);
});

test("handleIncomingSms: From with leading/trailing whitespace is trimmed and matched", async () => {
  const res = await handleIncomingSms({
    form: { From: "  +15550000001  ", To: "+15550000002", Body: "hi" },
    allowFrom: ["+15550000001"],
    deps: {
      openclawReply: async () => "ok",
    },
    fastTimeoutMs: 50,
    log: () => {},
  });
  assert.equal(res.didAck, false);
  assert.match(res.twiml, /ok/);
});

test("handleIncomingSms: From is undefined → normalized to '+' → fails allowlist", async () => {
  const res = await handleIncomingSms({
    form: { To: "+15550000002", Body: "hi" }, // no From
    allowFrom: ["+15550000001"],
    deps: {
      openclawReply: async () => "should not be called",
    },
    log: () => {},
  });
  assert.equal(res.didAck, false);
  assert.match(res.twiml, /Unauthorized/);
});
