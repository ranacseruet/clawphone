// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert";

// We need to reset state between tests, so we'll re-import
// Actually, since ES modules are cached, we need to test carefully
import {
  createPendingTurn,
  getPendingTurn,
  isLatestTurn,
  completeTurn,
  deleteTurn,
  cleanupStaleTurns,
  pendingSize,
  latestByCallSize,
} from "../lib/voice-state.mjs";

describe("voice-state", () => {
  // Use unique keys per test to avoid state bleeding
  let testId = 0;
  function uniqueKey() {
    testId++;
    return `test-call-${testId}:turn-${testId}`;
  }
  function uniqueCallSid() {
    return `test-call-${testId}`;
  }

  describe("createPendingTurn", () => {
    it("creates a pending turn", () => {
      const key = uniqueKey();
      const callSid = uniqueCallSid();
      
      createPendingTurn({ key, callSid, from: "+1234", said: "hello" });
      
      const turn = getPendingTurn(key);
      assert.ok(turn);
      assert.strictEqual(turn.callSid, callSid);
      assert.strictEqual(turn.from, "+1234");
      assert.strictEqual(turn.said, "hello");
      assert.strictEqual(turn.done, false);
      assert.strictEqual(turn.reply, "");
      
      // Cleanup
      deleteTurn(key);
    });

    it("cancels previous turn for same call", () => {
      const callSid = `cancel-test-${Date.now()}`;
      const key1 = `${callSid}:turn1`;
      const key2 = `${callSid}:turn2`;
      
      createPendingTurn({ key: key1, callSid, from: "+1234", said: "first" });
      createPendingTurn({ key: key2, callSid, from: "+1234", said: "second" });
      
      // First turn should be deleted
      assert.strictEqual(getPendingTurn(key1), undefined);
      
      // Second turn should exist
      const turn2 = getPendingTurn(key2);
      assert.ok(turn2);
      assert.strictEqual(turn2.said, "second");
      
      // Cleanup
      deleteTurn(key2);
    });
  });

  describe("isLatestTurn", () => {
    it("returns true for latest turn", () => {
      const callSid = `latest-test-${Date.now()}`;
      const key = `${callSid}:turn1`;
      
      createPendingTurn({ key, callSid, from: "+1234", said: "test" });
      
      assert.strictEqual(isLatestTurn(key, callSid), true);
      
      // Cleanup
      deleteTurn(key);
    });

    it("returns false for stale turn", () => {
      const callSid = `stale-test-${Date.now()}`;
      const key1 = `${callSid}:turn1`;
      const key2 = `${callSid}:turn2`;
      
      createPendingTurn({ key: key1, callSid, from: "+1234", said: "first" });
      createPendingTurn({ key: key2, callSid, from: "+1234", said: "second" });
      
      // key1 is no longer latest
      assert.strictEqual(isLatestTurn(key1, callSid), false);
      assert.strictEqual(isLatestTurn(key2, callSid), true);
      
      // Cleanup
      deleteTurn(key2);
    });
  });

  describe("completeTurn", () => {
    it("marks turn as done with reply", () => {
      const callSid = `complete-test-${Date.now()}`;
      const key = `${callSid}:turn1`;
      
      createPendingTurn({ key, callSid, from: "+1234", said: "test" });
      completeTurn(key, "This is my reply");
      
      const turn = getPendingTurn(key);
      assert.ok(turn);
      assert.strictEqual(turn.done, true);
      assert.strictEqual(turn.reply, "This is my reply");
      
      // Cleanup
      deleteTurn(key);
    });

    it("defaults to 'Okay.' if reply is empty", () => {
      const callSid = `complete-empty-${Date.now()}`;
      const key = `${callSid}:turn1`;
      
      createPendingTurn({ key, callSid, from: "+1234", said: "test" });
      completeTurn(key, "");

      const turn = getPendingTurn(key);
      assert.ok(turn);
      assert.strictEqual(turn.reply, "Okay.");
      
      // Cleanup
      deleteTurn(key);
    });

    it("handles non-existent key gracefully", () => {
      // Should not throw
      completeTurn("non-existent-key", "reply");
    });
  });

  describe("deleteTurn", () => {
    it("removes turn from pending", () => {
      const callSid = `delete-test-${Date.now()}`;
      const key = `${callSid}:turn1`;

      createPendingTurn({ key, callSid, from: "+1234", said: "test" });
      assert.ok(getPendingTurn(key));

      deleteTurn(key);
      assert.strictEqual(getPendingTurn(key), undefined);
    });

    it("clears latest tracking if this was latest", () => {
      const callSid = `delete-latest-${Date.now()}`;
      const key = `${callSid}:turn1`;

      createPendingTurn({ key, callSid, from: "+1234", said: "test" });
      assert.strictEqual(isLatestTurn(key, callSid), true);

      deleteTurn(key);
      // After deletion, isLatestTurn should return false (no latest)
      assert.strictEqual(isLatestTurn(key, callSid), false);
    });

    it("handles non-existent key gracefully", () => {
      // Should not throw
      deleteTurn("non-existent-key");
    });
  });

  describe("cleanupStaleTurns", () => {
    it("removes turns older than maxAgeMs", async () => {
      const callSid = `stale-cleanup-${Date.now()}`;
      const key = `${callSid}:turn1`;
      createPendingTurn({ key, callSid, from: "+1234", said: "old" });
      // Wait long enough that Date.now() strictly advances past createdAt
      await new Promise((r) => setTimeout(r, 10));
      cleanupStaleTurns(0);
      assert.strictEqual(getPendingTurn(key), undefined);
    });

    it("keeps turns younger than maxAgeMs", () => {
      const callSid = `fresh-cleanup-${Date.now()}`;
      const key = `${callSid}:turn1`;
      createPendingTurn({ key, callSid, from: "+1234", said: "fresh" });
      cleanupStaleTurns(3_600_000);
      assert.ok(getPendingTurn(key));
      deleteTurn(key); // cleanup
    });

    it("cleans up latestByCall for stale turns", async () => {
      const callSid = `stale-latest-${Date.now()}`;
      const key = `${callSid}:turn1`;
      createPendingTurn({ key, callSid, from: "+1234", said: "test" });
      assert.strictEqual(isLatestTurn(key, callSid), true);
      // Wait long enough that Date.now() strictly advances past createdAt
      await new Promise((r) => setTimeout(r, 10));
      cleanupStaleTurns(0);
      assert.strictEqual(isLatestTurn(key, callSid), false);
    });

    it("handles empty maps without throwing", () => {
      assert.doesNotThrow(() => cleanupStaleTurns(0));
    });
  });

  describe("pendingSize / latestByCallSize", () => {
    it("reflects correct delta after createPendingTurn and deleteTurn", () => {
      const callSid = `size-test-${Date.now()}`;
      const key = `${callSid}:turn1`;
      const before = pendingSize();
      const beforeCall = latestByCallSize();
      createPendingTurn({ key, callSid, from: "+1234", said: "test" });
      assert.strictEqual(pendingSize(), before + 1);
      assert.strictEqual(latestByCallSize(), beforeCall + 1);
      deleteTurn(key);
      assert.strictEqual(pendingSize(), before);
      assert.strictEqual(latestByCallSize(), beforeCall);
    });
  });
});
