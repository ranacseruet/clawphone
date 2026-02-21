# Twilio Voice Gateway

Local service to receive incoming Twilio voice calls and SMS, bridging them to the OpenClaw agent CLI.

## Prereqs
- `cloudflared` installed + logged in
- `openclaw` CLI on PATH

## Run (trycloudflare)

Terminal A:
```bash
export PORT=8787
export ALLOW_FROM="+15550001111"
export DISCORD_LOG_CHANNEL_ID="DISCORD_CHANNEL_ID_PLACEHOLDER"   # #general
export OPENCLAW_PHONE_SESSION_ID="phone-rana"

# For async SMS follow-ups (when the agent is slow):
export TWILIO_ACCOUNT_SID="AC..."
export TWILIO_AUTH_TOKEN="..."
# Optional: force sender (otherwise uses inbound webhook `To`):
# export TWILIO_SMS_FROM="+15550002222"

# Optional: control max SMS length (default 280)
# export SMS_MAX_CHARS=280

node ~/clawd/projects/twilio-phone-gateway/server.mjs
```

Terminal B:
```bash
cloudflared tunnel --url http://localhost:8787
```
Cloudflared will print a public URL like `https://xxxx.trycloudflare.com`.

In Twilio Console:
- Phone Number → Voice → **A CALL COMES IN** (POST)
  - `https://xxxx.trycloudflare.com/voice`
- Phone Number → Messaging → **A MESSAGE COMES IN** (POST)
  - `https://xxxx.trycloudflare.com/sms`

## Notes
- Voice uses Twilio `<Gather input="speech">` for speech recognition with a polling loop to handle agent latency.
- SMS replies are constrained to be concise (see `SMS_MAX_CHARS`) to avoid Twilio trial length warnings.
- Async SMS follow-ups use the official `twilio` Node SDK when the agent takes longer than 15s.
