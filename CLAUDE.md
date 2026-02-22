# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Testing hygiene (always enforce)

Every code change must have corresponding test coverage — do not close a task without it:

- **New behaviour** → add tests covering the happy path and key failure cases
- **Changed behaviour** → update existing tests to match; a passing test suite that asserts the old behaviour is a bug, not a success
- **Bug fix** → add a regression test that would have caught the bug
- **New env var or config field** → add a test in `test/config.test.mjs` or `test/plugin.test.mjs` verifying the default and any non-trivial mapping
- **New HTTP route** → add integration tests in `test/server.test.mjs`

Always run `npm test` and confirm all 129+ tests pass before committing.

## Documentation hygiene (always enforce)

Whenever you make code changes, check whether any of the following need updating **before closing the task** — do not wait to be asked:

| What changed | Docs to check |
|---|---|
| New/removed/renamed env var | `README.md` config table, `.env.example`, `docs/plugin-install.md` config block, `openclaw.plugin.json` configSchema, `lib/config.mjs` `fromPluginConfig()` |
| New/changed config field (plugin) | `openclaw.plugin.json` configSchema + uiHints, `docs/plugin-install.md`, `lib/config.mjs` `fromPluginConfig()` |
| Voice/SMS/agent behaviour change | `docs/architecture.md`, `skills/phone/SKILL.md` |
| New HTTP route or endpoint | `docs/architecture.md` flow diagrams |
| Module added/removed/renamed | `docs/architecture.md` module layout, `CLAUDE.md` architecture summary |
| Deployment or startup change | `README.md`, `docs/plugin-install.md` |

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
pm2 logs clawphone
```

OpenClaw plugin (quick reference — full guide in `docs/plugin-install.md`):
```bash
openclaw plugins install ranacseruet/clawphone  # from GitHub
openclaw plugins install --link .                          # local dev (live symlink)
openclaw config set plugins.allow '["clawphone"]'
openclaw plugins list                                      # verify "loaded"
openclaw gateway stop && openclaw gateway install          # restart to reload
openclaw plugins update clawphone               # update (GitHub/npm installs)
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
