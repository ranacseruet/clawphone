# OpenClaw Plugin Migration Plan

## Goal

Convert `twilio-phone-gateway` from a standalone Node.js server managed by PM2 into an
OpenClaw plugin installable via `openclaw plugins install`. The server must continue to
work via PM2 throughout both phases — no breaking changes to the standalone path.

---

## Current Architecture (as of dfac08c)

```
twilio-phone-gateway/
├── server.mjs              # Top-level HTTP server script (entry point for PM2)
├── ecosystem.config.cjs    # PM2 config — runs `node server.mjs` on port 8787
├── lib/
│   ├── config.mjs          # Reads ALL config from process.env / .env (dotenv)
│   ├── agent.mjs           # Spawns `openclaw agent chat` CLI as child process
│   ├── twiml.mjs           # VoiceResponse SDK builders
│   ├── sms.mjs             # SMS dual-path handler + MessagingResponse
│   ├── twilio.mjs          # createTwilioClient + validateWebhookSignature
│   ├── utils.mjs           # parseForm, readBody, toSayableText, semaphore
│   └── voice-state.mjs     # In-memory pending turns (Maps)
└── test/                   # 113 tests, node:test runner
```

### How agent invocation works today (`lib/agent.mjs`)

`openclawReply({ userText, mode })` does:
1. Acquires a semaphore slot (max `OPENCLAW_MAX_CONCURRENT` concurrent calls)
2. Spawns `openclaw agent chat --session-id <id> --agent-id <id> --output json`
   with userText piped to stdin
3. Reads stdout, parses JSON `{ reply: "..." }`, returns `reply`
4. Timeout: 120 s; on timeout/error, rejects

`discordLog({ text })` spawns `openclaw message send --channel <id> --text <text>`
as fire-and-forget.

### Config surface (all via process.env)

| Env var | Default |
|---|---|
| `PORT` | 8787 |
| `ALLOW_FROM` | "" (allow all) |
| `TWILIO_ACCOUNT_SID` | — |
| `TWILIO_AUTH_TOKEN` | — |
| `TWILIO_SMS_FROM` | — |
| `PUBLIC_BASE_URL` | "" |
| `OPENCLAW_PHONE_SESSION_ID` | "phone-rana" |
| `OPENCLAW_AGENT_ID` | "phone" |
| `OPENCLAW_MAX_CONCURRENT` | 10 |
| `DISCORD_LOG_CHANNEL_ID` | "" |
| `SMS_MAX_CHARS` | 280 |
| `SMS_FAST_TIMEOUT_MS` | 15000 |

---

## Invariant: PM2 Must Keep Working

`pm2 start ecosystem.config.cjs` runs `node server.mjs` directly. Neither phase may
break this. The standalone path is the fallback for both phases.

---

## Phase 1 — Plugin Packaging (no agent API changes)

**Outcome:** `openclaw plugins install ./twilio-phone-gateway` works. PM2 unchanged.
Agent invocation still goes through the `openclaw` CLI subprocess — no change to
`lib/agent.mjs`.

### 1.1 — `package.json`

```json
{
  "name": "@openclaw/twilio-phone-gateway",
  "version": "1.0.0",
  "description": "Twilio voice and SMS gateway plugin for OpenClaw",
  "type": "module",
  "main": "index.mjs",
  "exports": {
    ".": "./index.mjs"
  },
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "dotenv": "^17.3.1",
    "twilio": "^5.8.0"
  }
}
```

Remove `"private": true`. Keep `dotenv` — still used by the standalone path.

### 1.2 — `openclaw.plugin.json`

