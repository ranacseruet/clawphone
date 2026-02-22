# OpenClaw Plugin Installation

twilio-phone-gateway can run as an **OpenClaw plugin**, which means the gateway process hosts it in-process alongside other OpenClaw extensions — no separate Node server or PM2 required.

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and on `$PATH`
- A Twilio account with a phone number
- `cloudflared` (or another tunnel) to expose a public HTTPS URL for Twilio webhooks

---

## 1. Install the plugin

From the project directory:

```bash
openclaw plugins install .
```

This copies the plugin into `~/.openclaw/extensions/twilio-phone-gateway/`.

---

## 2. Trust the plugin

OpenClaw requires plugins to be explicitly allowed before they load:

```bash
openclaw config set plugins.allow '["twilio-phone-gateway"]'
```

---

## 3. Configure the plugin

All configuration is set via `openclaw config set`. String values must be JSON-quoted (wrapped in single-quotes containing double-quotes):

```bash
# Required — Twilio credentials
openclaw config set plugins.entries.twilio-phone-gateway.config.twilioAccountSid '"ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"'
openclaw config set plugins.entries.twilio-phone-gateway.config.twilioAuthToken '"your_auth_token_here"'

# Required — public URL of this server as Twilio sees it (your tunnel URL)
openclaw config set plugins.entries.twilio-phone-gateway.config.publicBaseUrl '"https://your-tunnel.example.com"'

# Optional — phone number allowlist (E.164 format); omit to allow all numbers
openclaw config set plugins.entries.twilio-phone-gateway.config.allowFrom '["+15550001111","+15550002222"]'

# Optional — override the outbound SMS sender number
openclaw config set plugins.entries.twilio-phone-gateway.config.twilioSmsFrom '"+15550003333"'

# Optional — Discord channel ID for call/SMS logging
openclaw config set plugins.entries.twilio-phone-gateway.config.discordLogChannelId '"1234567890123456789"'

# Optional — display names (used in Discord logs and agent prompt framing)
openclaw config set plugins.entries.twilio-phone-gateway.config.callerName '"Alice"'
openclaw config set plugins.entries.twilio-phone-gateway.config.agentName '"Bot"'
openclaw config set plugins.entries.twilio-phone-gateway.config.greetingText '"You are connected. Say something after the beep."'

# Optional — server port (default: 8787)
openclaw config set plugins.entries.twilio-phone-gateway.config.port 8787

# Optional — OpenClaw session and agent IDs (defaults match the "phone" agent)
openclaw config set plugins.entries.twilio-phone-gateway.config.openclawSessionId '"phone"'
openclaw config set plugins.entries.twilio-phone-gateway.config.openclawAgentId '"phone"'
```

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
openclaw config get plugins.allow          # should include "twilio-phone-gateway"
openclaw config get plugins.entries.twilio-phone-gateway
```

You can also hit the health endpoint:

```bash
curl http://localhost:8787/health
# → {"ok":true}
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

## Updating after code changes

Path-based plugin installs (`openclaw plugins install .`) are a one-time copy. Changes to source files are **not** picked up automatically. To update:

```bash
# Copy changed files to the installed location
cp lib/agent.mjs ~/.openclaw/extensions/twilio-phone-gateway/lib/agent.mjs
# Repeat for any other changed lib/ files, then restart:
openclaw gateway stop && openclaw gateway install
```

Or re-run the full install:

```bash
openclaw plugins install .
openclaw gateway stop && openclaw gateway install
```

---

## Disabling or removing the plugin

```bash
# Disable (keeps config, stops loading)
openclaw plugins disable twilio-phone-gateway
openclaw gateway stop && openclaw gateway install

# Remove entirely
openclaw plugins remove twilio-phone-gateway
```

---

## Plugin vs. standalone comparison

| | Plugin mode | Standalone / PM2 |
|---|---|---|
| **Process** | Hosted inside the OpenClaw gateway | Separate Node.js process |
| **Agent calls** | In-process (`runEmbeddedPiAgent`) | Child process (`openclaw agent …`) |
| **Config** | `openclaw config set …` | `.env` file |
| **Startup** | `openclaw gateway install` | `pm2 start ecosystem.config.cjs` |
| **Updates** | Manual file copy after code changes | `git pull` + `pm2 restart` |
| **Best for** | Running alongside other OpenClaw extensions | Isolated deployment, Docker, servers without OpenClaw gateway |
