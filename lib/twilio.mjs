import Twilio from "twilio";

export function createTwilioClient({ accountSid, authToken }) {
  if (!accountSid || !authToken) {
    throw new Error("accountSid/authToken required");
  }

  const client = new Twilio(accountSid, authToken);

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
