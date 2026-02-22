// @ts-check
import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import {
  createPendingTurn,
  completeTurn,
  deleteTurn,
  pendingSize,
  waitForVoiceDrain,
} from "../lib/voice-state.mjs";

// Test-specific cleanup key prefix to avoid colliding with server.test.mjs
const KEY = "shutdown-test";

describe("waitForVoiceDrain", () => {
  afterEach(() => { deleteTurn(KEY); }); // ensure cleanup even on failure

  it("resolves with 0 immediately when no pending turns", async () => {
    assert.equal(pendingSize(), 0);
    const remaining = await waitForVoiceDrain(200, 50);
    assert.equal(remaining, 0);
  });

  it("waits for a turn to complete and resolves with 0", async () => {
    createPendingTurn({ key: KEY, callSid: "CAshutdown1", from: "+1", said: "hi" });
    setTimeout(() => completeTurn(KEY, "bye"), 80);

    const remaining = await waitForVoiceDrain(500, 50);
    assert.equal(remaining, 0);
  });

  it("returns non-zero when drain times out before turn completes", async () => {
    createPendingTurn({ key: KEY, callSid: "CAshutdown2", from: "+1", said: "hi" });

    const remaining = await waitForVoiceDrain(100, 50); // expires before turn finishes
    assert.ok(remaining > 0, "should have remaining turns on timeout");
  });
});
