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

This is a Node.js HTTP server (ES Modules, no TypeScript, no framework) that bridges Twilio voice/SMS webhooks with the OpenClaw agent CLI. It uses only the built-in `http` module plus `ws`, `twilio`, and `dotenv`.

### Voice Call Flow (Default Mode)

Twilio's webhook timeout (~15s) makes synchronous agent calls impossible for voice. The gateway uses a **polling loop**:

1. `/voice` — Twilio calls this on connect; returns TwiML `<Gather input="speech">` to capture speech
2. `/speech` — Twilio posts recognized text here; the handler creates an in-memory pending turn (UUID key), fires async `openclawReply()`, then immediately returns a "thinking" phrase + redirect to `/speech-wait?key=...`
3. `/speech-wait` — Twilio polls here; if agent reply is ready, returns the reply + another `<Gather>`; otherwise returns a 2s `<Pause>` + redirect back to itself
4. Loop continues until call ends

The `voice-state.mjs` module tracks pending turns using two Maps (`pending` keyed by UUID, `latestByCall` keyed by CallSid) to handle interruptions and discard stale replies when a caller speaks again mid-thought.

### SMS Flow (Dual-Path)

`lib/sms.mjs` attempts a **fast path** first (≤15s timeout): if the agent replies in time, TwiML returns the text immediately. If the agent takes longer, the gateway acknowledges the SMS instantly, then sends a follow-up SMS asynchronously via the Twilio SDK.

### Agent Integration

`lib/agent.mjs` spawns the `openclaw` CLI as a child process:
- `openclawReply({ userText, mode })` — mode is `"sms"` or `"voice"`, which controls system prompt constraints (SMS enforces ASCII-only, ≤280 chars, no markdown)
- `discordLog({ text })` — fire-and-forget Discord logging via `openclaw message send`
- Agent timeout: 120s

## Configuration

All configuration is via environment variables, centralized in `lib/config.mjs`. Key variables:

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 8787) |
| `ALLOW_FROM` | Comma-separated phone allowlist |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio credentials |
| `TWILIO_SMS_FROM` | Sender phone number |
| `OPENCLAW_PHONE_SESSION_ID` | OpenClaw session for voice |
| `OPENCLAW_PHONE_AGENT_ID` | OpenClaw agent ID |
| `DISCORD_LOG_CHANNEL_ID` | Optional Discord logging |

## External Dependencies

- `cloudflared` — exposes local server via tunnel for Twilio webhooks
- `openclaw` CLI — must be on PATH; the agent backend

## Key Design Constraints

- **State is in-memory**: Voice call state resets on server restart; there is no database.
- **No framework**: Raw `http.createServer` with manual routing; all request bodies are URL-encoded forms parsed by `lib/utils.mjs:parseForm()`.
- **TwiML building**: `lib/twiml.mjs` builds XML strings directly (no SDK TwiML builder); all user-visible text must be XML-escaped.
- **SMS text sanitization**: Unicode punctuation (curly quotes, em-dashes, etc.) is normalized to ASCII before sending, and text is truncated at 280 chars.
