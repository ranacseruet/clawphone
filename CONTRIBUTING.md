# Contributing to twilio-phone-gateway

Thank you for your interest in contributing!

## Development setup

**Requirements:** Node.js ≥ 22, npm, `openclaw` CLI on `$PATH`

```bash
git clone https://github.com/ranacseruet/twilio-phone-gateway.git
cd twilio-phone-gateway
npm install
cp .env.example .env   # fill in your credentials
```

## Running tests

```bash
npm test                          # all 129 tests
node --test test/sms.test.mjs     # single file
```

Tests are fully isolated — no real Twilio API calls, no Discord messages, no live agent invocations. A fake `openclaw` stub is injected onto `PATH` during integration tests.

## Code style

- ES Modules (`.mjs`), no TypeScript, no framework
- No external test framework — Node.js built-in `node:test`
- Keep the dependency list minimal; avoid adding new deps unless essential

## Making changes

1. Fork the repository and create a feature branch
2. Make your changes with tests (new behaviour should have test coverage)
3. Run `npm test` — all tests must pass
4. Open a pull request against `main`

## Reporting bugs

Please use [GitHub Issues](https://github.com/ranacseruet/twilio-phone-gateway/issues) and include:

- Node.js version (`node --version`)
- Steps to reproduce
- Expected vs. actual behaviour

## Security issues

Please **do not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.
