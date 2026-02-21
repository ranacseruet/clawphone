import { spawn } from "node:child_process";

/**
 * Parse URL-encoded form body into an object.
 */
export function parseForm(body) {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}

/**
 * Run a command and return { stdout, stderr }.
 * Rejects if exit code is non-zero.
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

/**
 * Sanitize text for Twilio <Say> - remove markdown, limit length.
 */
export function toSayableText(input, maxLength = 600) {
  return String(input || "")
    .replace(/[`*_>#\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
