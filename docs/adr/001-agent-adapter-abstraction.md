# ADR 001: Agent Adapter Abstraction

**Status:** Accepted
**Date:** 2026-03-13

---

## Context

clawphone currently couples tightly to a single agent backend: [OpenClaw](https://github.com/openclaw/openclaw). All agent interaction logic lives in `lib/agent.mjs` and the function `openclawReply()` hard-codes two execution paths (plugin in-process and standalone CLI subprocess), both OpenClaw-specific.

As interest grows in connecting different LLM and agentic systems through a phone/SMS interface, the tight coupling becomes a constraint. Users may want to use direct LLM APIs (Anthropic, OpenAI, etc.), self-hosted models (Ollama, llama.cpp), or custom internal agents — without being locked into OpenClaw.

At the same time, supporting multiple telephony providers (Twilio alternatives) was considered and **explicitly deferred**. The wire protocols for call control (TwiML, NCCO, etc.) differ fundamentally enough that abstracting them would be a near-rewrite. Twilio remains the only supported phone provider. The adapter pattern applies to the agent side only.

---

## Decision

Introduce a formal `AgentAdapter` interface and refactor `lib/agent.mjs` into a factory/dispatcher. OpenClaw logic moves into `lib/agents/openclaw.mjs` as the first concrete adapter. A new `AGENT_PROVIDER` config field selects the active adapter at startup.

### Adapter interface

```js
/**
 * @typedef {{ role: 'user'|'assistant', content: string }} AgentMessage
 *
 * @typedef {object} AgentReplyOptions
 * @property {AgentMessage[]} messages   - Full conversation history; last entry is current turn
 * @property {'voice'|'sms'}  [mode]
 * @property {string}         [callerName]
 *
 * @typedef {object} AgentAdapter
 * @property {(opts: AgentReplyOptions) => Promise<string>} reply
 */
```

### Factory

```js
// lib/agent.mjs
export function createAgent({ api, config }) {
  const provider = config.AGENT_PROVIDER ?? "openclaw";
  if (provider === "openclaw") return createOpenClawAdapter({ api });
  throw new Error(`Unknown AGENT_PROVIDER: ${provider}`);
}
```

### Conversation history ownership

Adapters receive the full message history on each call (`AgentMessage[]`). Callers are responsible for maintaining the session store.

The OpenClaw adapter is an explicit exception: it ignores all messages except the last, because OpenClaw manages its own conversation history internally (session files on disk). Future adapters (direct LLM APIs) will consume the full history on each call, requiring clawphone to maintain a lightweight in-memory session store keyed by phone number or `CallSid`. That session store is **deferred** until the first non-OpenClaw adapter is introduced.

---

## Considered alternatives

### Keep everything in lib/agent.mjs, add a switch statement

Simple in the short term, but `agent.mjs` would grow a new branch per provider and become hard to read and test in isolation. Rejected in favour of the adapter pattern.

### Support multiple phone providers in the same pass

Considered briefly. Deferred because telephony call-control protocols (TwiML, NCCO, WebSocket-based, SIP) differ at a fundamental level — not just field names. Abstracting them would require rewriting the voice polling loop per-provider. Twilio is the dominant player and the effort/benefit ratio does not justify the scope expansion at this time.

### Use a class hierarchy for adapters

Unnecessary for an interface this small. A plain object returned from a factory function is sufficient and easier to test.

---

## Consequences

**Positive**
- Users can connect any LLM or agent system via a simple HTTP endpoint (`HttpAdapter`, planned) without clawphone needing a dedicated SDK per provider.
- The OpenClaw adapter becomes an isolated, independently testable unit.
- `lib/agent.mjs` shrinks to a thin dispatcher with no provider-specific logic.
- Adding a new adapter in the future requires only a new file and a new case in `createAgent()`.

**Negative / trade-offs**
- Dependency injection moves from per-call params (current) to adapter construction time, requiring minor test refactors.
- The OpenClaw adapter's session model (externally managed) diverges from the `messages[]` contract. This is a known, documented exception — not a bug.
- Conversation history management (for direct LLM adapters) adds new in-memory state to clawphone. Scope and key design for that store is deferred.

---

## Implementation

Tracked as GitHub issues #48–#53 on the Kanban milestone:

| Issue | Work | Order |
|---|---|---|
| [#48](https://github.com/ranacseruet/clawphone/issues/48) | Define `AgentAdapter` typedefs | 1 |
| [#49](https://github.com/ranacseruet/clawphone/issues/49) | Extract OpenClaw adapter to `lib/agents/openclaw.mjs` | 2 (parallel with #50) |
| [#50](https://github.com/ranacseruet/clawphone/issues/50) | Add `AGENT_PROVIDER` config field | 2 (parallel with #49) |
| [#51](https://github.com/ranacseruet/clawphone/issues/51) | Refactor `lib/agent.mjs` as factory/dispatcher | 3 |
| [#52](https://github.com/ranacseruet/clawphone/issues/52) | Update `lib/http-server.mjs` to use `createAgent()` | 4 (parallel with #53) |
| [#53](https://github.com/ranacseruet/clawphone/issues/53) | Update `test/agent.test.mjs` for adapter structure | 4 (parallel with #52) |
