// @ts-check
import Twilio from "twilio";

/**
 * @typedef {object} SmsResult
 * @property {string} sid
 * @property {string} status
 * @property {*}      errorCode
 * @property {*}      errorMessage
 * @property {string} to
 * @property {string} from
 */

/**
 * @param {{ authToken: string, signature: string, url: string, params: Record<string, string> }} opts
 * @returns {boolean}
 */
export function validateWebhookSignature({ authToken, signature, url, params }) {
  return Twilio.validateRequest(authToken, signature || "", url, params);
}

/**
 * @param {{ accountSid: string, authToken: string, _twilioFactory?: Function }} opts
 * @returns {{ sendSms: (opts: { to: string, from: string, body: string }) => Promise<SmsResult> }}
 */
export function createTwilioClient({ accountSid, authToken, _twilioFactory }) {
  if (!accountSid || !authToken) {
    throw new Error("accountSid/authToken required");
  }

  // _twilioFactory is an escape hatch for tests; production always uses new Twilio().
  const client = _twilioFactory
    ? _twilioFactory(accountSid, authToken)
    : new Twilio(accountSid, authToken);

  async function sendSms({ to, from, body }) {
    if (!to || !from) throw new Error(`Missing to/from (to=${to}, from=${from})`);

    // twilio-node returns a MessageInstance with fields like sid, status, errorCode, errorMessage.
    const msg = await client.messages.create({
      to,
      from,
      body: body || "",
    });

    // Normalize to a small JSON shape for our logs/tests.
    return {
      sid: msg.sid,
      status: msg.status,
      errorCode: msg.errorCode,
      errorMessage: msg.errorMessage,
      to: msg.to,
      from: msg.from,
    };
  }

  return { sendSms };
}
