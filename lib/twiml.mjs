import { xmlEscape } from "./sms.mjs";
import {
  TWILIO_VOICE,
  GATHER_TIMEOUT_SECONDS,
  GATHER_FOLLOWUP_TIMEOUT_SECONDS,
  SPEECH_WAIT_PAUSE_SECONDS,
} from "./config.mjs";

/**
 * TwiML response builders for voice calls.
 * Centralizes voice settings and common patterns.
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * Simple <Say> response.
 */
export function say(text) {
  return `${XML_HEADER}\n<Response><Say voice="${TWILIO_VOICE}">${xmlEscape(text)}</Say></Response>`;
}

/**
 * Say and hangup.
 */
export function sayAndHangup(text) {
  return `${XML_HEADER}\n<Response><Say voice="${TWILIO_VOICE}">${xmlEscape(text)}</Say><Hangup/></Response>`;
}

/**
 * Say and redirect.
 */
export function sayAndRedirect(text, redirectUrl) {
  return `${XML_HEADER}\n<Response><Say voice="${TWILIO_VOICE}">${xmlEscape(text)}</Say><Redirect method="POST">${xmlEscape(redirectUrl)}</Redirect></Response>`;
}

/**
 * Initial greeting with speech gather.
 */
export function greetingWithGather(greeting, beepText = "Beep.", noInputText = "I did not hear anything. Let's try again.") {
  return `${XML_HEADER}
<Response>
  <Say voice="${TWILIO_VOICE}">${xmlEscape(greeting)}</Say>
  <Gather input="speech" action="/speech" method="POST" speechTimeout="auto" timeout="${GATHER_TIMEOUT_SECONDS}">
    <Say voice="${TWILIO_VOICE}">${xmlEscape(beepText)}</Say>
  </Gather>
  <Say voice="${TWILIO_VOICE}">${xmlEscape(noInputText)}</Say>
  <Redirect method="POST">/voice</Redirect>
</Response>`;
}

/**
 * Response with follow-up gather.
 */
export function replyWithGather(replyText, promptText = "Say your next message after the beep.", noInputText = "I didn't catch anything. Say it again.") {
  return `${XML_HEADER}
<Response>
  <Say voice="${TWILIO_VOICE}">${xmlEscape(replyText)}</Say>
  <Gather input="speech" action="/speech" method="POST" speechTimeout="auto" timeout="${GATHER_FOLLOWUP_TIMEOUT_SECONDS}">
    <Say voice="${TWILIO_VOICE}">${xmlEscape(promptText)}</Say>
  </Gather>
  <Say voice="${TWILIO_VOICE}">${xmlEscape(noInputText)}</Say>
  <Redirect method="POST">/speech</Redirect>
</Response>`;
}

/**
 * Redirect with thinking phrase.
 */
export function thinkingRedirect(phrase, waitUrl) {
  return `${XML_HEADER}
<Response>
  <Say voice="${TWILIO_VOICE}">${xmlEscape(phrase)}</Say>
  <Redirect method="POST">${xmlEscape(waitUrl)}</Redirect>
</Response>`;
}

/**
 * Pause and redirect (for polling).
 */
export function pauseAndRedirect(waitUrl) {
  return `${XML_HEADER}
<Response>
  <Pause length="${SPEECH_WAIT_PAUSE_SECONDS}"/>
  <Redirect method="POST">${xmlEscape(waitUrl)}</Redirect>
</Response>`;
}

