# Twilio Voice Gateway (Media Streams)

Local service to receive incoming Twilio calls, stream audio over WebSocket, and (initially) transcribe.

## Prereqs
- `cloudflared` installed + logged in (you already did)
- `ffmpeg` installed
- `whisper-cli` installed (via `brew install whisper-cpp`) + model at `~/.cache/whisper/ggml-small.bin`

## Run (trycloudflare)

### Default mode: Gather + Twilio Speech Recognition (fastest)

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

Twilio will POST speech results back to:
- `https://xxxx.trycloudflare.com/speech`

### Optional mode: Media Streams (kept for later)

```bash
export PORT=8787
export USE_MEDIA_STREAMS=true
export PUBLIC_BASE="https://xxxx.trycloudflare.com"
export ALLOW_FROM="+15550001111"
node ~/clawd/projects/twilio-phone-gateway/server.mjs
```

## Notes
- **Default mode** uses Twilio `<Gather input="speech">` for speech recognition (fastest interactive loop).
- Media Streams support is still in the code, but disabled unless `USE_MEDIA_STREAMS=true`.
- SMS replies are constrained to be concise (see `SMS_MAX_CHARS`) to avoid Twilio trial length warnings.
- Async SMS follow-ups use the official `twilio` Node SDK.
