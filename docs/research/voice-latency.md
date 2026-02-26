# Voice latency analysis

**Date:** 2026-02-24

A deep-dive into every layer of clawphone's end-to-end voice call latency, with concrete improvement opportunities and tracking issues for each.

---

## Latency budget per turn

From when the user **stops speaking** to when they **hear the first word of the reply**:

```
[User stops speaking]
  +0 ms     — Twilio silence detection ("auto" endpointing, typically ~500 ms after last word)
  +500 ms   — STT processing (Twilio internal; ~350 ms median per Twilio's own benchmarks)
  +200 ms   — /speech webhook round-trip (cloudflared adds 50-200 ms on top of base network)
  +100 ms   — /speech handler: createPendingTurn() + openclawReply() fired async ← AGENT STARTS HERE
  ─────────
  ~800 ms   — TwiML returned to Twilio; thinking phrase begins playing
              (agent is already running concurrently from this point)

  +1500 ms  — TTS plays the thinking phrase ("Got it. One moment while I think.")
              ↑ this is free time — agent has been running for the full phrase duration
  ─────────
  ~2300 ms  — <Redirect /speech-wait> fires

  +200 ms   — /speech-wait round-trip #1
              ├─ agent done  → reply delivered immediately (no silence at all)
              └─ not done    → return <Pause length="2"/> + redirect

  +2000 ms  — 2 s silent pause
  +200 ms   — /speech-wait round-trip #2
              [agent still running → return <Pause length="2"/>]

  +2000 ms  — 2 s silent pause
  ... poll repeats until agent finishes ...
```

**Real-world totals:**

| Agent response time | Caller wait (best case) | Caller wait (worst case) |
|---|---|---|
| 4 s | ~6 s | ~8 s |
| 6 s | ~8 s | ~10 s |
| 10 s | ~12 s | ~14 s |

Twilio's own latency benchmarks target a 1,115 ms mouth-to-ear turn gap for streaming Media Streams pipelines. The TwiML polling architecture is inherently 5-10× slower — an accepted trade-off for no external STT/TTS accounts and simpler infrastructure.

---

## Twilio parameters: what exists, what doesn't

A key goal of this research was to identify Twilio features that could reduce latency without a full Media Streams rewrite.

| Parameter | Available? | Notes |
|---|---|---|
| `speechTimeout: "auto"` | ✓ (in use) | Smart endpointing — correct default |
| `speechModel` | ✓ (**not in use**) | Selects STT provider/model; `"phone_call"` is Twilio's recommendation for voice agents |
| `partialResultCallback` | ✓ (**not in use**) | Fires webhooks with `UnstableSpeechResult` during recognition — enables early agent start |
| `actionOnEmptyResult` | ✓ | Fires `action` even on empty input; not useful here (current fallback is better UX) |
| `<Pause>` minimum | 1 s | Integer seconds only; no sub-second precision |
| `enhanced` recognition | Deprecated | Was limited to `phone_call` model in Google STT V1 |
| Edge routing / POP selection | ✗ | Not configurable at the TwiML level |
| HTTP/2 or WebSocket upgrade | ✗ | TwiML is HTTP 1.1 only; Media Streams is the WebSocket path |
| Partial / streaming TTS | ✗ | `<Say>` delivers audio atomically; no streaming delivery |

