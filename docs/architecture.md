# Architecture

## Overview

clawphone is a Node.js HTTP server (ES Modules, no framework) that receives Twilio voice and SMS webhooks, forwards them to the [OpenClaw](https://github.com/openclaw/openclaw) agent, and returns TwiML responses.

It has two deployment modes that share the same HTTP server factory (`lib/http-server.mjs`):

| Mode | Entry point | Agent calls |
|---|---|---|
| **Standalone / PM2** | `server.mjs` | Spawns `openclaw agent` as a child process |
| **OpenClaw plugin** | `index.mjs` | Calls `runEmbeddedPiAgent` in-process via `extensionAPI.js` |

---

## Voice call flow

Twilio's webhook timeout (~15 s) makes synchronous agent calls impossible. The gateway uses a **polling loop**:

```
Caller dials in
  └─▶ POST /voice
        Returns: TwiML <Gather input="speech">

Caller speaks
  └─▶ POST /speech
        1. Creates pending turn (UUID key) in voice-state.mjs
        2. Fires openclawReply() asynchronously
        3. Returns: thinking phrase + <Redirect /speech-wait?key=…>

Twilio polls (every ~2 s)
  └─▶ POST /speech-wait
        ├─ Reply not ready → <Pause 2s> + <Redirect /speech-wait?key=…>
        └─ Reply ready     → speak reply + new <Gather> (next turn)
```

**Stale turn handling:** `lib/voice-state.mjs` tracks pending turns in two Maps — `pending` (keyed by `callSid:uuid`) and `latestByCall` (keyed by `CallSid`). If the caller speaks again before the previous reply is ready, the old turn is superseded: `/speech-wait` detects it is no longer the latest turn and discards the stale reply, redirecting to `/speech` to pick up the new one.

### Barge-in behaviour

| Phase | Barge-in supported? |
|---|---|
| Greeting (before/during beep) | Yes — speech is inside a `<Gather>`; Twilio stops TTS and captures it natively |
| Agent reply | Yes — reply is also inside a `<Gather>`; speaking mid-reply fires `/speech` immediately |
| Thinking / polling phase | **No** — the loop is `<Say phrase>` + `<Pause>` + `<Redirect>`; there is no `<Gather>`, so the caller cannot interrupt |

During the thinking phase the caller must wait until the agent reply is ready before they can speak again.

**Why adding `<Gather>` to the polling loop is non-trivial:**

Two structural limitations make a naive implementation counter-productive:

1. **Semaphore serialization.** `lib/agent.mjs` gates all agent calls behind a shared semaphore (`OPENCLAW_MAX_CONCURRENT`). A barge-in turn queues behind the still-running old call. Total wait = old call + new call — worse than no barge-in.

2. **No cancellation path.** The in-flight agent call has no `AbortSignal` (plugin path) and no subprocess reference to kill (standalone path). It runs to completion regardless, and its result is written to the shared conversation session. This leaves a phantom Q&A turn in the agent's history that the caller never heard, which can degrade subsequent responses.

Until both issues are addressed (cancellable agent calls + session rollback on abort), barge-in during the thinking phase is intentionally left unsupported.

---

## SMS flow

`lib/sms.mjs` attempts a **fast path** first:

```
Inbound SMS
  └─▶ POST /sms
        ├─ Agent replies within SMS_FAST_TIMEOUT_MS (default 15 s)
        │    └─ Return reply inline as TwiML MessagingResponse
        └─ Agent takes longer
             1. Return empty TwiML (ack immediately, no visible reply yet)
             2. When agent finishes → send follow-up SMS via Twilio REST API
```

The fast path avoids an extra round-trip message for fast replies. The slow path prevents Twilio from timing out the webhook while the agent thinks.

**SMS text sanitization:** Before any SMS reply is sent, `lib/sms.mjs` normalises Unicode punctuation (curly quotes → straight, em-dash → hyphen, ellipsis → `...`, etc.) and truncates at `SMS_MAX_CHARS`. This prevents UCS-2 encoding overhead on Twilio, which would halve the per-segment character limit.

---

## Agent integration

`lib/agent.mjs` exports two functions used by both the voice and SMS handlers:

### `openclawReply({ userText, mode, callerName })`

Sends `userText` to the OpenClaw agent and returns the reply string.

- `mode: "voice"` — minimal prompt framing; reply is spoken aloud via TTS
- `mode: "sms"` — adds SMS constraints: ASCII-only, ≤ `SMS_MAX_CHARS` chars, no markdown
- `callerName` — optional; included in the prompt prefix when set (e.g. `Phone call (Alice): …`)

**Plugin path** (`_api` injected): calls `runEmbeddedPiAgent` from `openclaw/dist/extensionAPI.js` in-process. The dist path is resolved relative to `process.argv[1]` (the openclaw host entry point) because the plugin's own `node_modules` does not contain `openclaw`.

**Standalone path** (`_api` is null): spawns `openclaw agent --json …` as a child process and parses stdout. Resilient to openclaw version differences via multi-field JSON fallback.

Both paths use a shared semaphore (`OPENCLAW_MAX_CONCURRENT`) to cap concurrent agent invocations.

### `discordLog({ text })`

Logs a message to a Discord channel (fire-and-forget). No-op when `DISCORD_LOG_CHANNEL_ID` is unset.

- **Plugin path**: calls `api.runtime.channel.discord.sendMessageDiscord()`
- **Standalone path**: spawns `openclaw message send --channel discord …`

---

## Phone number allowlist

Inbound `From` numbers are normalised (leading `+` added if missing, whitespace trimmed) before checking against `ALLOW_FROM`. Unauthorised callers/senders receive a hangup or "Unauthorized" TwiML response. Leave `ALLOW_FROM` blank to allow all numbers (not recommended in production).

Inbound `/voice` and `/sms` requests are also subject to a per-number sliding-window rate limit (`RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS` ms). Rate-limited requests receive a rejection TwiML response (HTTP 200). Set `RATE_LIMIT_MAX=0` to disable.

---

## Webhook signature validation

When both `PUBLIC_BASE_URL` and `TWILIO_AUTH_TOKEN` are set, every inbound POST is validated via Twilio's HMAC-SHA1 signature scheme (`lib/twilio.mjs:validateWebhookSignature`). Requests with a missing or invalid `X-Twilio-Signature` header are rejected with HTTP 403. Validation is skipped when either value is unset (intended for local development and tests).

---

## Module layout

```
server.mjs              Standalone entry point
index.mjs               OpenClaw plugin entry point
lib/
  config.mjs            All env vars, constants, fromPluginConfig()
  http-server.mjs       HTTP server factory (shared by both entry points)
  agent.mjs             Agent integration (openclawReply, discordLog)
  sms.mjs               SMS handler (fast/slow path, text normalisation)
  twiml.mjs             TwiML XML builders (voice responses)
  twilio.mjs            Twilio SDK wrapper (sendSms, validateWebhookSignature)
  utils.mjs             parseForm, toSayableText, readBody, semaphore, run
  voice-state.mjs       In-memory pending-turn state for voice polling loop
ecosystem.config.cjs    PM2 process config (secrets loaded from .env)
openclaw.plugin.json    OpenClaw plugin manifest and config schema
skills/phone/SKILL.md   Agent skill definition (prompt framing docs)
```

---

## Key design constraints

- **State is in-memory**: voice call state resets on server restart; there is no database.
- **No framework**: raw `http.createServer` with manual routing; all request bodies are URL-encoded forms parsed by `lib/utils.mjs:parseForm()`.
- **No TypeScript**: plain ES Modules (`.mjs`).
- **TwiML built with SDK**: `lib/twiml.mjs` uses `twilio.twiml.VoiceResponse`; `lib/sms.mjs` uses `twilio.twiml.MessagingResponse`. The SDK handles XML escaping internally.

---

## Testing

Tests use Node's built-in `node:test` runner (~150 tests across 10 files). No external test framework.

The integration test suite (`test/server.test.mjs`) isolates against all external services:

| Isolation technique | Effect |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` set to `""` | `twilioClient` stays `null` — no real SMS sent; also disables webhook signature validation |
| `DISCORD_LOG_CHANNEL_ID` set to `""` | `discordLog()` returns early — no Discord messages |
| Fake `openclaw` stub injected onto `PATH` | `openclawReply()` never reaches the real binary or agent |

The stub is a minimal shell script written to a temp directory and prepended to `PATH` before the test server starts, then cleaned up after.
