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

// Public base URL for webhook signature validation (e.g. https://twilio.i2dev.com)
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

// OpenClaw
export const OPENCLAW_PHONE_SESSION_ID = process.env.OPENCLAW_PHONE_SESSION_ID || "phone";
export const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID || "phone";

// Display names (used in voice greeting, Discord logs, and agent prompt framing)
export const CALLER_NAME = process.env.CALLER_NAME || "";
export const AGENT_NAME = process.env.AGENT_NAME || "";
export const GREETING_TEXT = process.env.GREETING_TEXT || "You are connected. Say something after the beep.";
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

/**
 * Translate a camelCase OpenClaw plugin config object into the SCREAMING_SNAKE_CASE
 * shape used throughout the rest of the codebase.
 *
 * Used by index.mjs (plugin path). The env-var exports above remain the standalone path.
 *
 * @param {object} cfg - Validated plugin config from openclaw.plugin.json configSchema
 */
export function fromPluginConfig(cfg) {
  const phrases = [
    "Hmm, give me a second.",
    "Umm, let me think.",
    "Got it. One moment while I think.",
    "Let me check my notes.",
    "Sure thing, just a moment.",
    "Okay, let me see.",
  ];
  return {
    PORT:                       cfg.port                  ?? 8787,
    ALLOW_FROM:                 cfg.allowFrom             ?? [],
    TWILIO_ACCOUNT_SID:         cfg.twilioAccountSid      ?? "",
    TWILIO_AUTH_TOKEN:          cfg.twilioAuthToken       ?? "",
    TWILIO_SMS_FROM:            cfg.twilioSmsFrom         ?? "",
    PUBLIC_BASE_URL:            cfg.publicBaseUrl         ?? "",
    OPENCLAW_PHONE_SESSION_ID:  cfg.openclawSessionId     ?? "phone",
    OPENCLAW_AGENT_ID:          cfg.openclawAgentId       ?? "phone",
    OPENCLAW_MAX_CONCURRENT:    cfg.openclawMaxConcurrent ?? 10,
    DISCORD_LOG_CHANNEL_ID:     cfg.discordLogChannelId   ?? "",
    CALLER_NAME:                cfg.callerName            ?? "",
    AGENT_NAME:                 cfg.agentName             ?? "",
    GREETING_TEXT:              cfg.greetingText          ?? "You are connected. Say something after the beep.",
    SMS_MAX_CHARS:              cfg.smsMaxChars           ?? 280,
    SMS_FAST_TIMEOUT_MS:        cfg.smsFastTimeoutMs      ?? 15000,
    // Static values — not exposed as plugin config knobs
    OPENCLAW_TIMEOUT_SECONDS:         120,
    TWILIO_VOICE:                     "Google.en-US-Chirp3-HD-Charon",
    MAX_SAYABLE_LENGTH:               600,
    SPEECH_WAIT_PAUSE_SECONDS:        2,
    GATHER_TIMEOUT_SECONDS:           10,
    GATHER_FOLLOWUP_TIMEOUT_SECONDS:  12,
    THINKING_PHRASES:                 phrases,
    getRandomThinkingPhrase() {
      return phrases[Math.floor(Math.random() * phrases.length)];
    },
  };
}
