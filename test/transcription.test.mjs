import { describe, it, mock } from "node:test";
import assert from "node:assert";

import { transcribeMulawToText } from "../lib/transcription.mjs";

describe("transcribeMulawToText", () => {
  it("calls ffmpeg to convert mulaw to wav", async () => {
    const calls = [];
    const mockRun = mock.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: "Transcribed text", stderr: "" };
    });

    await transcribeMulawToText({ mulawPath: "/tmp/test.mulaw", run: mockRun });

    // First call should be ffmpeg
    assert.strictEqual(calls[0].cmd, "ffmpeg");
    assert.ok(calls[0].args.includes("-f"));
    assert.ok(calls[0].args.includes("mulaw"));
    assert.ok(calls[0].args.includes("-ar"));
    assert.ok(calls[0].args.includes("8000")); // input sample rate
    assert.ok(calls[0].args.includes("16000")); // output sample rate for whisper
    assert.ok(calls[0].args.includes("/tmp/test.mulaw"));
    assert.ok(calls[0].args.includes("/tmp/test.wav"));
  });

  it("calls whisper-cli with correct args", async () => {
    const calls = [];
    const mockRun = mock.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: "Hello world", stderr: "" };
    });

    await transcribeMulawToText({ mulawPath: "/tmp/test.mulaw", run: mockRun });

    // Second call should be whisper-cli
    assert.strictEqual(calls[1].cmd, "whisper-cli");
    assert.ok(calls[1].args.includes("-m")); // model path
    assert.ok(calls[1].args.includes("-nt")); // no timestamps
    assert.ok(calls[1].args.includes("-np")); // no progress
    assert.ok(calls[1].args.includes("/tmp/test.wav"));
  });

  it("returns trimmed transcription", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: "  Transcribed text with spaces  \n",
      stderr: "",
    }));

    const result = await transcribeMulawToText({ mulawPath: "/tmp/test.mulaw", run: mockRun });

    assert.strictEqual(result, "Transcribed text with spaces");
  });

  it("returns empty string for empty transcription", async () => {
    const mockRun = mock.fn(async () => ({
      stdout: "   \n",
      stderr: "",
    }));

    const result = await transcribeMulawToText({ mulawPath: "/tmp/test.mulaw", run: mockRun });

    assert.strictEqual(result, "");
  });

  it("generates correct wav path from mulaw path", async () => {
    let wavPath = null;
    const mockRun = mock.fn(async (cmd, args) => {
      if (cmd === "ffmpeg") {
        // Last argument should be the output wav path
        wavPath = args[args.length - 1];
      }
      return { stdout: "text", stderr: "" };
    });

    await transcribeMulawToText({ mulawPath: "/path/to/audio.mulaw", run: mockRun });

    assert.strictEqual(wavPath, "/path/to/audio.wav");
  });

  it("handles uppercase .MULAW extension", async () => {
    let wavPath = null;
    const mockRun = mock.fn(async (cmd, args) => {
      if (cmd === "ffmpeg") {
        wavPath = args[args.length - 1];
      }
      return { stdout: "text", stderr: "" };
    });

    await transcribeMulawToText({ mulawPath: "/path/to/audio.MULAW", run: mockRun });

    assert.strictEqual(wavPath, "/path/to/audio.wav");
  });
});
