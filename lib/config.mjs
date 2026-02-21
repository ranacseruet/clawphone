/**
 * Centralized configuration with sensible defaults.
 * All magic numbers and repeated values live here.
 */

// Load .env file
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      // Remove quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
} catch (e) {
  // No .env file or error reading it - that's fine
}

// Server
export const PORT = Number(process.env.PORT || 8787);
export const PUBLIC_BASE = process.env.PUBLIC_BASE;
export const USE_MEDIA_STREAMS = String(process.env.USE_MEDIA_STREAMS || "").toLowerCase() === "true";
export const ALLOW_FROM = (process.env.ALLOW_FROM || "").split(",").map(s => s.trim()).filter(Boolean);

// Twilio credentials
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
export const TWILIO_SMS_FROM = process.env.TWILIO_SMS_FROM;

// OpenClaw
export const OPENCLAW_PHONE_SESSION_ID = process.env.OPENCLAW_PHONE_SESSION_ID || "phone-rana";
export const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID || "phone";
export const OPENCLAW_TIMEOUT_SECONDS = 120;

// Voice settings
export const TWILIO_VOICE = "Google.en-US-Chirp3-HD-Charon";

// Timeouts (milliseconds)
export const SMS_FAST_TIMEOUT_MS = 15000;       // Max time to wait before acking SMS
export const SPEECH_WAIT_PAUSE_SECONDS = 2;    // Pause between /speech-wait polls
export const GATHER_TIMEOUT_SECONDS = 10;      // Initial gather timeout
export const GATHER_FOLLOWUP_TIMEOUT_SECONDS = 12; // Follow-up gather timeout

// Media Streams / VAD
export const SILENCE_MS = 900;                 // Silence threshold for end-of-utterance
export const VAD_CHECK_INTERVAL_MS = 150;      // How often to check for silence

// Audio encoding
export const MULAW_SAMPLE_RATE = 8000;
export const MULAW_FRAME_BYTES = 160;          // 20ms at 8kHz
export const MULAW_FRAME_INTERVAL_MS = 20;

// SMS
export const SMS_MAX_CHARS = Number(process.env.SMS_MAX_CHARS || 280);

// Sayable text
export const MAX_SAYABLE_LENGTH = 600;

// Discord logging
export const DISCORD_LOG_CHANNEL_ID = process.env.DISCORD_LOG_CHANNEL_ID;

// Thinking phrases for voice responses
export const THINKING_PHRASES = [
  "Hmm, give me a second.",
  "Umm, let me think.",
  "Got it. One moment while I think.",
  "Let me check my notes.",
  "Sure thing, just a moment.",
  "Okay, let me see."
];

export function getRandomThinkingPhrase() {
  return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
}
