# Security Policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, open a [GitHub Security Advisory](https://github.com/ranacseruet/twilio-phone-gateway/security/advisories/new) (private disclosure). You can expect an acknowledgement within 48 hours and a patch or mitigation plan within 14 days.

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested mitigations (optional)

## Scope

This project is an HTTP gateway that receives Twilio webhooks and forwards requests to a local agent process. Security-relevant areas include:

- **Webhook signature validation** — all inbound Twilio requests are validated via HMAC-SHA1 when `PUBLIC_BASE_URL` and `TWILIO_AUTH_TOKEN` are set. Without both values configured, signature checking is skipped (intended for local development).
- **Phone number allowlist** — `ALLOW_FROM` restricts which numbers can reach the agent. Leave blank only in trusted environments.
- **Credential handling** — Twilio Account SID, Auth Token, and other secrets must be stored in `.env` (which is gitignored) and never committed to version control.

## Historical note

Early commits in this repository's git history (prior to the OSS release) contained example/personal phone numbers and a Discord channel ID in `ecosystem.config.cjs`. These are not API credentials or secrets and have since been replaced with placeholder values via a history rewrite. All Twilio credentials were always stored in `.env` (gitignored) and were never committed.
