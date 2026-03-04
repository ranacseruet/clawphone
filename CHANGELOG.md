# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-03-04

### Added
- `TWILIO_SPEECH_MODEL` / `twilioSttModel` plugin config field to select the Twilio
  speech-to-text model (default: `phone_call`; options: `googlev2_telephony`,
  `googlev2_telephony_short`, `default`)
- Startup warning logged when `ALLOW_FROM` is not set, to make open-access mode
  more visible to operators
- Logo and README header image

### Changed
- `speechModel="phone_call"` now passed to all `<Gather>` TwiML calls, reducing
  Twilio STT latency on telephone audio
- `SPEECH_WAIT_PAUSE_SECONDS` default reduced from 2 s to 1 s for faster voice
  response; exposed as `speechWaitPauseSeconds` plugin config field
- Filler phrase behaviour improved: first phrase delayed to poll 3 (avoids
  interrupting fast agents), then rotates through 3 phrases on subsequent polls

### Fixed
- Test preload now zeroes all external credentials to prevent accidental leakage
  to real Twilio / Discord endpoints during test runs
- `repository.url` in `package.json` corrected to include `git+` prefix

### Tests
- Plugin lifecycle smoke test covering `start()` and `stop()`
- Assertion that every `configSchema` property has a mapping in `fromPluginConfig()`
- Assertion that every `uiHints` key exists in `configSchema` (no orphaned hints)

### Docs
- Plugin install guide overhauled: npm-first recommended flow, three config methods
  (CLI, UI, direct JSON edit), required vs optional settings clearly separated
- Voice best-practices guide and barge-in behaviour documentation added
- Voice latency research report added
- README expanded with badges and "Why clawphone" differentiator section

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

[Unreleased]: https://github.com/ranacseruet/clawphone/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/ranacseruet/clawphone/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ranacseruet/clawphone/releases/tag/v1.0.0
