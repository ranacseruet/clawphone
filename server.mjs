import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";

// Local modules
import { handleIncomingSms } from "./lib/sms.mjs";
import { createTwilioClient } from "./lib/twilio.mjs";
import { parseForm, toSayableText } from "./lib/utils.mjs";
import { openclawReply, discordLog } from "./lib/agent.mjs";
import {
  createPendingTurn,
  getPendingTurn,
  isLatestTurn,
  completeTurn,
  deleteTurn,
} from "./lib/voice-state.mjs";
import * as twiml from "./lib/twiml.mjs";
import {
  PORT,
  ALLOW_FROM,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM,
  SMS_MAX_CHARS,
  SMS_FAST_TIMEOUT_MS,
  MAX_SAYABLE_LENGTH,
  getRandomThinkingPhrase,
} from "./lib/config.mjs";

// Initialize Twilio client (for async SMS follow-ups)
const twilioClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
  ? createTwilioClient({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN })
  : null;

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
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = parseForm(body);
      const from = form.From?.trim();
      // Normalize: add + if missing
      const fromNormalized = from?.startsWith("+") ? from : `+${from}`;
      console.log("[voice] from:", from, "fromNorm:", fromNormalized, "allowlist:", ALLOW_FROM);

      // Check allowlist
      if (ALLOW_FROM.length && fromNormalized && !ALLOW_FROM.includes(fromNormalized)) {
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(twiml.sayAndHangup("Sorry, this number is not authorized."));
        return;
      }

      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twiml.greetingWithGather(
        "Hi Rana. You are connected to Tom. Say something after the beep."
      ));
    });
    return;
  }

  // Speech webhook - user finished speaking
  if (req.method === "POST" && u.pathname === "/speech") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = parseForm(body);
      const from = form.From;
      const callSid = form.CallSid || "nocallsid";

      // Check allowlist
      if (ALLOW_FROM.length && from && !ALLOW_FROM.includes(from)) {
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(twiml.sayAndHangup("Sorry, this number is not authorized."));
        return;
      }

      const said = (form.SpeechResult || "").trim();
      console.log(`[twilio] SpeechResult: ${said || "(empty)"}`);

      // Create pending turn
      const turnId = crypto.randomUUID();
      const key = `${callSid}:${turnId}`;
      createPendingTurn({ key, callSid, from, said });

      // Log to Discord
      if (said) {
        void discordLog({ text: `📞 **Phone (Rana)**: ${said}` }).catch((e) =>
          console.error(`[discordLog] ${String(e)}`)
        );
      }

      // Start async reply generation
      (async () => {
        let reply;
        try {
          reply = said
            ? await openclawReply({ userText: said, mode: "voice" })
            : "I did not catch that.";
        } catch (err) {
          console.error(`[openclawReply] ${String(err)}`);
          reply = "Sorry — I hit an error generating a reply.";
        }

        if (reply) {
          void discordLog({ text: `📞 **Tom**: ${reply}` }).catch((e) =>
            console.error(`[discordLog] ${String(e)}`)
          );
        }

        completeTurn(key, reply || "Okay.");
      })().catch(() => {});

      // Respond immediately with thinking phrase
      const phrase = getRandomThinkingPhrase();
      console.log(`[twilio] redirecting to /speech-wait key=${key}`);
      
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twiml.thinkingRedirect(phrase, `/speech-wait?key=${encodeURIComponent(key)}`));
    });
    return;
  }

  // Speech wait webhook - polling for reply
  if (req.method === "POST" && u.pathname === "/speech-wait") {
    const key = u.searchParams.get("key") || "";
    const item = getPendingTurn(key);

    // No pending turn found
    if (!item) {
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twiml.sayAndHangup("Okay."));
      return;
    }

    // Check if this is still the latest turn (prevents stale answers)
    if (!isLatestTurn(key, item.callSid)) {
      deleteTurn(key);
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twiml.sayAndRedirect("Okay.", "/speech"));
      return;
    }

    // Still waiting for reply
    if (!item.done) {
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twiml.pauseAndRedirect(`/speech-wait?key=${encodeURIComponent(key)}`));
      return;
    }

    // Reply is ready!
    const reply = toSayableText(item.reply || "Okay.", MAX_SAYABLE_LENGTH);
    deleteTurn(key);

    console.log(`[twilio] delivering reply (${reply.length} chars)`);

    res.writeHead(200, { "content-type": "text/xml" });
    res.end(twiml.replyWithGather(reply));
    return;
  }

  // SMS webhook
  if (req.method === "POST" && u.pathname === "/sms") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const start = Date.now();
      const form = parseForm(body);

      const { twiml: twimlResponse, didAck, startAsync } = await handleIncomingSms({
        form,
        allowFrom: ALLOW_FROM,
        fastTimeoutMs: SMS_FAST_TIMEOUT_MS,
        maxChars: SMS_MAX_CHARS,
        deps: {
          openclawReply,
          discordLog,
          twilioSendSms: twilioClient?.sendSms,
          smsFrom: TWILIO_SMS_FROM,
        },
        log: (line) => console.log(line),
      });

      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twimlResponse);
      console.log(`[twilio-sms] responded in ${Date.now() - start}ms${didAck ? " (ack)" : ""}`);

      if (startAsync) startAsync().catch(() => {});
    });
    return;
  }

  // 404
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

// ─────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`twilio-phone-gateway listening on http://localhost:${PORT}`);
  console.log(`health: http://localhost:${PORT}/health`);
  if (ALLOW_FROM.length) {
    console.log(`allowlist From numbers: ${ALLOW_FROM.join(", ")}`);
  }
});
