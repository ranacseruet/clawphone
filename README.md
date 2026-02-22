# twilio-phone-gateway

A Node.js HTTP gateway that bridges Twilio voice calls and SMS to the **OpenClaw** agent CLI. No framework — raw `node:http`, ES Modules only.

## Prerequisites

| Dependency | Purpose |
|---|---|
| `openclaw` CLI | Agent backend; must be on `$PATH` |
| `cloudflared` | Exposes the local server to Twilio via a public HTTPS tunnel |
| Node.js ≥ 22 | Built-in test runner (`node --test`) |

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your real credentials
```

See `.env.example` for all available variables and their defaults.

### 3. Start the gateway

```bash
node server.mjs
```

### 4. Expose via Cloudflare tunnel (separate terminal)

```bash
cloudflared tunnel --url http://localhost:8787
```

Cloudflared prints a public URL like `https://xxxx.trycloudflare.com`.

### 5. Wire up Twilio webhooks

In the [Twilio Console](https://console.twilio.com), on your phone number:

| Event | Method | URL |
|---|---|---|
| A call comes in | POST | `https://xxxx.trycloudflare.com/voice` |
| A message comes in | POST | `https://xxxx.trycloudflare.com/sms` |

## Production (PM2)

```bash
pm2 start ecosystem.config.cjs
pm2 logs twilio-phone-gateway
pm2 restart twilio-phone-gateway
```

## Configuration

All configuration is via environment variables (loaded from `.env` by dotenv). Variables already in the environment take precedence over `.env`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8787` | HTTP listen port |
| `ALLOW_FROM` | *(none)* | Comma-separated E.164 allowlist; blank = allow all |
| `TWILIO_ACCOUNT_SID` | — | Twilio account SID (required for async SMS) |
| `TWILIO_AUTH_TOKEN` | — | Twilio auth token (required for async SMS) |
| `TWILIO_SMS_FROM` | *(inbound `To`)* | Override sender number for outbound async SMS |
| `OPENCLAW_PHONE_SESSION_ID` | `phone-rana` | OpenClaw session ID for voice/SMS calls |
| `OPENCLAW_AGENT_ID` | `phone` | OpenClaw agent ID |
| `OPENCLAW_MAX_CONCURRENT` | `10` | Max simultaneous agent invocations |
| `DISCORD_LOG_CHANNEL_ID` | *(disabled)* | Discord channel for call/SMS logging; unset to disable |
| `SMS_MAX_CHARS` | `280` | Max characters in an SMS reply |
| `SMS_FAST_TIMEOUT_MS` | `15000` | Fast-path timeout (ms) before falling back to async SMS |

## Architecture

### Voice call flow

Twilio's webhook timeout (~15 s) makes synchronous agent calls impossible. The gateway uses a **polling loop**:

```
Twilio → POST /voice        → TwiML <Gather input="speech">
Twilio → POST /speech       → creates pending turn (UUID key)
                              fires openclawReply() async
                              returns thinking phrase + redirect to /speech-wait?key=…
Twilio → POST /speech-wait  → if reply ready: deliver + new <Gather>
                              if still waiting: <Pause 2s> + redirect back to itself
```

`lib/voice-state.mjs` tracks pending turns in two in-memory Maps (`pending` keyed by UUID, `latestByCall` keyed by CallSid). When the caller speaks again mid-thought, the previous turn is discarded and the stale reply is dropped.

### SMS flow

`lib/sms.mjs` tries a **fast path** first (≤ `SMS_FAST_TIMEOUT_MS`). If the agent replies in time, TwiML returns the text immediately. If not, the gateway acks the SMS instantly with a "thinking" message, then sends the agent's reply as a follow-up SMS via the Twilio SDK once it's ready.

### Agent integration

`lib/agent.mjs` spawns the `openclaw` CLI as a child process:

- **`openclawReply({ userText, mode })`** — `mode` is `"sms"` or `"voice"`. SMS mode enforces ASCII-only, ≤ `SMS_MAX_CHARS` chars, no markdown in the system prompt.
- **`discordLog({ text })`** — fire-and-forget; only active when `DISCORD_LOG_CHANNEL_ID` is set.
- Agent timeout: 120 s; max concurrency controlled by a semaphore (`OPENCLAW_MAX_CONCURRENT`).

### SMS text sanitization

Before any SMS reply is sent, `lib/sms.mjs` normalises Unicode punctuation (curly quotes → straight, em-dash → hyphen, ellipsis → `...`, etc.) and truncates at `SMS_MAX_CHARS`. This avoids Twilio encoding warnings on trial accounts.

### Phone number allowlist

Inbound `From` numbers are normalised (leading `+` added if missing, whitespace trimmed) before checking against `ALLOW_FROM`. Unauthorised callers receive a hangup TwiML; unauthorised SMS senders receive an "Unauthorized" TwiML reply.

## Module layout

```
server.mjs              Entry point; HTTP routing
lib/
  config.mjs            All env vars and constants
  agent.mjs             openclaw CLI integration (openclawReply, discordLog)
  sms.mjs               SMS handler (fast/slow path, text normalisation)
  twiml.mjs             TwiML XML builders (no SDK TwiML builder)
  twilio.mjs            Twilio SDK wrapper (sendSms)
  utils.mjs             parseForm, toSayableText, readBody, semaphore, run
  voice-state.mjs       In-memory pending-turn state for voice polling loop
ecosystem.config.cjs    PM2 process config
```

## Testing

```bash
npm test                        # run all tests (~118 tests)
node --test test/sms.test.mjs   # run a single file
```

Tests use Node's built-in `node:test` runner with no extra test framework. The integration test suite (`test/server.test.mjs`) starts a real HTTP server on a random port and uses a fake `openclaw` stub so no real agent calls or Discord notifications are made during testing.

## Key design constraints

- **State is in-memory**: voice call state resets on server restart; there is no database.
- **No framework**: raw `http.createServer` with manual routing.
- **No TypeScript**: plain ES Modules (`.mjs`).
- **TwiML built by hand**: `lib/twiml.mjs` builds XML strings directly; all user text is XML-escaped.
