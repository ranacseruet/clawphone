# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test          # Run all tests (node --test, discovers *.test.mjs)
node server.mjs   # Start the gateway server
```

Single test file:
```bash
node --test test/sms.test.mjs
```

PM2 (production):
```bash
pm2 start ecosystem.config.cjs
pm2 logs twilio-phone-gateway
```

OpenClaw plugin (quick reference — full guide in `docs/plugin-install.md`):
```bash
openclaw plugins install .
openclaw config set plugins.allow '["twilio-phone-gateway"]'
openclaw plugins list                              # verify "loaded"
openclaw gateway stop && openclaw gateway install  # restart to reload
```

## Architecture

Full details in [`docs/architecture.md`](docs/architecture.md). Key points for editing code:

- **Two entry points, one server**: `server.mjs` (standalone) and `index.mjs` (plugin) both call `createServer()` in `lib/http-server.mjs`. Changes to HTTP routing go in `http-server.mjs`.
- **Voice uses a polling loop**: `/voice` → `/speech` → `/speech-wait` (polls until agent reply is ready). State lives in `lib/voice-state.mjs` — two Maps keyed by UUID and CallSid.
- **SMS has a fast/slow path**: fast path returns inline TwiML if agent replies within `SMS_FAST_TIMEOUT_MS`; slow path acks immediately and sends a follow-up SMS via Twilio REST API.
- **Agent dual-path**: plugin mode calls `runEmbeddedPiAgent` in-process; standalone spawns `openclaw agent` CLI. Both go through `openclawReply()` in `lib/agent.mjs`.

## Configuration

All config centralised in `lib/config.mjs` (standalone) and `fromPluginConfig()` (plugin). See `.env.example` for the full annotated variable reference and `README.md` for the config table.

## Key Design Constraints

- **State is in-memory**: voice call state resets on server restart; no database.
- **No framework**: raw `http.createServer` with manual routing; request bodies are URL-encoded forms parsed by `lib/utils.mjs:parseForm()`.
- **No TypeScript**: plain ES Modules (`.mjs`).
- **TwiML via SDK**: `lib/twiml.mjs` uses `twilio.twiml.VoiceResponse`; `lib/sms.mjs` uses `twilio.twiml.MessagingResponse`. The SDK handles XML escaping — do not build TwiML strings by hand.
- **SMS text sanitization**: Unicode punctuation is normalised to ASCII before sending (`lib/sms.mjs`). Keep this in mind when modifying SMS reply handling.

## Testing

Tests use Node's built-in `node:test` (~129 tests, 9 files). The integration test (`test/server.test.mjs`) isolates all external calls:

- `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` set to `""` → no real SMS, signature validation skipped
- `DISCORD_LOG_CHANNEL_ID` set to `""` → `discordLog()` no-ops
- Fake `openclaw` stub injected onto `PATH` → agent calls never reach the real binary
