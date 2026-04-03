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
  const createReplyDispatcherWithTyping = channelRuntime?.reply?.createReplyDispatcherWithTyping;
  const withReplyDispatcher = channelRuntime?.reply?.withReplyDispatcher;
  const dispatchReplyFromConfig = channelRuntime?.reply?.dispatchReplyFromConfig;

  if (typeof isExactCommand !== "function" || typeof shouldHandleTextCommands !== "function") {
    throw new Error("OpenClaw runtime missing command detection helpers");
  }
  if (
    typeof finalizeInboundContext !== "function" ||
    typeof createReplyDispatcherWithTyping !== "function" ||
    typeof withReplyDispatcher !== "function" ||
    typeof dispatchReplyFromConfig !== "function"
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

  // Build a config override that grants command authorization to the SMS
  // sender.  clawphone has already validated the sender via its own allowFrom
  // check; here we tell OpenClaw's internal command-auth system to treat any
  // sender as an owner.  Without this, configs with ownerAllowFrom set to
  // specific Discord/other user IDs cause isAuthorizedSender=false for every
  // SMS sender because the phone number is not in the owner list.
  //
  // Note: this override is only used within dispatchReplyFromConfig (via its
  // configOverride parameter, which flows through to getReplyFromConfig).  The
  // outer cfg reference is intentionally left unmodified.
  const cmdCfg = /** @type {object} */ ({
    ...cfg,
    commands: {
      ...(/** @type {Record<string,unknown>} */ (cfg.commands ?? {})),
      ownerAllowFrom: ["*"],
      // null removes this key via applyMergePatch (JSON Merge Patch semantics).
      // When commands.allowFrom is set in the disk config, resolveCommandAuthorization
      // uses a separate path (commandsAllowFromList) that ignores ownerAllowFrom and
      // would reject the SMS sender.  Removing it forces the ownerAllowFrom path,
      // where ownerAllowFrom:["*"] grants command authority.
      allowFrom: null,
    },
  });

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

  const { dispatcher, replyOptions: typingReplyOptions, markDispatchIdle, markRunComplete } =
    createReplyDispatcherWithTyping({
      deliver: async (payload) => {
        if (payload && typeof payload === "object") {
          delivered.push(payload);
        }
      },
      onError: (/** @type {unknown} */ error) => {
        dispatchError = error;
      },
    });

  try {
    await withReplyDispatcher({
      dispatcher,
      run: () =>
        dispatchReplyFromConfig({
          ctx: finalized,
          cfg: cmdCfg,
          dispatcher,
          replyOptions: typingReplyOptions,
          configOverride: cmdCfg,
        }),
    });
  } finally {
    markRunComplete();
    markDispatchIdle();
  }

  if (dispatchError) {
    throw dispatchError;
  }

  return {
    handled: true,
    text: collectReplyText(delivered),
  };
}
