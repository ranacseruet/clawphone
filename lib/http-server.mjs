// @ts-check
import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";

import { handleIncomingSms } from "./sms.mjs";
import { createTwilioClient, validateWebhookSignature } from "./twilio.mjs";
import { parseForm, toSayableText, readBody } from "./utils.mjs";
import { openclawReply, discordLog } from "./agent.mjs";
import {
  createPendingTurn,
  getPendingTurn,
  isLatestTurn,
  completeTurn,
  deleteTurn,
  cleanupStaleTurns,
} from "./voice-state.mjs";
import * as twiml from "./twiml.mjs";

/**
 * Create and start the Twilio gateway HTTP server.
 *
 * @param {object}      config - Server configuration (see lib/config.mjs for shape)
 * @param {object|null} [api]  - OpenClaw plugin api object, or null in standalone mode.
 *                               When provided, agent calls go in-process via
 *                               runEmbeddedPiAgent instead of spawning the CLI.
 * @returns {Promise<http.Server>} Resolves once the server is listening.
 */
export async function createServer(config, api = null) {
  const {
    PORT,
    ALLOW_FROM,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_SMS_FROM,
    PUBLIC_BASE_URL,
    SMS_MAX_CHARS,
    SMS_FAST_TIMEOUT_MS,
    MAX_SAYABLE_LENGTH,
    CALLER_NAME,
    AGENT_NAME,
    GREETING_TEXT,
    getRandomThinkingPhrase,
  } = config;

  // Wrappers that thread the plugin api through to agent.mjs.
  // In standalone mode (api=null) these fall back to the CLI subprocess path.
  const _openclawReply = ({ userText, mode }) => openclawReply({ userText, mode, callerName: CALLER_NAME, _api: api });
  const _discordLog = ({ text }) => discordLog({ text, _api: api });

  if (TWILIO_AUTH_TOKEN && !PUBLIC_BASE_URL) {
    console.warn("[clawphone] WARNING: TWILIO_AUTH_TOKEN is set but PUBLIC_BASE_URL is not — webhook signature validation will be skipped.");
  }

  const twilioClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
    ? createTwilioClient({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN })
    : null;

  // ─────────────────────────────────────────────────────────────
  // Webhook signature validation
  // ─────────────────────────────────────────────────────────────

  function checkSignature(req, parsedBody) {
    if (!TWILIO_AUTH_TOKEN || !PUBLIC_BASE_URL) return true; // skip when unconfigured (dev/test)
    const sig = req.headers["x-twilio-signature"] || "";
    const url = `${PUBLIC_BASE_URL}${req.url}`;
    return validateWebhookSignature({ authToken: TWILIO_AUTH_TOKEN, signature: sig, url, params: parsedBody });
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP Server
  // ─────────────────────────────────────────────────────────────

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);

    // Health check
    if (req.method === "GET" && u.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Voice webhook - initial call handling
    if (req.method === "POST" && u.pathname === "/voice") {
      let body;
      try { body = await readBody(req); }
      catch (err) {
        res.writeHead(err.statusCode || 500, { "content-type": "text/plain" });
        res.end(err.message); return;
      }
      const form = parseForm(body);
      if (!checkSignature(req, form)) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Forbidden"); return;
      }
      const from = form.From?.trim();
      // Normalize: add + if missing
      const fromNormalized = from?.startsWith("+") ? from : `+${from}`;
      console.log(`[clawphone:voice] call from ${fromNormalized} callSid=${form.CallSid ?? "unknown"}`);

      // Check allowlist
      if (ALLOW_FROM.length && fromNormalized && !ALLOW_FROM.includes(fromNormalized)) {
        console.warn(`[clawphone:voice] rejected call from ${fromNormalized} (not in allowlist)`);
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(twiml.sayAndHangup("Sorry, this number is not authorized."));
        return;
      }

      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twiml.greetingWithGather(GREETING_TEXT));
      return;
    }

    // Speech webhook - user finished speaking
    if (req.method === "POST" && u.pathname === "/speech") {
      let body;
      try { body = await readBody(req); }
      catch (err) {
        res.writeHead(err.statusCode || 500, { "content-type": "text/plain" });
        res.end(err.message); return;
      }
      const form = parseForm(body);
      if (!checkSignature(req, form)) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Forbidden"); return;
      }
      const from = form.From;
      const callSid = form.CallSid || "nocallsid";

      // Check allowlist
      if (ALLOW_FROM.length && from && !ALLOW_FROM.includes(from)) {
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(twiml.sayAndHangup("Sorry, this number is not authorized."));
        return;
      }

      const said = (form.SpeechResult || "").trim();
      console.log(`[clawphone:voice] speech callSid=${callSid}: ${said || "(empty)"}`);

      // Create pending turn
      const turnId = crypto.randomUUID();
      const key = `${callSid}:${turnId}`;
      createPendingTurn({ key, callSid, from, said });

      // Log to Discord
      if (said) {
        const callerLabel = CALLER_NAME ? `Phone (${CALLER_NAME})` : "Phone";
        void _discordLog({ text: `📞 **${callerLabel}**: ${said}` }).catch((e) =>
          console.error(`[clawphone:voice] discordLog error: ${String(e)}`)
        );
      }

      // Start async reply generation
      (async () => {
        let reply;
        try {
          reply = said
            ? await _openclawReply({ userText: said, mode: "voice" })
            : "I did not catch that.";
        } catch (err) {
          console.error(`[clawphone:voice] agent error callSid=${callSid}: ${String(err)}`);
          reply = "Sorry — I hit an error generating a reply.";
        }

        if (reply) {
          const agentLabel = AGENT_NAME || "Agent";
          void _discordLog({ text: `📞 **${agentLabel}**: ${reply}` }).catch((e) =>
            console.error(`[clawphone:voice] discordLog error: ${String(e)}`)
          );
        }

        completeTurn(key, reply || "Okay.");
      })().catch(() => {});

      // Respond immediately with thinking phrase
      const phrase = getRandomThinkingPhrase();
      console.log(`[clawphone:voice] turn ${key} queued, waiting for agent`);

      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twiml.thinkingRedirect(phrase, `/speech-wait?key=${encodeURIComponent(key)}`));
      return;
    }

    // Speech wait webhook - polling for reply
    if (req.method === "POST" && u.pathname === "/speech-wait") {
      let waitBody;
      try { waitBody = await readBody(req); }
      catch (err) {
        res.writeHead(err.statusCode || 500, { "content-type": "text/plain" });
        res.end(err.message); return;
      }
      const waitForm = parseForm(waitBody);
      if (!checkSignature(req, waitForm)) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Forbidden"); return;
      }
      const key = u.searchParams.get("key") || "";
      const item = getPendingTurn(key);

      // No pending turn found
      if (!item) {
        console.warn(`[clawphone:voice] turn not found for key=${key}, hanging up`);
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(twiml.sayAndHangup("Okay."));
        return;
      }

      // Check if this is still the latest turn (prevents stale answers)
      if (!isLatestTurn(key, item.callSid)) {
        console.log(`[clawphone:voice] turn ${key} superseded, discarding`);
        deleteTurn(key);
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(twiml.sayAndRedirect("Okay.", "/speech"));
        return;
      }

      // Still waiting for reply
      if (!item.done) {
        console.log(`[clawphone:voice] turn ${key} still pending, polling`);
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(twiml.pauseAndRedirect(`/speech-wait?key=${encodeURIComponent(key)}`));
        return;
      }

      // Reply is ready!
      const reply = toSayableText(item.reply || "Okay.", MAX_SAYABLE_LENGTH);
      deleteTurn(key);

      console.log(`[clawphone:voice] turn ${key} delivering reply (${reply.length} chars)`);

      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twiml.replyWithGather(reply));
      return;
    }

    // SMS webhook
    if (req.method === "POST" && u.pathname === "/sms") {
      let body;
      try { body = await readBody(req); }
      catch (err) {
        res.writeHead(err.statusCode || 500, { "content-type": "text/plain" });
        res.end(err.message); return;
      }
      const start = Date.now();
      const form = parseForm(body);
      if (!checkSignature(req, form)) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Forbidden"); return;
      }

      const { twiml: twimlResponse, didAck, startAsync } = await handleIncomingSms({
        form,
        allowFrom: ALLOW_FROM,
        fastTimeoutMs: SMS_FAST_TIMEOUT_MS,
        maxChars: SMS_MAX_CHARS,
        deps: {
          openclawReply: _openclawReply,
          discordLog: _discordLog,
          twilioSendSms: twilioClient?.sendSms,
          smsFrom: TWILIO_SMS_FROM,
        },
        log: (line) => console.log(line),
        error: (line) => console.error(line),
      });

      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twimlResponse);
      console.log(`[clawphone:sms] responded in ${Date.now() - start}ms${didAck ? " (ack)" : ""}`);

      if (startAsync) startAsync().catch(() => {});
      return;
    }

    // 404
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  setInterval(() => cleanupStaleTurns(), 60_000).unref();

  // ─────────────────────────────────────────────────────────────
  // Start server
  // ─────────────────────────────────────────────────────────────

  await new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`[clawphone] listening on http://localhost:${PORT}`);
      console.log(`[clawphone] health: http://localhost:${PORT}/health`);
      if (ALLOW_FROM.length) {
        console.log(`[clawphone] allowlist: ${ALLOW_FROM.length} number(s) configured`);
      }
      resolve();
    });
  });

  return server;
}
