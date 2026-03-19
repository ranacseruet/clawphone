// @ts-check
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

let _commandDeps = null;

function resolveOpenClawDistRoot() {
  const explicit = process.env.CLAWPHONE_OPENCLAW_DIST_ROOT?.trim();
  if (explicit) {
    return explicit;
  }
  if (process.argv[1]) {
    return dirname(process.argv[1]);
  }
  return join(process.cwd(), "dist");
}

function resolveHashedModule(dir, prefix) {
  const file = readdirSync(dir).find((entry) => entry.startsWith(prefix) && entry.endsWith(".js"));
  if (!file) {
    throw new Error(`Unable to locate ${prefix}*.js in ${dir}`);
  }
  return join(dir, file);
}

function collectReplyText(payload) {
  if (!payload) {
    return "";
  }
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => collectReplyText(entry))
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof payload === "object" && typeof payload.text === "string") {
    return payload.text.trim();
  }
  return "";
}

async function loadCommandDeps() {
  if (_commandDeps) {
    return _commandDeps;
  }

  const distRoot = resolveOpenClawDistRoot();
  const pluginSdkDir = join(distRoot, "plugin-sdk");
  if (!existsSync(pluginSdkDir)) {
    throw new Error(`OpenClaw dist plugin-sdk directory not found: ${pluginSdkDir}`);
  }

  const replyPath = resolveHashedModule(pluginSdkDir, "reply-");
  const commandsPath = resolveHashedModule(pluginSdkDir, "commands-registry-");
  const replyModule = await import(pathToFileURL(replyPath).href);
  const commandsModule = await import(pathToFileURL(commandsPath).href);
  const getReplyFromConfig = replyModule?.t;
  const maybeResolveTextAlias = commandsModule?.c;
  if (typeof getReplyFromConfig !== "function") {
    throw new Error(`OpenClaw reply module missing getReplyFromConfig export: ${replyPath}`);
  }
  if (typeof maybeResolveTextAlias !== "function") {
    throw new Error(`OpenClaw commands module missing maybeResolveTextAlias export: ${commandsPath}`);
  }

  _commandDeps = { getReplyFromConfig, maybeResolveTextAlias };
  return _commandDeps;
}

/**
 * Run an exact OpenClaw slash command against the explicit SMS session key.
 * Returns handled=false when the SMS body is not an exact text command.
 *
 * @param {object} options
 * @param {string} options.text
 * @param {string} options.sessionKey
 * @param {string} [options.from]
 * @param {string} [options.to]
 * @returns {Promise<{ handled: boolean, text?: string }>}
 */
export async function runSmsSlashCommand({
  text,
  sessionKey,
  from = "",
  to = "",
}) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  const { getReplyFromConfig, maybeResolveTextAlias } = await loadCommandDeps();
  if (!maybeResolveTextAlias(trimmed)) {
    return { handled: false };
  }

  const reply = await getReplyFromConfig(
    {
      Body: trimmed,
      RawBody: trimmed,
      CommandBody: trimmed,
      BodyForCommands: trimmed,
      From: from || undefined,
      To: to || undefined,
      SessionKey: sessionKey || undefined,
      Provider: "sms",
      Surface: "sms",
      ChatType: "direct",
      CommandSource: "text",
      CommandAuthorized: true,
    },
    {},
  );

  return {
    handled: true,
    text: collectReplyText(reply),
  };
}
