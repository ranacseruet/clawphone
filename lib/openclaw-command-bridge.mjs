// @ts-check

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

/**
 * Run an exact OpenClaw slash command against the explicit SMS session key.
 * Returns handled=false when the SMS body is not an exact text command.
 *
 * @param {object} options
 * @param {string} options.text
 * @param {string} options.sessionKey
 * @param {string} [options.from]
 * @param {string} [options.to]
 * @param {object} options._api
 * @returns {Promise<{ handled: boolean, text?: string }>}
 */
export async function runSmsSlashCommand({
  text,
  sessionKey,
  from = "",
  to = "",
  _api,
}) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  const cfg = _api?.config ?? {};
  const channelRuntime = _api?.runtime?.channel;
  const isExactCommand = channelRuntime?.commands?.isControlCommandMessage;
  const shouldHandleTextCommands = channelRuntime?.commands?.shouldHandleTextCommands;
  const finalizeInboundContext = channelRuntime?.reply?.finalizeInboundContext;
  const dispatchReplyWithBufferedBlockDispatcher =
    channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (typeof isExactCommand !== "function" || typeof shouldHandleTextCommands !== "function") {
    throw new Error("OpenClaw runtime missing command detection helpers");
  }
  if (
    typeof finalizeInboundContext !== "function" ||
    typeof dispatchReplyWithBufferedBlockDispatcher !== "function"
  ) {
    throw new Error("OpenClaw runtime missing reply dispatch helpers");
  }

  const canUseTextCommands = shouldHandleTextCommands({
    cfg,
    surface: "sms",
    commandSource: "text",
  });
  if (!canUseTextCommands || !isExactCommand(trimmed, cfg)) {
    return { handled: false };
  }

  /** @type {Array<{ text?: string }>} */
  const delivered = [];
  /** @type {unknown | undefined} */
  let dispatchError;

  const finalized = finalizeInboundContext({
    Body: trimmed,
    RawBody: trimmed,
    CommandBody: trimmed,
    BodyForCommands: trimmed,
    BodyForAgent: trimmed,
    From: from || undefined,
    To: to || undefined,
    SessionKey: sessionKey || undefined,
    Provider: "sms",
    Surface: "sms",
    ChatType: "direct",
    CommandSource: "text",
    CommandAuthorized: true,
  });

  await dispatchReplyWithBufferedBlockDispatcher({
    ctx: finalized,
    cfg,
    dispatcherOptions: {
      deliver: async (payload) => {
        if (payload && typeof payload === "object") {
          delivered.push(payload);
        }
      },
      onError: (error) => {
        dispatchError = error;
      },
    },
  });

  if (dispatchError) {
    throw dispatchError;
  }

  return {
    handled: true,
    text: collectReplyText(delivered),
  };
}
