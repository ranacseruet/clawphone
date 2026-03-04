# OpenClaw Plugin Installation

clawphone can run as an **OpenClaw plugin**, which means the gateway process hosts it in-process alongside other OpenClaw extensions — no separate Node server or PM2 required.

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and on `$PATH`
- A Twilio account with a phone number
- `cloudflared` (or another tunnel) to expose a public HTTPS URL for Twilio webhooks

---

## Recommended approach

Install from npm, configure, and start — the full flow in one place:

```bash
# Install as an OpenClaw plugin
openclaw plugins install @ranacseruet/clawphone

# Trust the plugin
openclaw config set plugins.allow '["clawphone"]'

# Configure (fill in your real values)
openclaw config set plugins.entries.clawphone.config.twilioAccountSid '"ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"'
openclaw config set plugins.entries.clawphone.config.twilioAuthToken '"your_auth_token_here"'
openclaw config set plugins.entries.clawphone.config.publicBaseUrl '"https://your-tunnel.example.com"'

# Start
openclaw gateway stop && openclaw gateway install

# Verify
openclaw plugins list                  # should show "loaded"
curl http://localhost:8787/health      # → {"ok":true,"version":"...","uptime":42,"activeTurns":0,"twilioConfigured":true}
```

For local development, use a symlink to a local clone instead:

```bash
git clone https://github.com/ranacseruet/clawphone.git
cd clawphone && npm install
openclaw plugins install --link .   # symlink — code changes are picked up immediately
```

See the sections below for the full config reference, Twilio webhook setup, and update workflow.

---

## 1. Install the plugin

`openclaw plugins install` accepts a **local path** or an **npm registry package name**. GitHub URLs and shorthands are not supported.

### From npm

```bash
openclaw plugins install @ranacseruet/clawphone

# Pin to exact resolved version
openclaw plugins install --pin @ranacseruet/clawphone
```

Supports `openclaw plugins update clawphone` to pull newer versions.

### From a local clone

Copy install (one-time snapshot — changes are **not** picked up automatically):

```bash
git clone https://github.com/ranacseruet/clawphone.git
cd clawphone && npm install
openclaw plugins install .
```

Link install (symlink — code changes are picked up immediately, no copy needed):

```bash
openclaw plugins install --link .
```

Use `--link` during active development to avoid the manual file-copy update workflow.

---

## 2. Trust the plugin

OpenClaw requires plugins to be explicitly allowed before they load:

```bash
openclaw config set plugins.allow '["clawphone"]'
```

---

## 3. Configure the plugin

There are three ways to configure the plugin — pick whichever suits your workflow:

