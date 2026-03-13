# ADR 001: Agent Adapter Abstraction

**Status:** Accepted
**Date:** 2026-03-13

---

## Context

clawphone currently couples tightly to a single agent backend: [OpenClaw](https://github.com/openclaw/openclaw). All agent interaction logic lives in `lib/agent.mjs` and the function `openclawReply()` hard-codes two execution paths (plugin in-process and standalone CLI subprocess), both OpenClaw-specific.

As interest grows in connecting different LLM and agentic systems through a phone/SMS interface, the tight coupling becomes a constraint. Users may want to use direct LLM APIs (Anthropic, OpenAI, etc.), self-hosted models (Ollama, llama.cpp), or custom internal agents — without being locked into OpenClaw.

Supporting multiple telephony providers (Twilio alternatives) was considered and explicitly deferred. The wire protocols for call control (TwiML, NCCO, WebSocket-based, SIP) differ at a fundamental level — not just field names. Abstracting them would require rewriting the voice polling loop per-provider. The adapter pattern applies to the agent side only.

---

## Decision

Introduce a formal `AgentAdapter` interface. `lib/agent.mjs` becomes a factory/dispatcher; OpenClaw logic moves into `lib/agents/openclaw.mjs` as the first concrete adapter. A new `AGENT_PROVIDER` config field selects the active adapter at startup.

The adapter contract is a single `reply` method that takes a full conversation history and returns a reply string:

```js
/**
 * @typedef {{ role: 'user'|'assistant', content: string }} AgentMessage
 *
 * @typedef {object} AgentReplyOptions
 * @property {AgentMessage[]} messages   - Full history; last entry is the current turn
 * @property {'voice'|'sms'}  [mode]
 * @property {string}         [callerName]
 *
 * @typedef {object} AgentAdapter
 * @property {(opts: AgentReplyOptions) => Promise<string>} reply
 */
```

**Conversation history ownership:** callers own the session store and pass the full message history on each call. The OpenClaw adapter is a documented exception — it ignores all but the last message because OpenClaw manages its own history internally. A lightweight in-memory session store for direct LLM adapters is deferred until the first non-OpenClaw adapter is introduced.

---

## Considered alternatives

**Keep everything in `lib/agent.mjs`, add a switch statement.** Simple in the short term, but `agent.mjs` would grow a new branch per provider and become hard to read and test in isolation. Rejected.

**Support multiple telephony providers in the same pass.** Deferred — the call-control models differ fundamentally enough that a single abstraction would be a near-rewrite. Twilio stays as the only phone provider for now.

**Use a class hierarchy for adapters.** Unnecessary for an interface this small. A plain object returned from a factory function is sufficient and easier to test.

---

## Consequences

- `lib/agent.mjs` contains no provider-specific logic. Adding a new adapter requires only a new file and a new case in `createAgent()`.
- The OpenClaw adapter is an isolated, independently testable unit.
- Users can reach any LLM or agent via a generic HTTP adapter without clawphone needing a dedicated SDK per provider.
- Dependency injection moves from per-call params to adapter construction time, requiring minor test refactors.
- The OpenClaw adapter's externally-managed session model is a known divergence from the `messages[]` contract, not a bug.
- Conversation history management for direct LLM adapters will introduce new in-memory state; scope and key design are deferred.
