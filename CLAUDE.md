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

OpenClaw plugin mode:
```bash
openclaw plugins install .          # install from project directory
openclaw config set plugins.allow '["twilio-phone-gateway"]'   # trust the plugin
openclaw plugins list               # verify status (should show "loaded")

# Set plugin config (mirrors .env values):
openclaw config set plugins.entries.twilio-phone-gateway.config.twilioAccountSid '"AC..."'
openclaw config set plugins.entries.twilio-phone-gateway.config.twilioAuthToken '"..."'
openclaw config set plugins.entries.twilio-phone-gateway.config.twilioSmsFrom '"+1..."'
openclaw config set plugins.entries.twilio-phone-gateway.config.publicBaseUrl '"https://twilio.i2dev.com"'
openclaw config set plugins.entries.twilio-phone-gateway.config.allowFrom '["+1...","+1..."]'
openclaw config set plugins.entries.twilio-phone-gateway.config.port 8787
openclaw config set plugins.entries.twilio-phone-gateway.config.discordLogChannelId '"..."'

openclaw plugins disable twilio-phone-gateway
openclaw gateway stop && openclaw gateway install  # restart gateway to reload plugin
```

**Plugin update after code changes** (path-based installs don't auto-update):
```bash
cp lib/agent.mjs ~/.openclaw/extensions/twilio-phone-gateway/lib/agent.mjs
# ... copy any changed lib/ files, then restart gateway
openclaw gateway stop && openclaw gateway install
```

## Architecture

This is a Node.js HTTP server (ES Modules, no TypeScript, no framework) that bridges Twilio voice/SMS webhooks with the OpenClaw agent CLI. It uses only the built-in `http` module plus `twilio` and `dotenv` (no `ws` or other networking deps).

It can run as a **standalone server** (via `node server.mjs` / PM2) or as an **OpenClaw plugin** (`openclaw plugins install`). The HTTP server factory lives in `lib/http-server.mjs`; `server.mjs` is the standalone entry point and `index.mjs` is the plugin entry point.

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

`lib/agent.mjs` has a **dual-path** design:

- **Plugin path** (when `api` is injected via `index.mjs`): calls `runEmbeddedPiAgent` from `openclaw/dist/extensionAPI.js` in-process. Discord logging via `api.runtime.channel.discord.sendMessageDiscord()`. The dist path is resolved via `process.argv[1]` (the openclaw host entry point) since the plugin's `node_modules` does not contain `openclaw`.
- **Standalone/PM2 path** (when `api` is `null`): spawns the `openclaw` CLI as a child process (`openclaw agent ...` / `openclaw message send`).

Both paths share:
- `openclawReply({ userText, mode })` — mode `"sms"` or `"voice"` controls prompt framing (SMS enforces ASCII-only, ≤ `SMS_MAX_CHARS` chars, no markdown)
- `discordLog({ text })` — fire-and-forget; no-op when `DISCORD_LOG_CHANNEL_ID` is unset
- Agent timeout: 120s; max concurrency controlled by a semaphore (`OPENCLAW_MAX_CONCURRENT`)

## Configuration

All configuration is via environment variables (standalone path), centralized in `lib/config.mjs`. See `.env.example` for a full annotated reference. The plugin path uses `fromPluginConfig(cfg)` (also in `lib/config.mjs`) which maps the camelCase OpenClaw plugin config to the same internal shape.

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

Tests use the Node.js built-in `node:test` runner (~129 tests across 9 files). The integration test (`test/server.test.mjs`) isolates against real external calls by:
- Setting `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` to `""` → `twilioClient` stays `null`, no real SMS; also causes `checkSignature` to skip validation
- Setting `DISCORD_LOG_CHANNEL_ID` to `""` → `discordLog()` returns early, no Discord messages
- Injecting a fake `openclaw` stub onto `PATH` → `openclawReply()` never reaches the real binary or agent
