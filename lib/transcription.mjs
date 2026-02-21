import os from "node:os";
import path from "node:path";

import { run as defaultRun } from "./utils.mjs";

/**
 * Transcribe mu-law audio file to text using Whisper.
 * 
 * @param {Object} options
 * @param {string} options.mulawPath - Path to mu-law audio file
 * @param {Function} [options.run] - Optional run function for testing
 * @returns {Promise<string>} Transcribed text
 */
export async function transcribeMulawToText({ mulawPath, run = defaultRun }) {
  const wavPath = mulawPath.replace(/\.mulaw$/i, ".wav");
  
  // Convert μ-law 8k to 16k mono wav for whisper
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "mulaw",
    "-ar",
    "8000",
    "-ac",
    "1",
    "-i",
    mulawPath,
    "-ac",
    "1",
    "-ar",
    "16000",
    wavPath,
  ]);

  const modelPath = path.join(os.homedir(), ".cache/whisper/ggml-small.bin");
  const { stdout } = await run("whisper-cli", ["-m", modelPath, "-nt", "-np", wavPath]);
  
  return stdout.trim();
}
