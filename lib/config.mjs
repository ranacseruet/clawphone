/**
 * Centralized configuration with sensible defaults.
 * All magic numbers and repeated values live here.
 */

// Load .env file
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '..', '.env') });

// Server
export const PORT = Number(process.env.PORT || 8787);
export const ALLOW_FROM = (process.env.ALLOW_FROM || "").split(",").map(s => s.trim()).filter(Boolean);

// Twilio credentials
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
export const TWILIO_SMS_FROM = process.env.TWILIO_SMS_FROM;

// OpenClaw
export const OPENCLAW_PHONE_SESSION_ID = process.env.OPENCLAW_PHONE_SESSION_ID || "phone-rana";
export const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID || "phone";
export const OPENCLAW_TIMEOUT_SECONDS = 120;
export const OPENCLAW_MAX_CONCURRENT = Number(process.env.OPENCLAW_MAX_CONCURRENT || 10);

// Voice settings
export const TWILIO_VOICE = "Google.en-US-Chirp3-HD-Charon";

// Timeouts (milliseconds)
export const SMS_FAST_TIMEOUT_MS = Number(process.env.SMS_FAST_TIMEOUT_MS || 15000); // Max time to wait before acking SMS
export const SPEECH_WAIT_PAUSE_SECONDS = 2;    // Pause between /speech-wait polls
export const GATHER_TIMEOUT_SECONDS = 10;      // Initial gather timeout
export const GATHER_FOLLOWUP_TIMEOUT_SECONDS = 12; // Follow-up gather timeout

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
