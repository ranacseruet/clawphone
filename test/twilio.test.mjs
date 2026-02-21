import { describe, it, mock } from "node:test";
import assert from "node:assert";

// We can't easily mock the Twilio SDK import, so we test the interface
import { createTwilioClient } from "../lib/twilio.mjs";

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
  });
});
