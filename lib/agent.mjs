// @ts-check
import crypto from "node:crypto";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
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

// ─────────────────────────────────────────────────────────────
// Plugin path: lazy-load runEmbeddedPiAgent from openclaw dist
// ─────────────────────────────────────────────────────────────

let _coreDeps = null;

async function _getCoreDeps() {
  if (_coreDeps) return _coreDeps;
  // The plugin runs inside the openclaw process; process.argv[1] is the openclaw
  // entry point (e.g. /.../openclaw/dist/index.js). extensionAPI.js lives alongside it.
  const distPath = join(dirname(process.argv[1]), "extensionAPI.js");
  _coreDeps = await import(pathToFileURL(distPath).href);
  return _coreDeps;
}

// ─────────────────────────────────────────────────────────────
// Shared prompt builder (same framing for both paths)
// ─────────────────────────────────────────────────────────────

function _buildPrompt(userText, mode, callerName = "") {
  const caller = callerName ? ` (${callerName})` : "";
  if (mode === "sms") {
    const instruction =
      `Reply via SMS. Keep it concise: <= ${SMS_MAX_CHARS} characters. ` +
      `Use plain ASCII only (no emojis, no curly quotes, no em-dashes). ` +
      `No markdown. If too long, answer with the single most important sentence.`;
    return `SMS${caller}: ${userText}\n\n${instruction}`;
  }
  return `Phone call${caller}: ${userText}`;
}

// ─────────────────────────────────────────────────────────────
// discordLog
// ─────────────────────────────────────────────────────────────

/**
 * Log a message to Discord (fire-and-forget).
 *
 * Plugin path (_api provided): calls api.runtime.channel.discord.sendMessageDiscord.
 * Standalone / PM2 path: spawns `openclaw message send` CLI subprocess.
 *
 * @param {object} options
 * @param {string}   options.text   - Message to log
 * @param {Function} [options.run]  - Injectable run fn (standalone path, for testing)
 * @param {object}   [options._api] - OpenClaw plugin api object (plugin path)
 */
export async function discordLog({ text, run = defaultRun, _api }) {
  if (!DISCORD_LOG_CHANNEL_ID) return;

  // ── Plugin path ────────────────────────────────────────────────────────
  if (_api) {
    return _api.runtime.channel.discord
      .sendMessageDiscord(DISCORD_LOG_CHANNEL_ID, text, { accountId: "default" })
      .catch(() => {});
  }

  // ── Standalone / PM2 path ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// openclawReply
// ─────────────────────────────────────────────────────────────

/**
 * Get a reply from the OpenClaw agent.
 *
 * Plugin path (_api provided): calls runEmbeddedPiAgent in-process via
 * openclaw/dist/extensionAPI.js. Pass _coreDeps to inject a mock in tests.
 *
 * Standalone / PM2 path: spawns `openclaw agent` CLI subprocess.
 *
 * @param {object}   options
 * @param {string}   options.userText    - The user's message
 * @param {'voice'|'sms'} [options.mode] - Response mode (affects prompt framing)
 * @param {string}   [options.callerName] - Optional caller name for prompt framing
 * @param {Function} [options.run]        - Injectable run fn (standalone path, for testing)
 * @param {object}   [options._api]       - OpenClaw plugin api object (plugin path)
 * @param {object}   [options._coreDeps]  - Injectable core deps (plugin path, for testing)
 * @returns {Promise<string>} The agent's reply text
 */
export async function openclawReply({ userText, mode = "voice", callerName = "", run = defaultRun, _api, _coreDeps }) {
  // ── Plugin path ────────────────────────────────────────────────────────
  if (_api) {
    const deps = _coreDeps ?? await _getCoreDeps();
    const cfg = _api.config;
    const agentId = OPENCLAW_AGENT_ID;
    // Session key scoped by mode so voice and SMS maintain separate histories
    const sessionKey = `${mode}:${OPENCLAW_PHONE_SESSION_ID}`;

    const storePath = deps.resolveStorePath(cfg.session?.store, { agentId });
    const agentDir = deps.resolveAgentDir(cfg, agentId);
    const workspaceDir = deps.resolveAgentWorkspaceDir(cfg, agentId);
    await deps.ensureAgentWorkspace({ dir: workspaceDir });

    const store = deps.loadSessionStore(storePath);
    const entry = store[sessionKey] ?? { sessionId: crypto.randomUUID(), updatedAt: Date.now() };
    store[sessionKey] = { ...entry, updatedAt: Date.now() };
    await deps.saveSessionStore(storePath, store);

    const sessionFile = deps.resolveSessionFilePath(entry.sessionId, entry, { agentId });
    const timeoutMs = deps.resolveAgentTimeoutMs({ cfg });

    await agentSem.acquire();
    try {
      const result = await deps.runEmbeddedPiAgent({
        sessionId:       entry.sessionId,
        sessionKey,
        messageProvider: mode,
        sessionFile,
        workspaceDir,
        agentDir,
        config:          cfg,
        prompt:          _buildPrompt(userText, mode, callerName),
        verboseLevel:    "off",
        timeoutMs,
        runId:           `${mode}:${Date.now()}`,
        lane:            mode,
      });
      return (result.payloads ?? [])
        .filter(p => p.text && !p.isError)
        .map(p => p.text?.trim())
        .filter(Boolean)
        .join(" ") || "";
    } finally {
      agentSem.release();
    }
  }

  // ── Standalone / PM2 path ─────────────────────────────────────────────
  const prompt = _buildPrompt(userText, mode, callerName);

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

    // Resilient to schema differences across openclaw versions.
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
