import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { run as defaultRun } from "./utils.mjs";
import { MULAW_FRAME_BYTES, MULAW_FRAME_INTERVAL_MS } from "./config.mjs";

/**
 * Convert text to mu-law audio file using macOS TTS.
 * 
 * @param {Object} options
 * @param {string} options.text - Text to speak
 * @param {string} options.outMulawPath - Output path for mu-law file
 * @param {Function} [options.run] - Optional run function for testing
 */
export async function ttsToMulaw({ text, outMulawPath, run = defaultRun }) {
  // Use macOS built-in TTS to avoid extra API setup.
  // 1) say -> AIFF
  // 2) ffmpeg -> 8kHz mono mu-law raw
  const aiffPath = outMulawPath.replace(/\.mulaw$/i, ".aiff");
  await run("say", ["-o", aiffPath, text]);
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    aiffPath,
    "-ar",
    "8000",
    "-ac",
    "1",
    "-f",
    "mulaw",
    outMulawPath,
  ]);
  // cleanup AIFF
  void fs.unlink(aiffPath).catch(() => {});
}

/**
 * Stream mu-law audio file to Twilio WebSocket.
 * Sends frames at proper intervals for real-time playback.
 * 
 * @param {Object} options
 * @param {WebSocket} options.ws - WebSocket connection
 * @param {string} options.streamSid - Twilio stream SID
 * @param {string} options.mulawPath - Path to mu-law audio file
 */
export async function streamMulawToTwilio({ ws, streamSid, mulawPath }) {
  const buf = await fs.readFile(mulawPath);

  let offset = 0;
  return await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (offset >= buf.length) {
        clearInterval(timer);
        resolve();
        return;
      }

      const chunk = buf.subarray(offset, offset + MULAW_FRAME_BYTES);
      offset += MULAW_FRAME_BYTES;

      const msg = {
        event: "media",
        streamSid,
        media: {
          payload: chunk.toString("base64"),
        },
      };
      ws.send(JSON.stringify(msg));
    }, MULAW_FRAME_INTERVAL_MS);
  });
}

/**
 * High-level: generate TTS and stream to caller.
 * Handles temp file creation and cleanup.
 * 
 * @param {Object} options
 * @param {WebSocket} options.ws - WebSocket connection
 * @param {string} options.streamSid - Twilio stream SID
 * @param {string} options.text - Text to speak
 * @param {Function} [options.run] - Optional run function for testing
 */
export async function sayToCaller({ ws, streamSid, text, run = defaultRun }) {
  const outMulaw = path.join(os.tmpdir(), `twilio-tts-${crypto.randomUUID()}.mulaw`);
  try {
    await ttsToMulaw({ text, outMulawPath: outMulaw, run });
    await streamMulawToTwilio({ ws, streamSid, mulawPath: outMulaw });
  } finally {
    void fs.unlink(outMulaw).catch(() => {});
  }
}
