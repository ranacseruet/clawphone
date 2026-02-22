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

## Phase 1 — Plugin Packaging (no agent API changes) ✅ COMPLETE (commit: see git log)

**Outcome:** `openclaw plugins install ./twilio-phone-gateway` works. PM2 unchanged.
Agent invocation still goes through the `openclaw` CLI subprocess — no change to
`lib/agent.mjs`.

**Implementation note:** The plan described refactoring `server.mjs` into the factory.
Instead, the factory was extracted to `lib/http-server.mjs` to avoid a module-scope
side-effect conflict: `test/server.test.mjs` does `await import("../server.mjs")` and
relies on the server auto-starting as a side effect. `server.mjs` is now a thin wrapper
that auto-starts (unchanged from the test's perspective); `index.mjs` imports
`createServer` from `lib/http-server.mjs` directly, so it never triggers the auto-start.
Phase 2 should update `lib/http-server.mjs` (not `server.mjs`) when threading `api`.

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

## Phase 2 — Native Agent Invocation ✅ COMPLETE

**Outcome:** `lib/agent.mjs` invokes the OpenClaw agent in-process (no subprocess)
when running as a plugin. Standalone/PM2 path falls back to the CLI subprocess.
PM2 still works unchanged.

### 2.1 — Research findings ✅ RESOLVED

SDK location: `/opt/homebrew/lib/node_modules/openclaw/`
Reference implementation: `/opt/homebrew/lib/node_modules/openclaw/extensions/voice-call/`

#### Agent invocation: `runEmbeddedPiAgent`

There is **no** `api.agent.invoke()`. The function is `runEmbeddedPiAgent`, accessed by
dynamic import from `dist/extensionAPI.js` (same pattern as the bundled voice-call extension):

```js
import { pathToFileURL } from "node:url";
import { join } from "node:path";

// Resolve openclaw root dynamically (same package that OpenClaw itself lives in)
function resolveOpenClawRoot() {
  return join(new URL(import.meta.resolve("openclaw")).pathname, "..", "..");
}

async function loadCoreDeps() {
  const distPath = join(resolveOpenClawRoot(), "dist", "extensionAPI.js");
  return import(pathToFileURL(distPath).href);
}
```

`extensionAPI.js` exports: `runEmbeddedPiAgent`, `resolveStorePath`, `loadSessionStore`,
`saveSessionStore`, `resolveSessionFilePath`, `ensureAgentWorkspace`, `resolveAgentDir`,
`resolveAgentWorkspaceDir`, `resolveAgentTimeoutMs`, `resolveThinkingDefault`,
`resolveAgentIdentity`, `DEFAULT_MODEL`, `DEFAULT_PROVIDER`.

**Signature:**
```typescript
runEmbeddedPiAgent(params: RunEmbeddedPiAgentParams): Promise<EmbeddedPiRunResult>
```

**Key params:**
```typescript
{
  sessionId: string;       // UUID (persistent per caller, stored in session store)
  sessionKey: string;      // e.g. "voice:+15551234567" or "sms:+15551234567"
  sessionFile: string;     // Path to JSONL transcript (from resolveSessionFilePath)
  workspaceDir: string;    // Agent workspace dir (from resolveAgentWorkspaceDir)
  agentDir?: string;       // From resolveAgentDir(config, agentId)
  config: OpenClawConfig;  // api.config (full loaded config)
  prompt: string;          // The user message
  messageProvider: string; // "voice" or "sms"
  agentId?: string;        // e.g. "phone"
  provider?: string;       // e.g. "anthropic"
  model?: string;          // e.g. "claude-sonnet-4-6"
  thinkLevel?: ThinkLevel; // resolveThinkingDefault(...)
  verboseLevel?: string;   // "off" recommended for embedded calls
  timeoutMs: number;       // resolveAgentTimeoutMs({ cfg })
  runId: string;           // e.g. `voice:${callId}:${Date.now()}`
  lane?: string;           // "voice" or "sms" (concurrency lane)
  extraSystemPrompt?: string; // Injected into system prompt
  abortSignal?: AbortSignal;
}
```

**Return — extracting reply text:**
```js
const texts = (result.payloads ?? [])
  .filter(p => p.text && !p.isError)
  .map(p => p.text?.trim())
  .filter(Boolean);
const reply = texts.join(" ") || null;
```

**Complete call pattern** (from `extensions/voice-call/src/response-generator.ts`):
```js
async function agentReply({ prompt, sessionKey, agentId, messageProvider, callId, api }) {
  const deps = await loadCoreDeps();
  const cfg = api.config;

  const storePath = deps.resolveStorePath(cfg.session?.store, { agentId });
  const agentDir = deps.resolveAgentDir(cfg, agentId);
  const workspaceDir = deps.resolveAgentWorkspaceDir(cfg, agentId);
  await deps.ensureAgentWorkspace({ dir: workspaceDir });

  const store = deps.loadSessionStore(storePath);
  let entry = store[sessionKey] ?? { sessionId: crypto.randomUUID(), updatedAt: Date.now() };
  store[sessionKey] = { ...entry, updatedAt: Date.now() };
  await deps.saveSessionStore(storePath, store);

  const sessionFile = deps.resolveSessionFilePath(entry.sessionId, entry, { agentId });
  const timeoutMs = deps.resolveAgentTimeoutMs({ cfg });
  const thinkLevel = deps.resolveThinkingDefault({ cfg, provider: "anthropic", model: DEFAULT_MODEL });

  const result = await deps.runEmbeddedPiAgent({
    sessionId: entry.sessionId,
    sessionKey,
    messageProvider,
    sessionFile,
    workspaceDir,
    agentDir,
    config: cfg,
    prompt,
    provider: "anthropic",
    model: deps.DEFAULT_MODEL,
    thinkLevel,
    verboseLevel: "off",
    timeoutMs,
    runId: `${messageProvider}:${callId}:${Date.now()}`,
    lane: messageProvider,
  });

  return (result.payloads ?? [])
    .filter(p => p.text && !p.isError)
    .map(p => p.text?.trim())
    .filter(Boolean)
    .join(" ") || null;
}
```

#### Discord logging: `api.runtime.channel.discord.sendMessageDiscord`

No `api.notify()` shorthand. Use directly:
```js
await api.runtime.channel.discord.sendMessageDiscord(
  channelId,    // DISCORD_LOG_CHANNEL_ID
  text,
  { accountId: "default" }
);
```

#### `api` object shape (relevant fields for Phase 2)
```typescript
{
  config: OpenClawConfig;          // Full openclaw.json config (needed by runEmbeddedPiAgent)
  pluginConfig?: Record<string, unknown>;
  runtime: {
    channel: {
      discord: { sendMessageDiscord(to, text, opts?) }
      telegram: { sendMessageTelegram(to, text, opts?) }
      // ...
    }
    // ...
  };
  logger: { info, warn, error, debug? };
  registerService(...): void;
  // ...
}
```

### 2.2 — `lib/agent.mjs` refactor (dual-path)

The key design: `openclawReply` and `discordLog` accept an optional `_api` parameter.
When `_api` is present (plugin context), use `runEmbeddedPiAgent` / `sendMessageDiscord`.
When absent (standalone), fall back to the existing CLI subprocess. No other file changes
needed beyond threading `_api` through (see 2.3).

A new `lib/embedded-agent.mjs` module (or top of `lib/agent.mjs`) handles the lazy load
of `extensionAPI.js` so it only runs when actually needed (not at module import time):

```js
// lib/agent.mjs

// Lazy-loaded once on first plugin-path call
let _coreDeps = null;
async function getCoreDeps() {
  if (_coreDeps) return _coreDeps;
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  // Resolve the openclaw package root from the installed binary location
  const root = join(new URL(import.meta.resolve("openclaw")).pathname, "..", "..");
  const distPath = join(root, "dist", "extensionAPI.js");
  _coreDeps = await import(pathToFileURL(distPath).href);
  return _coreDeps;
}

export async function openclawReply({ userText, mode, _api }) {
  // ── Plugin path ────────────────────────────────────────────────────────
  if (_api) {
    const deps = await getCoreDeps();
    const cfg = _api.config;
    // sessionKey scoped by mode so voice and SMS share history per-caller
    const sessionKey = `${mode}:${OPENCLAW_PHONE_SESSION_ID}`;
    const storePath = deps.resolveStorePath(cfg.session?.store, { agentId: OPENCLAW_AGENT_ID });
    const agentDir = deps.resolveAgentDir(cfg, OPENCLAW_AGENT_ID);
    const workspaceDir = deps.resolveAgentWorkspaceDir(cfg, OPENCLAW_AGENT_ID);
    await deps.ensureAgentWorkspace({ dir: workspaceDir });

    const store = deps.loadSessionStore(storePath);
    const entry = store[sessionKey] ?? { sessionId: crypto.randomUUID(), updatedAt: Date.now() };
    store[sessionKey] = { ...entry, updatedAt: Date.now() };
    await deps.saveSessionStore(storePath, store);

    const sessionFile = deps.resolveSessionFilePath(entry.sessionId, entry, { agentId: OPENCLAW_AGENT_ID });
    const timeoutMs = deps.resolveAgentTimeoutMs({ cfg });

    // Build prompt the same way the CLI path does (preserve existing framing)
    const prompt = _buildPrompt(userText, mode);

    await agentSem.acquire();
    try {
      const result = await deps.runEmbeddedPiAgent({
        sessionId:       entry.sessionId,
        sessionKey,
        messageProvider: mode,          // "voice" | "sms"
        sessionFile,
        workspaceDir,
        agentDir,
        config:          cfg,
        prompt,
        verboseLevel:    "off",
        timeoutMs,
        runId:           `${mode}:${Date.now()}`,
        lane:            mode,
      });
      return (result.payloads ?? [])
        .filter(p => p.text && !p.isError)
        .map(p => p.text?.trim())
        .filter(Boolean)
        .join(" ") || "";
    } finally {
      agentSem.release();
    }
  }

  // ── Standalone / PM2 fallback ──────────────────────────────────────────
  return _spawnOpenclawReply({ userText, mode });
}

export async function discordLog({ text, _api }) {
  if (!DISCORD_LOG_CHANNEL_ID) return;

  // ── Plugin path ────────────────────────────────────────────────────────
  if (_api) {
    return _api.runtime.channel.discord
      .sendMessageDiscord(DISCORD_LOG_CHANNEL_ID, text, { accountId: "default" })
      .catch(() => {});
  }

  // ── Standalone / PM2 fallback ──────────────────────────────────────────
  return _spawnDiscordLog(text);
}
```

`_spawnOpenclawReply` and `_spawnDiscordLog` are the existing implementation bodies,
just renamed into private functions. `_buildPrompt` extracts the prompt-construction
logic already in the current `openclawReply` (the `instruction` + `prompt` lines).

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
