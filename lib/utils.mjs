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

/**
 * Collect the request body as a string, rejecting with statusCode 413 if too large.
 */
export function readBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        // Do NOT destroy the socket here — the caller needs it to send the 413 response.
        // Excess chunks are silently discarded via the `done` guard above.
        const err = new Error(`Request body exceeded ${maxBytes} bytes`);
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!done) resolve(Buffer.concat(chunks).toString()); });
    req.on("error", (err) => { if (!done) reject(err); });
  });
}

/**
 * Counting semaphore with direct slot handoff.
 */
export function createSemaphore(max) {
  let active = 0;
  const queue = [];
  function acquire() {
    if (active < max) { active++; return Promise.resolve(); }
    return new Promise((resolve) => queue.push(resolve));
  }
  function release() {
    if (queue.length > 0) { queue.shift()(); } // slot passed directly, active unchanged
    else { active--; }
  }
  return { acquire, release };
}
