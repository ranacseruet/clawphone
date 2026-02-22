# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test          # Run all tests (node --test, discovers *.test.mjs)
node server.mjs   # Start the gateway server
```

To run a single test file:
```bash
node --test test/sms.test.mjs
```

PM2 for production:
```bash
pm2 start ecosystem.config.cjs
pm2 logs twilio-phone-gateway
```

## Architecture

This is a Node.js HTTP server (ES Modules, no TypeScript, no framework) that bridges Twilio voice/SMS webhooks with the OpenClaw agent CLI. It uses only the built-in `http` module plus `twilio` and `dotenv` (no `ws` or other networking deps).

### Voice Call Flow

Twilio's webhook timeout (~15s) makes synchronous agent calls impossible for voice. The gateway uses a **polling loop**:

1. `/voice` — Twilio calls this on connect; returns TwiML `<Gather input="speech">` to capture speech
2. `/speech` — Twilio posts recognized text here; the handler creates an in-memory pending turn (UUID key), fires async `openclawReply()`, then immediately returns a "thinking" phrase + redirect to `/speech-wait?key=...`
3. `/speech-wait` — Twilio polls here; if agent reply is ready, returns the reply + another `<Gather>`; otherwise returns a 2s `<Pause>` + redirect back to itself
4. Loop continues until call ends

The `voice-state.mjs` module tracks pending turns using two Maps (`pending` keyed by UUID, `latestByCall` keyed by CallSid) to handle interruptions and discard stale replies when a caller speaks again mid-thought.

### SMS Flow (Dual-Path)

`lib/sms.mjs` attempts a **fast path** first (≤ `SMS_FAST_TIMEOUT_MS`, default 15s): if the agent replies in time, TwiML returns the text immediately. If the agent takes longer, the gateway acknowledges the SMS instantly, then sends a follow-up SMS asynchronously via the Twilio SDK.

### Agent Integration

`lib/agent.mjs` spawns the `openclaw` CLI as a child process:
- `openclawReply({ userText, mode })` — mode is `"sms"` or `"voice"`, which controls system prompt constraints (SMS enforces ASCII-only, ≤ `SMS_MAX_CHARS` chars, no markdown)
- `discordLog({ text })` — fire-and-forget Discord logging via `openclaw message send`; no-op when `DISCORD_LOG_CHANNEL_ID` is unset
- Agent timeout: 120s; max concurrency controlled by a semaphore (`OPENCLAW_MAX_CONCURRENT`)

## Configuration

All configuration is via environment variables, centralized in `lib/config.mjs`. See `.env.example` for a full annotated reference.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Server port |
| `ALLOW_FROM` | *(none)* | Comma-separated E.164 phone allowlist; blank = allow all |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | — | Twilio credentials (required for async SMS) |
| `PUBLIC_BASE_URL` | *(none)* | Public URL of this server (e.g. `https://twilio.i2dev.com`); when set alongside `TWILIO_AUTH_TOKEN`, all webhook POSTs are signature-verified (403 on failure) |
| `TWILIO_SMS_FROM` | *(inbound `To`)* | Override sender number for outbound async SMS |
| `OPENCLAW_PHONE_SESSION_ID` | `phone-rana` | OpenClaw session ID |
| `OPENCLAW_AGENT_ID` | `phone` | OpenClaw agent ID |
| `OPENCLAW_MAX_CONCURRENT` | `10` | Max simultaneous agent invocations |
| `DISCORD_LOG_CHANNEL_ID` | *(disabled)* | Discord channel for call/SMS logging |
| `SMS_MAX_CHARS` | `280` | Max characters in an SMS reply |
| `SMS_FAST_TIMEOUT_MS` | `15000` | Fast-path timeout (ms) before async SMS fallback |

## External Dependencies

- `cloudflared` — exposes local server via tunnel for Twilio webhooks
- `openclaw` CLI — must be on PATH; the agent backend

## Key Design Constraints

- **State is in-memory**: Voice call state resets on server restart; there is no database.
- **No framework**: Raw `http.createServer` with manual routing; all request bodies are URL-encoded forms parsed by `lib/utils.mjs:parseForm()`.
- **TwiML building**: `lib/twiml.mjs` uses `twilio.twiml.VoiceResponse`; `lib/sms.mjs` uses `twilio.twiml.MessagingResponse`. The SDK handles XML escaping internally.
- **SMS text sanitization**: Unicode punctuation (curly quotes, em-dashes, etc.) is normalized to ASCII before sending, and text is truncated at `SMS_MAX_CHARS` chars.

## Testing

Tests use the Node.js built-in `node:test` runner (~113 tests across 8 files). The integration test (`test/server.test.mjs`) isolates against real external calls by:
- Setting `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` to `""` → `twilioClient` stays `null`, no real SMS; also causes `checkSignature` to skip validation
- Setting `DISCORD_LOG_CHANNEL_ID` to `""` → `discordLog()` returns early, no Discord messages
- Injecting a fake `openclaw` stub onto `PATH` → `openclawReply()` never reaches the real binary or agent
