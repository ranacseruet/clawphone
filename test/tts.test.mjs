import { describe, it, mock } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ttsToMulaw, streamMulawToTwilio, sayToCaller } from "../lib/tts.mjs";

describe("ttsToMulaw", () => {
  it("calls say and ffmpeg with correct args", async () => {
    const calls = [];
    const mockRun = mock.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: "", stderr: "" };
    });

    const outPath = "/tmp/test-output.mulaw";
    await ttsToMulaw({ text: "Hello world", outMulawPath: outPath, run: mockRun });

    assert.strictEqual(calls.length, 2);
    
    // First call should be 'say'
    assert.strictEqual(calls[0].cmd, "say");
    assert.ok(calls[0].args.includes("-o"));
    assert.ok(calls[0].args.includes("Hello world"));
    
    // Second call should be 'ffmpeg'
    assert.strictEqual(calls[1].cmd, "ffmpeg");
    assert.ok(calls[1].args.includes("-ar"));
    assert.ok(calls[1].args.includes("8000"));
    assert.ok(calls[1].args.includes("-f"));
    assert.ok(calls[1].args.includes("mulaw"));
    assert.ok(calls[1].args.includes(outPath));
  });

  it("generates correct intermediate aiff path", async () => {
    let aiffPath = null;
    const mockRun = mock.fn(async (cmd, args) => {
      if (cmd === "say") {
        const oIdx = args.indexOf("-o");
        aiffPath = args[oIdx + 1];
      }
      return { stdout: "", stderr: "" };
    });

    await ttsToMulaw({ text: "Test", outMulawPath: "/tmp/output.mulaw", run: mockRun });

    assert.ok(aiffPath);
    assert.ok(aiffPath.endsWith(".aiff"));
    assert.ok(aiffPath.includes("/tmp/output"));
  });
});

describe("streamMulawToTwilio", () => {
  it("sends audio frames to WebSocket", async () => {
    const sentMessages = [];
    const mockWs = {
      readyState: 1, // WebSocket.OPEN
      OPEN: 1,
      send: (data) => sentMessages.push(JSON.parse(data)),
    };

    // Create a small test file
    const testPath = path.join(os.tmpdir(), `test-stream-${Date.now()}.mulaw`);
    // Write 320 bytes (2 frames worth at 160 bytes each)
    await fs.writeFile(testPath, Buffer.alloc(320, 0x7f));

    try {
      await streamMulawToTwilio({ ws: mockWs, streamSid: "STREAM123", mulawPath: testPath });

      // Should have sent 2 frames
      assert.strictEqual(sentMessages.length, 2);
      
      // Check message structure
      assert.strictEqual(sentMessages[0].event, "media");
      assert.strictEqual(sentMessages[0].streamSid, "STREAM123");
      assert.ok(sentMessages[0].media.payload); // base64 encoded
      
      // Verify payload is base64
      const decoded = Buffer.from(sentMessages[0].media.payload, "base64");
      assert.strictEqual(decoded.length, 160);
    } finally {
      await fs.unlink(testPath).catch(() => {});
    }
  });

  it("stops if WebSocket closes", async () => {
    const sentMessages = [];
    let sendCount = 0;
    const mockWs = {
      get readyState() {
        // Close after first send
        return sendCount < 1 ? 1 : 3; // OPEN then CLOSED
      },
      OPEN: 1,
      send: (data) => {
        sendCount++;
        sentMessages.push(JSON.parse(data));
      },
    };

    const testPath = path.join(os.tmpdir(), `test-stream-close-${Date.now()}.mulaw`);
    await fs.writeFile(testPath, Buffer.alloc(480, 0x7f)); // 3 frames

    try {
      await streamMulawToTwilio({ ws: mockWs, streamSid: "STREAM123", mulawPath: testPath });

      // Should have only sent 1 frame before detecting closed socket
      assert.strictEqual(sentMessages.length, 1);
    } finally {
      await fs.unlink(testPath).catch(() => {});
    }
  });

  it("handles empty file gracefully", async () => {
    const sentMessages = [];
    const mockWs = {
      readyState: 1,
      OPEN: 1,
      send: (data) => sentMessages.push(JSON.parse(data)),
    };

    const testPath = path.join(os.tmpdir(), `test-stream-empty-${Date.now()}.mulaw`);
    await fs.writeFile(testPath, Buffer.alloc(0));

    try {
      await streamMulawToTwilio({ ws: mockWs, streamSid: "STREAM123", mulawPath: testPath });
      assert.strictEqual(sentMessages.length, 0);
    } finally {
      await fs.unlink(testPath).catch(() => {});
    }
  });
});

describe("sayToCaller", () => {
  it("generates TTS, streams to WebSocket, and cleans up temp file", async () => {
    const sentMessages = [];
    const mockWs = {
      readyState: 1,
      OPEN: 1,
      send: (data) => sentMessages.push(JSON.parse(data)),
    };

    // Track what files are created
    let createdMulawPath = null;
    const mockRun = mock.fn(async (cmd, args) => {
      if (cmd === "say") {
        // Find output path and create a mock mulaw file
        const oIdx = args.indexOf("-o");
        const aiffPath = args[oIdx + 1];
        createdMulawPath = aiffPath.replace(/\.aiff$/i, ".mulaw");
      }
      if (cmd === "ffmpeg") {
        // Create the mulaw file that streamMulawToTwilio will read
        if (createdMulawPath) {
          await fs.writeFile(createdMulawPath, Buffer.alloc(160, 0x55));
        }
      }
      return { stdout: "", stderr: "" };
    });

    await sayToCaller({ ws: mockWs, streamSid: "STREAM123", text: "Hello", run: mockRun });

    // Should have called say and ffmpeg
    assert.strictEqual(mockRun.mock.calls.length, 2);
    assert.strictEqual(mockRun.mock.calls[0].arguments[0], "say");
    assert.strictEqual(mockRun.mock.calls[1].arguments[0], "ffmpeg");

    // Should have sent at least one frame
    assert.ok(sentMessages.length >= 1);

    // Temp file should be cleaned up (may already be gone)
    if (createdMulawPath) {
      try {
        await fs.access(createdMulawPath);
        assert.fail("Temp file should have been deleted");
      } catch (err) {
        // Expected - file should not exist
        assert.strictEqual(err.code, "ENOENT");
      }
    }
  });

  it("cleans up temp file even on error", async () => {
    const mockWs = {
      readyState: 1,
      OPEN: 1,
      send: () => {},
    };

    let createdMulawPath = null;
    const mockRun = mock.fn(async (cmd, args) => {
      if (cmd === "say") {
        const oIdx = args.indexOf("-o");
        const aiffPath = args[oIdx + 1];
        createdMulawPath = aiffPath.replace(/\.aiff$/i, ".mulaw");
        // Create the file so cleanup can try to delete it
        await fs.writeFile(createdMulawPath, Buffer.alloc(10));
      }
      if (cmd === "ffmpeg") {
        throw new Error("ffmpeg failed");
      }
      return { stdout: "", stderr: "" };
    });

    await assert.rejects(
      sayToCaller({ ws: mockWs, streamSid: "STREAM123", text: "Hello", run: mockRun }),
      /ffmpeg failed/
    );

    // Temp file should still be cleaned up
    if (createdMulawPath) {
      try {
        await fs.access(createdMulawPath);
        assert.fail("Temp file should have been deleted");
      } catch (err) {
        assert.strictEqual(err.code, "ENOENT");
      }
    }
  });
});
