// @ts-check
import twilio from "twilio";
import {
  TWILIO_VOICE,
  GATHER_TIMEOUT_SECONDS,
  GATHER_FOLLOWUP_TIMEOUT_SECONDS,
  SPEECH_WAIT_PAUSE_SECONDS,
} from "./config.mjs";

const { VoiceResponse } = twilio.twiml;

/**
 * TwiML response builders for voice calls.
 * Centralizes voice settings and common patterns.
 */

/**
 * Simple <Say> response.
 */
export function say(text) {
  const r = new VoiceResponse();
  r.say({ voice: TWILIO_VOICE }, text);
  return r.toString();
}

/**
 * Say and hangup.
 */
export function sayAndHangup(text) {
  const r = new VoiceResponse();
  r.say({ voice: TWILIO_VOICE }, text);
  r.hangup();
  return r.toString();
}

/**
 * Say and redirect.
 */
export function sayAndRedirect(text, redirectUrl) {
  const r = new VoiceResponse();
  r.say({ voice: TWILIO_VOICE }, text);
  r.redirect({ method: "POST" }, redirectUrl);
  return r.toString();
}

/**
 * Initial greeting with speech gather.
 */
export function greetingWithGather(greeting, beepText = "Beep.", noInputText = "I did not hear anything. Let's try again.") {
  const r = new VoiceResponse();
  r.say({ voice: TWILIO_VOICE }, greeting);
  const gather = r.gather({ input: ["speech"], action: "/speech", method: "POST", speechTimeout: "auto", timeout: GATHER_TIMEOUT_SECONDS, speechModel: "phone_call" });
  gather.say({ voice: TWILIO_VOICE }, beepText);
  r.say({ voice: TWILIO_VOICE }, noInputText);
  r.redirect({ method: "POST" }, "/voice");
  return r.toString();
}

/**
 * Response with follow-up gather.
 */
export function replyWithGather(replyText, promptText = "Say your next message after the beep.", noInputText = "I didn't catch anything. Say it again.") {
  const r = new VoiceResponse();
  r.say({ voice: TWILIO_VOICE }, replyText);
  const gather = r.gather({ input: ["speech"], action: "/speech", method: "POST", speechTimeout: "auto", timeout: GATHER_FOLLOWUP_TIMEOUT_SECONDS, speechModel: "phone_call" });
  gather.say({ voice: TWILIO_VOICE }, promptText);
  r.say({ voice: TWILIO_VOICE }, noInputText);
  r.redirect({ method: "POST" }, "/speech");
  return r.toString();
}

/**
 * Redirect with thinking phrase.
 */
export function thinkingRedirect(phrase, waitUrl) {
  const r = new VoiceResponse();
  r.say({ voice: TWILIO_VOICE }, phrase);
  r.redirect({ method: "POST" }, waitUrl);
  return r.toString();
}

/**
 * Pause and redirect (for polling).
 */
export function pauseAndRedirect(waitUrl) {
  const r = new VoiceResponse();
  r.pause({ length: SPEECH_WAIT_PAUSE_SECONDS });
  r.redirect({ method: "POST" }, waitUrl);
  return r.toString();
}
