// @ts-check
import crypto from "node:crypto";

/**
 * Session store entries can hold arbitrary plugin-written fields (overrides, thinking level, etc.)
 * in addition to the core identity fields, so the type is an open record with known required keys.
 *
 * @typedef {Record<string, unknown> & { sessionId: string, updatedAt: number }} SessionEntry
 */

/**
 * @typedef {{ [key: string]: SessionEntry }} SessionStore
 */

function normalizeAgentId(agentId) {
  return typeof agentId === "string" && agentId.trim()
    ? agentId.trim().toLowerCase()
    : "main";
}

function entryUpdatedAt(entry) {
  return typeof entry?.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;
}

function mergeSessionEntries(primary, secondary) {
  if (primary && secondary) {
    const merged = {
      ...secondary,
      ...primary,
      updatedAt: Math.max(entryUpdatedAt(primary), entryUpdatedAt(secondary)),
    };
    if (merged.systemPromptReport && typeof merged.systemPromptReport === "object") {
      // Detach from original store object before caller mutates sessionKey
      merged.systemPromptReport = { ...merged.systemPromptReport };
    }
    return merged;
  }
  return primary ?? secondary ?? null;
}

/**
 * Build the canonical session key OpenClaw uses in its gateway/TUI.
 * Bare keys like `voice:phone` are stored by OpenClaw as `agent:<id>:voice:phone`;
 * writing the canonical form directly keeps the store and the TUI in sync.
 *
 * @param {string | undefined} agentId
 * @param {string} sessionKey
 * @returns {string}
 */
export function canonicalPluginSessionKey(agentId, sessionKey) {
  return `agent:${normalizeAgentId(agentId)}:${sessionKey}`;
}

/**
 * Resolve (and migrate) the session store entry for a plugin-mode call.
 *
 * Older plugin builds wrote bare session keys (e.g. `voice:phone`). OpenClaw's
 * gateway canonicalizes those to `agent:<id>:voice:phone`, so once both forms
 * exist the TUI and the store disagree. This function folds any legacy bare
 * entry into the canonical key before the next turn runs.
 *
 * @param {{ store: SessionStore, agentId: string | undefined, sessionKey: string }} opts
 * @returns {{ key: string, entry: SessionEntry }}
 */
export function resolvePluginSessionEntry({ store, agentId, sessionKey }) {
  const canonicalKey = canonicalPluginSessionKey(agentId, sessionKey);
  const canonicalEntry = store[canonicalKey];
  const legacyEntry = store[sessionKey];
  const primary =
    entryUpdatedAt(canonicalEntry) >= entryUpdatedAt(legacyEntry) ? canonicalEntry : legacyEntry;
  const secondary = primary === canonicalEntry ? legacyEntry : canonicalEntry;
  const merged = mergeSessionEntries(primary, secondary) ?? {
    sessionId: crypto.randomUUID(),
    updatedAt: Date.now(),
  };
  if (merged.systemPromptReport && typeof merged.systemPromptReport === "object") {
    merged.systemPromptReport = {
      ...merged.systemPromptReport,
      sessionKey: canonicalKey,
    };
  }
  store[canonicalKey] = merged;
  if (sessionKey !== canonicalKey) {
    delete store[sessionKey];
  }
  return {
    key: canonicalKey,
    entry: merged,
  };
}
