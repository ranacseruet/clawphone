import Twilio from "twilio";

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
