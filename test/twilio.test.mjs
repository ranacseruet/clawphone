// @ts-check
import { describe, it, mock } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

// We can't easily mock the Twilio SDK import, so we test the interface
import { createTwilioClient, validateWebhookSignature } from "../lib/twilio.mjs";

// Compute the expected Twilio HMAC-SHA1 signature for a given token/url/params combo.
function computeTwilioSignature(authToken, url, params) {
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join("");
  return crypto.createHmac("sha1", authToken).update(url + sorted).digest("base64");
}

describe("validateWebhookSignature", () => {
  const authToken = "test-auth-token-abc123";
  const url = "https://twilio.i2dev.com/voice";
  const params = { CallSid: "CA123", From: "+15551234567", To: "+18005550000" };

  it("returns true for a correctly signed request", () => {
    const sig = computeTwilioSignature(authToken, url, params);
    assert.strictEqual(validateWebhookSignature({ authToken, signature: sig, url, params }), true);
  });

  it("returns false for a bad signature", () => {
    assert.strictEqual(
      validateWebhookSignature({ authToken, signature: "bad-signature-value", url, params }),
      false
    );
  });

  it("returns false when signature is empty string", () => {
    assert.strictEqual(
      validateWebhookSignature({ authToken, signature: "", url, params }),
      false
    );
  });

  it("returns false when params differ from signed params", () => {
    const sig = computeTwilioSignature(authToken, url, params);
    assert.strictEqual(
      validateWebhookSignature({ authToken, signature: sig, url, params: { ...params, From: "+19999999999" } }),
      false
    );
  });
});

describe("createTwilioClient", () => {
  it("throws if accountSid is missing", () => {
    assert.throws(() => {
      createTwilioClient({ authToken: "token" });
    }, /accountSid\/authToken required/);
  });

  it("throws if authToken is missing", () => {
    assert.throws(() => {
      createTwilioClient({ accountSid: "sid" });
    }, /accountSid\/authToken required/);
  });

  it("throws if both are missing", () => {
    assert.throws(() => {
      createTwilioClient({});
    }, /accountSid\/authToken required/);
  });

  it("returns an object with sendSms function", () => {
    // Use dummy credentials - won't actually work but tests the interface
    const client = createTwilioClient({
      accountSid: "ACtest123",
      authToken: "test-token",
    });
    
    assert.ok(client);
    assert.strictEqual(typeof client.sendSms, "function");
  });

  describe("sendSms", () => {
    // Factory that returns a fake Twilio SDK client
    function makeFakeTwilio({ createResult } = {}) {
      return () => ({
        messages: {
          create: async (params) =>
            createResult
              ? createResult(params)
              : {
                  sid: "SM_fake_sid",
                  status: "queued",
                  errorCode: null,
                  errorMessage: null,
                  to: params.to,
                  from: params.from,
                },
        },
      });
    }

    it("throws if 'to' is missing", async () => {
      const client = createTwilioClient({
        accountSid: "ACtest123",
        authToken: "test-token",
      });

      await assert.rejects(
        client.sendSms({ from: "+1234567890", body: "test" }),
        /Missing to\/from/
      );
    });

    it("throws if 'from' is missing", async () => {
      const client = createTwilioClient({
        accountSid: "ACtest123",
        authToken: "test-token",
      });

      await assert.rejects(
        client.sendSms({ to: "+1234567890", body: "test" }),
        /Missing to\/from/
      );
    });

    it("calls messages.create and returns normalized response", async () => {
      const client = createTwilioClient({
        accountSid: "ACtest123",
        authToken: "test-token",
        _twilioFactory: makeFakeTwilio(),
      });

      const result = await client.sendSms({
        to: "+15551111111",
        from: "+15552222222",
        body: "Hello there",
      });

      assert.deepStrictEqual(result, {
        sid: "SM_fake_sid",
        status: "queued",
        errorCode: null,
        errorMessage: null,
        to: "+15551111111",
        from: "+15552222222",
      });
    });

    it("passes empty string for body when body is undefined", async () => {
      let capturedBody;
      const client = createTwilioClient({
        accountSid: "ACtest123",
        authToken: "test-token",
        _twilioFactory: makeFakeTwilio({
          createResult: async ({ to, from, body }) => {
            capturedBody = body;
            return { sid: "X", status: "sent", errorCode: null, errorMessage: null, to, from };
          },
        }),
      });

      await client.sendSms({ to: "+15551111111", from: "+15552222222" });
      assert.strictEqual(capturedBody, "");
    });

    it("normalizes all expected fields from the Twilio MessageInstance", async () => {
      const client = createTwilioClient({
        accountSid: "ACtest123",
        authToken: "test-token",
        _twilioFactory: makeFakeTwilio({
          createResult: async () => ({
            sid: "SM999",
            status: "delivered",
            errorCode: 30001,
            errorMessage: "Queue overflow",
            to: "+15551111111",
            from: "+15552222222",
            // extra fields that should be dropped
            price: "-0.00750",
            priceUnit: "USD",
          }),
        }),
      });

      const result = await client.sendSms({
        to: "+15551111111",
        from: "+15552222222",
        body: "test",
      });

      assert.deepStrictEqual(result, {
        sid: "SM999",
        status: "delivered",
        errorCode: 30001,
        errorMessage: "Queue overflow",
        to: "+15551111111",
        from: "+15552222222",
      });
      // Extra fields not included
      assert.strictEqual("price" in result, false);
    });
  });
});
