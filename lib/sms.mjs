import { setTimeout as delay } from "node:timers/promises";

export function xmlEscape(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function twimlMessage(text) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(text || "Okay")}</Message></Response>`;
}

// Best-effort normalization to avoid UCS2 where possible (which increases segments),
// and to enforce a hard max length (Twilio trial accounts can warn/fail on long bodies).
export function normalizeSmsText(input, { maxChars = 280 } = {}) {
  let s = String(input || "");

  // Replace common Unicode punctuation with ASCII to reduce UCS2 likelihood.
  s = s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...");

  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();

  // Hard cap.
  if (s.length > maxChars) {
    const suffix = "…";
    s = s.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd() + suffix;
  }

  return s;
}

export async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    (async () => {
      await delay(ms);
      throw new Error(`timeout after ${ms}ms`);
    })(),
  ]);
}

/**
 * Core SMS handler logic in a testable form.
 *
 * Returns { twiml, didAck, startAsync }.
 */
export async function handleIncomingSms({
  form,
  allowFrom = [],
  ackText = "Got it - thinking. I'll text you back in a moment.",
  fastTimeoutMs = 9000,
  maxChars = 280,
  deps,
  log = () => {},
}) {
  if (!deps?.openclawReply) throw new Error("deps.openclawReply required");

  const from = form?.From;
  const to = form?.To;
  const text = form?.Body;
  const fromNormalized = from?.trim()?.startsWith("+") ? from?.trim() : `+${from?.trim()}`;

  log(`[twilio-sms] incoming from ${from} to ${to}: ${text}`);

  // Log to Discord if configured
  if (deps?.discordLog) {
    void deps.discordLog({ text: `💬 **SMS (${from})**: ${text}` }).catch(() => {});
  }

  // For SMS: accept from anyone, but only reply if sender is allowed
  const isAllowedSender = !allowFrom.length || (fromNormalized && allowFrom.includes(fromNormalized));
  
  if (!isAllowedSender) {
    log(`[twilio-sms] sender not in allowlist, rejecting: ${fromNormalized}`);
    return {
      twiml: twimlMessage("Unauthorized"),
      didAck: false,
      startAsync: null,
    };
  }

  const smsFrom = deps.smsFrom || to;

  // Try fast path
  try {
    const fastReplyRaw = await withTimeout(deps.openclawReply({ userText: text, mode: "sms" }), fastTimeoutMs);
    const fastReply = normalizeSmsText(fastReplyRaw || "Okay", { maxChars });
    log(`[twilio-sms] reply (fast): ${fastReply}`);
    return {
      twiml: twimlMessage(fastReply),
      didAck: false,
      startAsync: null,
    };
  } catch (err) {
    log(`[twilio-sms] slow path: ${String(err)}`);
  }

  // Slow path: ack now, then async send
  const startAsync = async () => {
    let reply;
    try {
      const replyRaw = await deps.openclawReply({ userText: text, mode: "sms" });
      reply = normalizeSmsText(replyRaw || "Okay", { maxChars });
      log(`[twilio-sms] reply (async): ${reply}`);
    } catch (e) {
      log(`[twilio-sms] async openclawReply error: ${String(e)}`);
      reply = "Sorry — I hit an error generating a reply.";
    }

    if (!deps.twilioSendSms) {
      log("[twilio-sms] twilioSendSms not configured; skipping async send");
      return;
    }

    try {
      const sent = await deps.twilioSendSms({ to: from, from: smsFrom, body: reply });
      log(`[twilio-sms] async send ok sid=${sent?.sid || sent?.messageSid || "(unknown)"}`);
    } catch (e) {
      log(`[twilio-sms] async send failed: ${String(e)}`);
    }
  };

  return {
    twiml: twimlMessage(ackText),
    didAck: true,
    startAsync,
  };
}