**Key sources:**
- [Twilio Gather TwiML reference](https://www.twilio.com/docs/voice/twiml/gather)
- [Core Latency in AI Voice Agents (Twilio blog)](https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents)
- [11 tips for speech recognition in virtual agent bots (Twilio blog)](https://www.twilio.com/en-us/blog/tips-speech-recognition-virtual-agent-voice-calling)

---

## Gaps and improvement opportunities

### Gap 1 — Poll interval hardcoded at 2 s (▶ [#22](https://github.com/ranacseruet/clawphone/issues/22))

**Code:** `lib/config.mjs:64` — `SPEECH_WAIT_PAUSE_SECONDS = 2`

The `/speech-wait` loop pauses for 2 s between polls. If the agent finishes 1 ms after a poll fires, the caller waits up to 2 s before the reply is delivered. On average this alignment gap costs ~1 s per turn. The value is hardcoded and not exposed as an env var or plugin config field.

Twilio's `<Pause>` minimum is 1 s. Reducing from 2 → 1 saves 0-2 s per turn (avg ~1 s) at no cost.

**Tracking:** [#22 — perf: reduce SPEECH_WAIT_PAUSE_SECONDS from 2 to 1 and expose as env var](https://github.com/ranacseruet/clawphone/issues/22)

---

### Gap 2 — `speechModel` not set on any `<Gather>` (▶ [#23](https://github.com/ranacseruet/clawphone/issues/23))

**Code:** `lib/twiml.mjs:52`, `lib/twiml.mjs:65`

Both `greetingWithGather()` and `replyWithGather()` omit `speechModel`, so Twilio defaults to its generic STT model. Twilio's documentation explicitly recommends `"phone_call"` for conversational AI / voice command use cases:

> "phone_call is the speech model best suited for use cases where you'd expect to receive queries such as voice commands or voice search."

Better STT accuracy reduces wasted turns from misrecognitions. The model is also expected to process phone-quality audio faster than the generic default. A further option is `"googlev2_telephony"` (Google STT V2, phone-optimised), worth testing.

**Tracking:** [#23 — perf: add speechModel="phone_call" to all Gather TwiML calls](https://github.com/ranacseruet/clawphone/issues/23)

---

### Gap 3 — Silent polling loop gives no feedback during slow agent turns (▶ [#24](https://github.com/ranacseruet/clawphone/issues/24))

**Code:** `lib/config.mjs:82-89`, `lib/twiml.mjs:85-90`, `lib/http-server.mjs:251-255`

**Correction from original analysis:** The original framing stated that long thinking phrases add latency. This was wrong. The agent call fires asynchronously at the top of the `/speech` handler, *before* the TwiML response is returned. The thinking phrase plays while the agent is already running — phrase duration is free overlap time, not dead air. For fast agents that complete during the phrase, the reply is delivered on the very first poll with zero additional silence.

**The actual gap** is in the polling loop. Once the phrase ends and the agent hasn't finished, `pauseAndRedirect()` returns `<Pause 2s><Redirect>` — silent. For a slow agent taking 6-8s, the caller hears: phrase (~2s) then 4-6s of complete silence. No audio feedback at all.

**There is no reliable way to predict agent response time upfront** (it depends on model speed, tool calls, and answer complexity — not on question length or content). So the solution cannot be "choose long vs. short phrase based on expected duration."

**Proposed design — two-stage audio feedback:**

1. **Short initial phrase** (on `/speech`): 2-3 words — "One moment.", "Let me check." — played while agent starts. Short enough not to overrun a fast reply.
2. **Poll-cycle filler phrases** (in `/speech-wait` when agent not done): replace the silent `<Pause>` with a `<Say>filler</Say>` for the first 1-2 poll cycles, then fall back to silent pauses.

```
Fast agent (finishes during phrase, ~1-2s):
  "One moment."  →  [poll 1: reply ready]  →  reply delivered. No silence.

Slow agent (6-8s):
  "One moment."  →  [poll 1: "Still working on it."]
                 →  [poll 2: "Almost there."]
                 →  [poll 3+: silent <Pause>]
                 →  [poll N: reply ready]  →  reply delivered
```

**Implementation note:** `/speech-wait` currently has no concept of poll count for a given turn. Simplest approach: pass `&poll=N` in the redirect URL (stateless, no change to `voice-state.mjs`). The handler reads it, decides filler vs. silent pause, and increments N in the next redirect.

Cap fillers at **2** before falling back to silent pauses — covers ~5s of agent time without becoming repetitive.

**Tracking:** [#24 — perf: redesign thinking phrases — short initial phrase + poll-cycle fillers for slow agents](https://github.com/ranacseruet/clawphone/issues/24)

---

### Gap 4 — STT model not user-configurable (▶ [#25](https://github.com/ranacseruet/clawphone/issues/25))

Related to Gap 2 but distinct: even after `"phone_call"` is set as the default, users should be able to swap the model without a code change. Twilio's model landscape is evolving (Google STT V2 models, Deepgram options) and the best choice may shift over time.

A `TWILIO_SPEECH_MODEL` env var (and corresponding plugin config field) lets users A/B test different models against their own call patterns.

**Tracking:** [#25 — perf: expose TWILIO_SPEECH_MODEL as configurable env var / plugin config field](https://github.com/ranacseruet/clawphone/issues/25)

---

### Gap 5 — `partialResultCallback` not implemented (▶ [#26](https://github.com/ranacseruet/clawphone/issues/26))

Twilio's `partialResultCallback` delivers `UnstableSpeechResult` webhooks in real-time while the user is still speaking. This enables starting the agent call before end-of-speech detection fires:

**Current STT phase:** user stops → 500 ms silence lag → 350 ms STT → webhook → agent starts

**With partialResultCallback:** receive intermediate transcripts during speech → start agent when partial looks complete → agent is 1-2 s into processing by the time final `/speech` fires

**Why this is currently blocked:**

1. **No cancellation path.** If the partial transcript differs from the final, the pre-started agent call runs to completion, burns tokens, and writes a phantom Q&A turn to session history. The same root cause is documented in `docs/architecture.md` under *Barge-in behaviour*.

2. **Session corruption risk.** Phantom turns from wrong partials degrade subsequent conversation quality.

This is the highest-potential improvement (1-2 s/turn) but requires solving cancellable agent calls first.

**Tracking:** [#26 — feat: implement partialResultCallback to start agent call during STT](https://github.com/ranacseruet/clawphone/issues/26)

---

### Gap 6 — Plugin mode latency advantage not documented (▶ [#27](https://github.com/ranacseruet/clawphone/issues/27))

In standalone mode, `openclawReply()` spawns `openclaw agent` as a child process for every turn (`lib/utils.mjs:run()`). Node.js process startup + CLI module loading adds ~200-400 ms per turn. In plugin mode, `runEmbeddedPiAgent` is called in-process — zero startup overhead.

This ~300 ms saving is available to any user who switches from standalone to plugin mode, with no code changes required. It is not mentioned in `docs/best-practices.md`.

**Tracking:** [#27 — docs: add plugin-mode latency advantage to best-practices guide](https://github.com/ranacseruet/clawphone/issues/27)

---

## What is already good

These are not gaps — existing choices are correct:

- **`speechTimeout: "auto"`** — Twilio's smart endpointing; correct default for conversational AI.
- **`Google.en-US-Chirp3-HD-Charon`** — Google's latest neural TTS voice; good time-to-first-audio.
- **`--thinking off` passed to standalone openclaw** — Extended thinking adds 10-30 s; disabled correctly.
- **Async agent dispatch in `/speech`** — Agent call fires before the TwiML response is sent; the thinking phrase plays concurrently while the agent runs. For fast agents this means zero polling silence — the reply is ready on the first `/speech-wait` poll.
- **`MAX_SAYABLE_LENGTH = 600`** — Short replies play faster; limit is appropriate.
- **Semaphore for concurrent agent calls** — Prevents runaway resource usage.
- **Stale turn handling** — Correct supersession logic prevents delivering wrong replies.

---

## Summary table

| # | Gap | Effort | Avg latency saved | Priority | Issue |
|---|---|---|---|---|---|
| 1 | Poll interval 2 s → 1 s + env var | Trivial | ~1 s/turn | P2 | [#22](https://github.com/ranacseruet/clawphone/issues/22) |
| 2 | Add `speechModel="phone_call"` | Minor | ~200 ms/turn | P2 | [#23](https://github.com/ranacseruet/clawphone/issues/23) |
| 3 | Short initial phrase + poll-cycle fillers for slow agents | Minor | Eliminates silence for fast agents; masks ~4s for slow agents | P2 ✓ | [#24](https://github.com/ranacseruet/clawphone/issues/24) |
| 4 | Expose `TWILIO_SPEECH_MODEL` as config | Minor | User-tuneable | P2 | [#25](https://github.com/ranacseruet/clawphone/issues/25) |
| 5 | `partialResultCallback` early agent start | Hard (blocked) | 1-2 s/turn | P3 | [#26](https://github.com/ranacseruet/clawphone/issues/26) |
| 6 | Document plugin-mode latency advantage | Trivial (docs) | ~300 ms/turn | P3 | [#27](https://github.com/ranacseruet/clawphone/issues/27) |

Implementing gaps 1-4 together is expected to reduce perceived caller wait by **~2-3 s per turn** in the median case, with no architectural changes and minimal risk.
