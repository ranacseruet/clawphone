import { run as defaultRun, createSemaphore } from "./utils.mjs";
import {
  OPENCLAW_AGENT_ID,
  OPENCLAW_PHONE_SESSION_ID,
  OPENCLAW_TIMEOUT_SECONDS,
  OPENCLAW_MAX_CONCURRENT,
  SMS_MAX_CHARS,
  DISCORD_LOG_CHANNEL_ID,
} from "./config.mjs";

const agentSem = createSemaphore(OPENCLAW_MAX_CONCURRENT);
let discordInFlight = 0;
const DISCORD_MAX_IN_FLIGHT = 5;

/**
 * Log a message to Discord (fire-and-forget).
 * @param {Object} options
 * @param {string} options.text - Message to log
 * @param {Function} [options.run] - Optional run function for testing
 */
export async function discordLog({ text, run = defaultRun }) {
  if (!DISCORD_LOG_CHANNEL_ID) return;
  if (discordInFlight >= DISCORD_MAX_IN_FLIGHT) return;
  discordInFlight++;
  try {
    const target = `channel:${DISCORD_LOG_CHANNEL_ID}`;
    await run("openclaw", [
      "message",
      "send",
      "--channel",
      "discord",
      "--target",
      target,
      "--message",
      text,
    ]);
  } finally {
    discordInFlight--;
  }
}

/**
 * Get a reply from OpenClaw agent.
 * 
 * @param {Object} options
 * @param {string} options.userText - The user's message
 * @param {'voice'|'sms'} options.mode - Response mode (affects prompting)
 * @param {Function} [options.run] - Optional run function for testing
 * @returns {Promise<string>} The agent's reply text
 */
export async function openclawReply({ userText, mode = "voice", run = defaultRun }) {
  const instruction =
    mode === "sms"
      ? `Reply via SMS. Keep it concise: <= ${SMS_MAX_CHARS} characters. Use plain ASCII only (no emojis, no curly quotes, no em-dashes). No markdown. If too long, answer with the single most important sentence.`
      : "";

  const prompt =
    mode === "sms"
      ? `SMS (Rana): ${userText}\n\n${instruction}`
      : `Phone call (Rana): ${userText}`;

  await agentSem.acquire();
  try {
    const { stdout } = await run("openclaw", [
      "agent",
      "--agent",
      OPENCLAW_AGENT_ID,
      "--session-id",
      OPENCLAW_PHONE_SESSION_ID,
      "--channel",
      "discord",
      "--message",
      prompt,
      "--thinking",
      "off",
      "--json",
      "--timeout",
      String(OPENCLAW_TIMEOUT_SECONDS),
    ]);

    // Try to be resilient to schema differences.
    try {
      const j = JSON.parse(stdout);
      return (
        j?.result?.payloads?.[0]?.text ||
        j?.reply?.text ||
        j?.message?.content ||
        j?.content ||
        j?.text ||
        j?.output?.text ||
        ""
      ).trim();
    } catch {
      return stdout.trim();
    }
  } finally {
    agentSem.release();
  }
}