```json
{
  "id": "twilio-phone-gateway",
  "configSchema": {
    "type": "object",
    "required": ["twilioAccountSid", "twilioAuthToken"],
    "properties": {
      "port":                  { "type": "number",  "default": 8787 },
      "allowFrom":             { "type": "array", "items": { "type": "string" }, "default": [] },
      "twilioAccountSid":      { "type": "string" },
      "twilioAuthToken":       { "type": "string" },
      "twilioSmsFrom":         { "type": "string", "default": "" },
      "publicBaseUrl":         { "type": "string", "default": "" },
      "smsFastTimeoutMs":      { "type": "number",  "default": 15000 },
      "smsMaxChars":           { "type": "number",  "default": 280 },
      "discordLogChannelId":   { "type": "string",  "default": "" },
      "openclawSessionId":     { "type": "string",  "default": "phone-rana" },
      "openclawAgentId":       { "type": "string",  "default": "phone" },
      "openclawMaxConcurrent": { "type": "number",  "default": 10 }
    }
  },
  "uiHints": {
    "twilioAccountSid":  { "label": "Twilio Account SID" },
    "twilioAuthToken":   { "label": "Twilio Auth Token", "sensitive": true },
    "publicBaseUrl":     { "label": "Public Webhook Base URL", "placeholder": "https://twilio.i2dev.com" },
    "allowFrom":         { "label": "Allowed Phone Numbers (E.164)", "placeholder": "+15551234567" }
  }
}
```

### 1.3 — `index.mjs` (new plugin entry point)

```js
import { createServer } from "./server.mjs";

export default {
  id: "twilio-phone-gateway",
  name: "Twilio Phone Gateway",

  register(api) {
    api.registerService({
      name: "twilio-phone-gateway",
      start: async (pluginConfig) => {
        const server = await createServer(pluginConfig);
        return {
          stop: () => new Promise((resolve, reject) =>
            server.close((err) => err ? reject(err) : resolve())
          ),
        };
      },
    });
  },
};
```

`pluginConfig` is the object validated against `configSchema` above — camelCase keys.

### 1.4 — `lib/config.mjs` — add config-object mode

Add a `fromPluginConfig(cfg)` export that maps camelCase plugin config to the same
constants the rest of the codebase uses. The existing module-level `process.env` exports
remain untouched (standalone path).

```js
// New export — used by server.mjs when called as a plugin service
export function fromPluginConfig(cfg) {
  return {
    PORT:                    cfg.port                  ?? 8787,
    ALLOW_FROM:              cfg.allowFrom             ?? [],
    TWILIO_ACCOUNT_SID:      cfg.twilioAccountSid      ?? "",
    TWILIO_AUTH_TOKEN:       cfg.twilioAuthToken       ?? "",
    TWILIO_SMS_FROM:         cfg.twilioSmsFrom         ?? "",
    PUBLIC_BASE_URL:         cfg.publicBaseUrl         ?? "",
    OPENCLAW_PHONE_SESSION_ID: cfg.openclawSessionId   ?? "phone-rana",
    OPENCLAW_AGENT_ID:       cfg.openclawAgentId       ?? "phone",
    OPENCLAW_MAX_CONCURRENT: cfg.openclawMaxConcurrent ?? 10,
    DISCORD_LOG_CHANNEL_ID:  cfg.discordLogChannelId   ?? "",
    SMS_MAX_CHARS:           cfg.smsMaxChars           ?? 280,
    SMS_FAST_TIMEOUT_MS:     cfg.smsFastTimeoutMs      ?? 15000,
    // Static values not in plugin config
    OPENCLAW_TIMEOUT_SECONDS: 120,
    TWILIO_VOICE: "Google.en-US-Chirp3-HD-Charon",
    MAX_SAYABLE_LENGTH: 600,
    SPEECH_WAIT_PAUSE_SECONDS: 2,
    GATHER_TIMEOUT_SECONDS: 10,
    GATHER_FOLLOWUP_TIMEOUT_SECONDS: 12,
    THINKING_PHRASES: [
      "Hmm, give me a second.",
      "Umm, let me think.",
      "Got it. One moment while I think.",
      "Let me check my notes.",
      "Sure thing, just a moment.",
      "Okay, let me see."
    ],
    getRandomThinkingPhrase() {
      return this.THINKING_PHRASES[Math.floor(Math.random() * this.THINKING_PHRASES.length)];
    },
  };
}
```

The `startup warning` (TWILIO_AUTH_TOKEN set but PUBLIC_BASE_URL not) moves inside
`createServer()` so it fires in both modes.

### 1.5 — `server.mjs` — refactor to factory

Current `server.mjs` is a side-effect script: it imports config at module scope and calls
`server.listen()` on load. Refactor to export `createServer(config)`, keeping a
standalone guard at the bottom.