| Method | When to use |
|---|---|
| [CLI](#option-a-cli-recommended) | Quickest for initial setup or one-off changes |
| [UI](#option-b-openclaw-ui) | Convenient if you prefer a visual interface |
| [JSON file](#option-c-edit-the-json-config-directly) | Bulk edits, scripted deployments, or copying config between machines |

---

### Option A: CLI (recommended)

`openclaw config set` writes individual values. String values must be JSON-quoted (wrapped in single-quotes containing double-quotes).

#### Required

Three values must be set before the plugin will work:

```bash
# Twilio credentials
openclaw config set plugins.entries.clawphone.config.twilioAccountSid '"ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"'
openclaw config set plugins.entries.clawphone.config.twilioAuthToken '"your_auth_token_here"'

# Public URL of this server as Twilio sees it (your tunnel URL)
openclaw config set plugins.entries.clawphone.config.publicBaseUrl '"https://your-tunnel.example.com"'
```

#### Optional

Everything else has a sensible default and can be set as needed:

```bash
# Phone number allowlist (E.164 format); omit to allow all numbers
openclaw config set plugins.entries.clawphone.config.allowFrom '["+15550001111","+15550002222"]'

# Override the outbound SMS sender number
openclaw config set plugins.entries.clawphone.config.twilioSmsFrom '"+15550003333"'

# Discord channel ID for call/SMS logging
openclaw config set plugins.entries.clawphone.config.discordLogChannelId '"1234567890123456789"'

# Display names (used in Discord logs and agent prompt framing)
openclaw config set plugins.entries.clawphone.config.callerName '"Alice"'
openclaw config set plugins.entries.clawphone.config.agentName '"Bot"'
openclaw config set plugins.entries.clawphone.config.greetingText '"You are connected. Say something after the beep."'

# Server port (default: 8787)
openclaw config set plugins.entries.clawphone.config.port 8787

# OpenClaw session and agent IDs (defaults match the "phone" agent)
openclaw config set plugins.entries.clawphone.config.openclawSessionId '"phone"'
openclaw config set plugins.entries.clawphone.config.openclawAgentId '"phone"'

# Rate limiting (per-number sliding window; 0 disables)
openclaw config set plugins.entries.clawphone.config.rateLimitMax 20
openclaw config set plugins.entries.clawphone.config.rateLimitWindowMs 60000

# Voice polling interval in seconds (default: 1; Twilio minimum: 1)
openclaw config set plugins.entries.clawphone.config.speechWaitPauseSeconds 1

# Twilio STT model (default: phone_call)
# Options: phone_call, googlev2_telephony, googlev2_telephony_short, default
openclaw config set plugins.entries.clawphone.config.twilioSttModel '"phone_call"'
```

---

### Option B: OpenClaw UI

The OpenClaw gateway exposes a web UI where plugin settings can be edited without the CLI. Navigate to the plugin settings page, find **clawphone**, and fill in the fields — the UI labels map directly to the config keys above (e.g. "Twilio Account SID" → `twilioAccountSid`).

> **Note:** UI-based plugin configuration may not be fully functional in all OpenClaw versions. If settings don't persist after saving, use the CLI or JSON method instead.

---

### Option C: Edit the JSON config directly

All OpenClaw config lives in `~/.openclaw/openclaw.json`. You can edit it directly — useful for bulk setup or copying config between machines.

Locate (or add) the `plugins.entries.clawphone` block and set your values:

```json
{
  "plugins": {
    "allow": ["clawphone"],
    "entries": {
      "clawphone": {
        "config": {
          "twilioAccountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          "twilioAuthToken": "your_auth_token_here",
          "publicBaseUrl": "https://your-tunnel.example.com",

          "allowFrom": ["+15550001111", "+15550002222"],
          "twilioSmsFrom": "+15550003333",
          "discordLogChannelId": "1234567890123456789",
          "callerName": "Alice",
          "agentName": "Bot",
          "greetingText": "You are connected. Say something after the beep.",
          "port": 8787,
          "openclawSessionId": "phone",
          "openclawAgentId": "phone",
          "rateLimitMax": 20,
          "rateLimitWindowMs": 60000,
          "speechWaitPauseSeconds": 1,
          "twilioSttModel": "phone_call"
        }
      }
    }
  }
}
```

Only include the keys you want to override — omitted keys use their defaults.

---

## 4. Start the gateway

```bash
openclaw gateway stop && openclaw gateway install
```

---

## 5. Verify the plugin loaded

```bash
openclaw plugins list
```

The plugin should appear with status **loaded**. If it shows **disabled** or is missing, check:

```bash
openclaw config get plugins.allow          # should include "clawphone"
openclaw config get plugins.entries.clawphone
```

You can also hit the health endpoint:

```bash
curl http://localhost:8787/health
# → {"ok":true,"version":"1.0.0","uptime":42,"activeTurns":0,"twilioConfigured":true}
```

---

## 6. Expose via tunnel and wire up Twilio

Start a Cloudflare tunnel (separate terminal):

```bash
cloudflared tunnel --url http://localhost:8787
```

Cloudflared prints a public URL like `https://xxxx.trycloudflare.com`. In the [Twilio Console](https://console.twilio.com), set your phone number's webhooks:

| Event | Method | URL |
|---|---|---|
| A call comes in | POST | `https://xxxx.trycloudflare.com/voice` |
| A message comes in | POST | `https://xxxx.trycloudflare.com/sms` |

---

## Updating the plugin

| Install method | How to update |
|---|---|
| npm registry | `openclaw plugins update clawphone` |
| Local `--link` | No action needed — changes are live immediately |
| Local copy (`.`) | `git pull && npm install`, then re-run `openclaw plugins install .` and restart |

Restart after any update:

```bash
openclaw gateway stop && openclaw gateway install
```

---

## Disabling or removing the plugin

```bash
# Disable (keeps config, stops loading)
openclaw plugins disable clawphone
openclaw gateway stop && openclaw gateway install

# Remove entirely
openclaw plugins uninstall clawphone
```

---

## Plugin vs. standalone comparison

| | Plugin mode | Standalone / PM2 |
|---|---|---|
| **Process** | Hosted inside the OpenClaw gateway | Separate Node.js process |
| **Agent calls** | In-process (`runEmbeddedPiAgent`) | Child process (`openclaw agent …`) |
| **Config** | `openclaw config set …` | `.env` file |
| **Startup** | `openclaw gateway install` | `pm2 start ecosystem.config.cjs` |
| **Updates** | `openclaw plugins update` (npm) or `git pull` + reinstall | `git pull` + `pm2 restart` |
| **Best for** | Running alongside other OpenClaw extensions | Isolated deployment, Docker, servers without OpenClaw gateway |
