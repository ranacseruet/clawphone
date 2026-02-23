# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-02-22

### Added
- Twilio voice gateway: `/voice` → `/speech` → `/speech-wait` polling loop that bridges
  phone calls to an OpenClaw AI agent and streams replies via `<Say>`
- Twilio SMS gateway: fast path returns inline TwiML if the agent replies within
  `SMS_FAST_TIMEOUT_MS`; slow path acks immediately and sends a follow-up SMS via the
  Twilio REST API
- Dual-mode operation: `server.mjs` standalone (reads config from env vars) and
  `index.mjs` OpenClaw plugin (receives config from the plugin host); both call the same
  `createServer()` in `lib/http-server.mjs`
- OpenClaw agent integration: plugin mode calls `runEmbeddedPiAgent` in-process;
  standalone mode spawns the `openclaw agent` CLI subprocess
- Per-number sliding-window rate limiting for both voice and SMS (`RATE_LIMIT_MAX`,
  `RATE_LIMIT_WINDOW_MS`)
- Twilio webhook signature validation (`X-Twilio-Signature`) gated on
  `TWILIO_AUTH_TOKEN` + `PUBLIC_BASE_URL` being set
- Allowlist filtering (`ALLOW_FROM`) to restrict which numbers can reach the agent
- Enhanced `/health` endpoint returning `ok`, `version`, `uptime`, `activeTurns`, and
  `twilioConfigured`
- Graceful shutdown on `SIGTERM`/`SIGINT`: stops accepting new connections, drains
  in-flight voice turns, then exits
- Discord activity log via `discordLog()` for caller utterances and agent replies
- Structured JSON logging via `createLogger(module)`: every log line is a
  newline-delimited JSON object with `ts`, `level`, `module`, context fields, and `msg`
- GitHub Actions CI workflow: runs `npm run typecheck` and `npm test` on every push and
  pull request targeting `main`
- OpenClaw plugin manifest (`openclaw.plugin.json`) with full `configSchema` and
  `uiHints` for all configuration fields

[Unreleased]: https://github.com/ranacseruet/clawphone/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ranacseruet/clawphone/releases/tag/v1.0.0