```js
// NEW: factory export used by index.mjs (plugin) and the standalone guard below
export async function createServer(config) {
  // config is either fromPluginConfig(pluginCfg) or the module-level env-based constants
  const {
    PORT, ALLOW_FROM, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
    TWILIO_SMS_FROM, PUBLIC_BASE_URL, SMS_MAX_CHARS, SMS_FAST_TIMEOUT_MS,
    MAX_SAYABLE_LENGTH, getRandomThinkingPhrase,
  } = config;

  // warn on misconfiguration (moved here from config.mjs module scope)
  if (TWILIO_AUTH_TOKEN && !PUBLIC_BASE_URL) {
    console.warn("[twilio-phone-gateway] WARNING: TWILIO_AUTH_TOKEN is set but PUBLIC_BASE_URL is not — webhook signature validation will be skipped.");
  }

  const twilioClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
    ? createTwilioClient({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN })
    : null;

  // ... all route handlers using the local config bindings (not module-level imports) ...

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`twilio-phone-gateway listening on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

// Standalone guard — `node server.mjs` or PM2 hits this path
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  import("./lib/config.mjs").then(({ ...envConfig }) => {
    createServer(envConfig);
  });
}
```

The route handlers inside `createServer` close over the local `config` bindings instead
of importing from `lib/config.mjs` at module scope. `lib/agent.mjs` still reads its own
config from `process.env` in Phase 1 — **no changes to `lib/agent.mjs`**.

### 1.6 — `skills/phone/SKILL.md` (optional but recommended)

Extract the system prompt / persona text currently embedded in `lib/agent.mjs` into a
skill definition. This makes the agent persona visible to OpenClaw's skill system.

### 1.7 — Phase 1 tests

All 113 existing tests pass unchanged — they exercise `server.mjs` via direct import
which still works (factory is just a function). The standalone guard doesn't run during
tests.

Optionally add a smoke test in `test/plugin.test.mjs`:
```js
import { default as plugin } from "../index.mjs";
assert.strictEqual(plugin.id, "twilio-phone-gateway");
assert.strictEqual(typeof plugin.register, "function");
```

### 1.8 — Phase 1 installation (end state)

```bash
# Development (symlink, no copy)
openclaw plugins install -l ./twilio-phone-gateway

# Production (from npm once published)
openclaw plugins install @openclaw/twilio-phone-gateway

# Configure
openclaw plugins config twilio-phone-gateway set twilioAccountSid ACxxx
openclaw plugins config twilio-phone-gateway set twilioAuthToken xxx
openclaw plugins config twilio-phone-gateway set publicBaseUrl https://twilio.i2dev.com

# Enable
openclaw plugins enable twilio-phone-gateway
```

PM2 continues working identically via `pm2 start ecosystem.config.cjs`.

---

## Phase 2 — Native Agent Invocation

**Outcome:** `lib/agent.mjs` invokes the OpenClaw agent in-process (no subprocess)
when running as a plugin. Standalone/PM2 path falls back to the CLI subprocess.
PM2 still works unchanged.

### 2.1 — Open question (must resolve before implementing)

The OpenClaw plugin docs (`https://docs.openclaw.ai/tools/plugin`) do not document a
direct agent invocation API. Before implementing Phase 2, confirm:

1. Does `api` expose an agent invocation method? Candidates to check:
   - `api.agent.invoke({ userText, sessionId, agentId, mode })`
   - `api.agent.chat(...)`
   - `api.runtime.agent.send(...)`
2. What does it return? Presumably a string (the reply text).
3. Is it async? Does it support a timeout?
4. Is there a Discord/notification logging API (`api.notify(...)` or similar) to replace
   the `openclaw message send` subprocess call in `discordLog()`?

**Where to look:**
- OpenClaw SDK source: `~/.openclaw/` or the npm package `openclaw` / `@openclaw/sdk`
- `openclaw plugins doctor` output may hint at available API surface
- The bundled `extensions/voice-call` plugin source referenced in the docs

### 2.2 — `lib/agent.mjs` refactor (dual-path)

The key design: `openclawReply` and `discordLog` accept an optional `_api` parameter.
When `_api` is present (plugin context), use the native API. When absent (standalone),
fall back to the CLI subprocess. No other file changes needed.

