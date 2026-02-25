# Best practices

## Choose a fast agent model

The biggest factor in perceived call quality is how quickly the agent responds. Every poll cycle in the `/speech-wait` loop adds ~2 s of dead air. Configure your OpenClaw agent to use the fastest model available for your use case — a lightweight model (e.g. Claude Haiku) typically cuts wait time by 3–5 s compared to a large reasoning model, with little noticeable quality loss for conversational replies.

## Turn off extended thinking / reasoning

Extended thinking can add 10–30 s to an agent response. The standalone path already passes `--thinking off` to `openclaw agent`, but if your agent's own system prompt or config enables reasoning, override it for the phone agent. Fast, short answers beat thorough slow ones on a voice call.

## Write a voice-optimised system prompt

Twilio reads the reply aloud via TTS, and long answers are uncomfortable on the phone. Tell your agent:

- **Keep replies short** — one to three sentences for most answers
- **Speak in plain prose** — no bullet points, markdown, code blocks, or URLs
- **Avoid filler** — no "Certainly!", "Great question!", or "As an AI…" preambles

Replies are hard-truncated at 600 characters before being sent to TTS, so an agent that writes naturally short answers sounds better than one that gets cut off mid-sentence.

## Keep `GREETING_TEXT` brief

The caller hears the full greeting before they can speak. A one-sentence greeting (`You're connected. Go ahead.`) gets them talking sooner than a multi-sentence introduction.

## Tune `SMS_FAST_TIMEOUT_MS` to your model

The fast-path SMS timeout defaults to 15 s. If your agent typically replies in 4–6 s, lower this to something like `8000` — you get inline replies for normal queries while still falling back to async for slow ones. Setting it too high means callers wait longer for every SMS.

## Lock down `ALLOW_FROM` in production

Leave `ALLOW_FROM` blank only in development. In production, set it to your own number(s). An open gateway will accept calls from anyone and run agent invocations against your account.

`ALLOW_FROM` and webhook signature validation are two independent security layers — both should be set in production:

| Layer | What it protects against | How to enable |
|---|---|---|
| Webhook signature validation | Fake requests hitting your endpoint directly (not from Twilio) | Set both `TWILIO_AUTH_TOKEN` and `PUBLIC_BASE_URL` |
| `ALLOW_FROM` allowlist | Legitimate Twilio calls from unauthorised numbers | Set `ALLOW_FROM` to a comma-separated list of E.164 numbers |

Signature validation alone does not stop a real call from an unknown number. `ALLOW_FROM` alone does not stop someone from hitting your webhook URL directly. The server emits a startup warning if either is unconfigured.

## Set `OPENCLAW_MAX_CONCURRENT=1` for personal use

The default (`10`) is sized for multi-user deployments. For a single-person assistant, set this to `1`. It makes concurrency behaviour predictable and prevents two overlapping agent calls if something unexpected re-enters `/speech`.
