import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";

// Local modules
import { handleIncomingSms } from "./lib/sms.mjs";
import { createTwilioClient } from "./lib/twilio.mjs";
import { parseForm, toSayableText } from "./lib/utils.mjs";
import { openclawReply, discordLog } from "./lib/agent.mjs";
import { sayToCaller } from "./lib/tts.mjs";
import { transcribeMulawToText } from "./lib/transcription.mjs";
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
  PUBLIC_BASE,
  USE_MEDIA_STREAMS,
  ALLOW_FROM,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM,
  SMS_MAX_CHARS,
  SMS_FAST_TIMEOUT_MS,
  SILENCE_MS,
  VAD_CHECK_INTERVAL_MS,
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

      // Default mode: Twilio's speech recognition via <Gather>
      if (!USE_MEDIA_STREAMS) {
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(twiml.greetingWithGather(
          "Hi Rana. You are connected to Tom. Say something after the beep."
        ));
        return;
      }

      // Media Streams mode
      if (!PUBLIC_BASE) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("PUBLIC_BASE env var is required for Media Streams mode");
        return;
      }

      const wsUrl = PUBLIC_BASE.replace(/^http/, "ws") + "/media";
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(twiml.connectMediaStream("Hi Rana. You are connected to Tom.", wsUrl));
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
// WebSocket Server (Media Streams mode)
// ─────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  const callId = crypto.randomUUID();
  let streamSid = null;

  // Utterance tracking for turn-taking
  let utteranceId = 0;
  let utteranceMulawPath = null;
  let lastAudioAt = Date.now();
  let replying = false;

  async function startNewUtterance() {
    utteranceId += 1;
    utteranceMulawPath = path.join(os.tmpdir(), `twilio-${callId}-utt-${utteranceId}.mulaw`);
    await fs.writeFile(utteranceMulawPath, Buffer.alloc(0));
  }

  // Simple turn-taking: if no inbound audio for SILENCE_MS, assume user stopped
  const interval = setInterval(async () => {
    if (!streamSid || !utteranceMulawPath) return;
    if (replying) return;

    const now = Date.now();
    if (now - lastAudioAt < SILENCE_MS) return;

    // Attempt to transcribe and respond
    replying = true;
    const mulawPath = utteranceMulawPath;
    utteranceMulawPath = null;

    try {
      const text = await transcribeMulawToText({ mulawPath });
      console.log(`[twilio] utterance transcript: ${text || "(empty)"}`);

      // TODO: Replace with actual agent call
      const reply = text ? `I heard: ${text}` : "I did not catch that.";
      await sayToCaller({ ws, streamSid, text: reply });
    } catch (err) {
      console.error(`[twilio] utterance handling error: ${String(err)}`);
    } finally {
      void fs.unlink(mulawPath).catch(() => {});
      void fs.unlink(mulawPath.replace(/\.mulaw$/i, ".wav")).catch(() => {});
      replying = false;
      await startNewUtterance().catch(() => {});
    }
  }, VAD_CHECK_INTERVAL_MS);

  ws.on("close", () => clearInterval(interval));

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      return;
    }

    if (msg.event === "start") {
      streamSid = msg.streamSid || msg.start?.streamSid;
      console.log(`[twilio] start streamSid=${streamSid} callSid=${msg.start?.callSid}`);
      await startNewUtterance();

      // Quick hello as proof the outbound stream works
      await sayToCaller({ ws, streamSid, text: "Streaming voice is online." });
      return;
    }

    if (msg.event === "media") {
      const payload = msg.media?.payload;
      if (!payload) return;
      const buf = Buffer.from(payload, "base64");

      // Drop inbound audio while replying to avoid feedback
      if (replying) return;

      lastAudioAt = Date.now();
      if (!utteranceMulawPath) {
        await startNewUtterance();
      }
      await fs.appendFile(utteranceMulawPath, buf);
      return;
    }

    if (msg.event === "stop") {
      console.log(`[twilio] stop streamSid=${streamSid}`);
      return;
    }
  });
});

server.on("upgrade", (req, socket, head) => {
  // Only accept WS upgrades in Media Streams mode
  if (!USE_MEDIA_STREAMS) {
    socket.destroy();
    return;
  }
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname !== "/media") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// ─────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`twilio-phone-gateway listening on http://localhost:${PORT}`);
  console.log(`health: http://localhost:${PORT}/health`);
  console.log(`mode: ${USE_MEDIA_STREAMS ? "media-streams" : "gather-speech"}`);
  if (USE_MEDIA_STREAMS && !PUBLIC_BASE) {
    console.log("NOTE: set PUBLIC_BASE once cloudflared URL is known");
  }
  if (ALLOW_FROM.length) {
    console.log(`allowlist From numbers: ${ALLOW_FROM.join(", ")}`);
  }
});