```js
// Existing semaphore and OPENCLAW_* config reads stay at module scope for standalone path

export async function openclawReply({ userText, mode, _api }) {
  // ── Plugin path (Phase 2) ──────────────────────────────────────────────
  if (_api?.agent?.invoke) {
    return _semaphore.run(() =>
      withTimeout(
        _api.agent.invoke({
          userText,
          sessionId: OPENCLAW_PHONE_SESSION_ID,
          agentId:   OPENCLAW_AGENT_ID,
          mode,      // "sms" | "voice" — controls system prompt constraints
        }),
        OPENCLAW_TIMEOUT_SECONDS * 1000
      )
    );
  }

  // ── Standalone path (Phase 1 / PM2 fallback) ───────────────────────────
  return _spawnOpenclaw({ userText, mode });
}

export async function discordLog({ text, _api }) {
  if (!DISCORD_LOG_CHANNEL_ID) return;

  // ── Plugin path ────────────────────────────────────────────────────────
  if (_api?.notify) {
    return _api.notify({ channelId: DISCORD_LOG_CHANNEL_ID, text }).catch(() => {});
  }

  // ── Standalone path ────────────────────────────────────────────────────
  return _spawnDiscordLog(text);
}
```

`_spawnOpenclaw` and `_spawnDiscordLog` are the existing implementation bodies, just
renamed into private functions.

### 2.3 — Thread `_api` through `server.mjs` and `lib/sms.mjs`

`createServer(config, api)` receives the optional `api` from `index.mjs`.
`openclawReply` and `discordLog` calls in `server.mjs` and `lib/sms.mjs` pass
`_api: api` through. Standalone calls (no `api` argument) automatically fall back.

`index.mjs` change:
```js
start: async (pluginConfig, api) => {          // <-- api added
  const server = await createServer(fromPluginConfig(pluginConfig), api);
  ...
}
```

`server.mjs` change: close over `api` from `createServer` parameter, pass it to
`openclawReply({ ..., _api: api })` and `discordLog({ ..., _api: api })`.

`lib/sms.mjs` change: `deps.openclawReply` and `deps.discordLog` already arrive via
dependency injection — the server just passes `_api` into the dep closures.

### 2.4 — Phase 2 tests

Add tests to `test/agent.test.mjs`:
- Mock `api.agent.invoke` and verify `openclawReply` calls it when `_api` is provided
- Verify fallback to CLI spawn when `_api` is absent
- Verify `discordLog` uses `_api.notify` when available, and falls back to spawn

### 2.5 — Phase 2 summary of file changes

| File | Change |
|---|---|
| `lib/agent.mjs` | Dual-path `openclawReply` + `discordLog` |
| `server.mjs` | `createServer(config, api)` — thread `api` through |
| `index.mjs` | Pass `api` to `createServer` |
| `lib/sms.mjs` | Pass `_api` into dep closures |
| `test/agent.test.mjs` | New dual-path tests |

No changes to: `lib/twiml.mjs`, `lib/twilio.mjs`, `lib/sms.mjs` core logic,
`lib/voice-state.mjs`, `lib/utils.mjs`, `lib/config.mjs`, `ecosystem.config.cjs`.

---

## Files unchanged across both phases

| File | Reason |
|---|---|
| `lib/twiml.mjs` | Pure TwiML builders, no config or agent dependency |
| `lib/twilio.mjs` | SDK client + signature validator, no config dependency |
| `lib/voice-state.mjs` | Pure in-memory state, no external dependencies |
| `lib/utils.mjs` | Pure utilities |
| `ecosystem.config.cjs` | PM2 config unchanged — standalone path preserved |
| `test/` (existing) | All 113 tests pass through both phases |

---

## Decision log

| Decision | Rationale |
|---|---|
| Phase 1 keeps CLI subprocess in agent.mjs | Avoids blocking on undocumented SDK API; standalone works immediately |
| `fromPluginConfig()` in config.mjs | Single translation point; no camelCase/SCREAMING_SNAKE leakage into the rest of the codebase |
| `api` threaded as parameter, not module global | Keeps all modules testable without a plugin runtime; enables clean fallback |
| `dotenv` kept as dependency | Still needed for standalone / PM2 path |
| Startup warning moved into `createServer()` | Fires in both modes; avoids module-scope side effects during test imports |
