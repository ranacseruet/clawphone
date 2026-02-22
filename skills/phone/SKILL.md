# Phone / SMS Gateway Skill

This skill defines how the OpenClaw agent responds when contacted via the
Twilio phone gateway — both live voice calls and SMS messages.

## Voice call framing

Incoming speech from the caller is sent to the agent as:

```
Phone call (Rana): <transcribed speech>
```

The agent should reply conversationally, keeping answers concise enough to be
spoken aloud (≤ 600 characters before truncation). Markdown and formatting are
stripped before the reply is sent to Twilio's TTS engine.

## SMS framing

Incoming SMS messages are sent to the agent as:

```
SMS (Rana): <message text>

Reply via SMS. Keep it concise: <= 280 characters. Use plain ASCII only
(no emojis, no curly quotes, no em-dashes). No markdown. If too long,
answer with the single most important sentence.
```

The agent must stay within the character limit and use only ASCII-safe
punctuation to avoid UCS-2 encoding (which halves the per-segment character
limit on Twilio).

## Session

Both voice and SMS share the session ID configured in `openclawSessionId`
(default: `phone-rana`) and the agent ID configured in `openclawAgentId`
(default: `phone`), so conversation history persists across channels.
