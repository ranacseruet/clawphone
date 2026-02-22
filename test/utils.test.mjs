// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";

import { parseForm, toSayableText, run, readBody, createSemaphore, createRateLimiter, createLogger } from "../lib/utils.mjs";

// ─── Mock request factory ───────────────────────────────────────────────────

function makeReq(chunks) {
  const req = /** @type {any} */ (new EventEmitter());
  req.destroy = () => {}; // no-op; readBody no longer calls destroy
  setImmediate(() => {
    for (const chunk of chunks) req.emit("data", Buffer.from(chunk));
    req.emit("end");
  });
  return req;
}

describe("parseForm", () => {
  it("parses URL-encoded form data", () => {
    const result = parseForm("From=%2B1234567890&Body=Hello+World&To=%2B0987654321");
    assert.deepStrictEqual(result, {
      From: "+1234567890",
      Body: "Hello World",
      To: "+0987654321",
    });
  });

  it("handles empty string", () => {
    const result = parseForm("");
    assert.deepStrictEqual(result, {});
  });

  it("handles special characters", () => {
    const result = parseForm("message=Hello%20%26%20Goodbye");
    assert.deepStrictEqual(result, { message: "Hello & Goodbye" });
  });
});

describe("toSayableText", () => {
  it("removes markdown characters", () => {
    const result = toSayableText("**bold** and `code` and _italic_");
    assert.strictEqual(result, "bold and code and italic");
  });

  it("removes list markers and links", () => {
    const result = toSayableText("> quote\n# heading\n[link](url)");
    assert.strictEqual(result, "quote heading link(url)");
  });

  it("collapses whitespace", () => {
    const result = toSayableText("hello    world\n\nfoo");
    assert.strictEqual(result, "hello world foo");
  });

  it("trims result", () => {
    const result = toSayableText("  hello  ");
    assert.strictEqual(result, "hello");
  });

  it("limits length to default 600", () => {
    const long = "a".repeat(700);
    const result = toSayableText(long);
    assert.strictEqual(result.length, 600);
  });

  it("respects custom max length", () => {
    const long = "a".repeat(100);
    const result = toSayableText(long, 50);
    assert.strictEqual(result.length, 50);
  });

  it("handles null/undefined input", () => {
    assert.strictEqual(toSayableText(null), "");
    assert.strictEqual(toSayableText(undefined), "");
  });
});

describe("readBody", () => {
  it("collects multiple chunks into correct string", async () => {
    const req = makeReq(["hello", " ", "world"]);
    const result = await readBody(req);
    assert.strictEqual(result, "hello world");
  });

  it("handles empty body", async () => {
    const req = makeReq([]);
    const result = await readBody(req);
    assert.strictEqual(result, "");
  });

  it("handles single chunk", async () => {
    const req = makeReq(["single"]);
    const result = await readBody(req);
    assert.strictEqual(result, "single");
  });

  it("rejects with statusCode 413 when body exceeds maxBytes", async () => {
    const req = makeReq(["a".repeat(100)]);
    const err = /** @type {Error & { statusCode: number }} */ (await readBody(req, 50).catch((e) => e));
    assert.ok(err instanceof Error);
    assert.strictEqual(err.statusCode, 413);
    assert.match(err.message, /exceeded/);
  });

  it("rejects when the request emits an error", async () => {
    const req = /** @type {any} */ (new EventEmitter());
    req.destroy = () => {};
    setImmediate(() => req.emit("error", new Error("connection reset")));
    await assert.rejects(readBody(req), /connection reset/);
  });
});

describe("createSemaphore", () => {
  it("limits active count to max", async () => {
    const sem = createSemaphore(3);
    let active = 0;
    let maxObserved = 0;
    const tasks = Array.from({ length: 8 }, async () => {
      await sem.acquire();
      active++;
      maxObserved = Math.max(maxObserved, active);
      await new Promise((r) => setImmediate(r));
      active--;
      sem.release();
    });
    await Promise.all(tasks);
    assert.ok(maxObserved <= 3, `maxObserved=${maxObserved} should be <= 3`);
  });

  it("queues excess and resolves in FIFO order", async () => {
    const sem = createSemaphore(1);
    const order = [];
    // Acquire slot so next three must queue
    await sem.acquire();
    const p1 = sem.acquire().then(() => { order.push(1); sem.release(); });
    const p2 = sem.acquire().then(() => { order.push(2); sem.release(); });
    const p3 = sem.acquire().then(() => { order.push(3); sem.release(); });
    sem.release(); // unblock queue
    await Promise.all([p1, p2, p3]);
    assert.deepStrictEqual(order, [1, 2, 3]);
  });

  it("release() unblocks next waiter", async () => {
    const sem = createSemaphore(1);
    await sem.acquire();
    let unblocked = false;
    const waiter = sem.acquire().then(() => { unblocked = true; sem.release(); });
    assert.strictEqual(unblocked, false);
    sem.release();
    await waiter;
    assert.strictEqual(unblocked, true);
  });

  it("works as mutex (max=1): two tasks execute sequentially", async () => {
    const sem = createSemaphore(1);
    const log = [];
    const task = async (id) => {
      await sem.acquire();
      log.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 5));
      log.push(`end-${id}`);
      sem.release();
    };
    await Promise.all([task(1), task(2)]);
    // end-1 must come before start-2 (or end-2 before start-1)
    const i1s = log.indexOf("start-1");
    const i1e = log.indexOf("end-1");
    const i2s = log.indexOf("start-2");
    const i2e = log.indexOf("end-2");
    const sequential = (i1e < i2s) || (i2e < i1s);
    assert.ok(sequential, `log=${JSON.stringify(log)} should show sequential execution`);
  });
});

describe("createRateLimiter", () => {
  it("allows requests up to max", () => {
    const rl = createRateLimiter(3, 60_000);
    assert.strictEqual(rl.check("key1"), true);
    assert.strictEqual(rl.check("key1"), true);
    assert.strictEqual(rl.check("key1"), true);
  });

  it("blocks the (max+1)th request", () => {
    const rl = createRateLimiter(2, 60_000);
    assert.strictEqual(rl.check("key2"), true);
    assert.strictEqual(rl.check("key2"), true);
    assert.strictEqual(rl.check("key2"), false);
  });

  it("tracks different keys independently", () => {
    const rl = createRateLimiter(1, 60_000);
    assert.strictEqual(rl.check("aaa"), true);
    assert.strictEqual(rl.check("bbb"), true);
    assert.strictEqual(rl.check("aaa"), false);
    assert.strictEqual(rl.check("bbb"), false);
  });

  it("max <= 0 disables rate limiting (always returns true)", () => {
    const rl = createRateLimiter(0, 60_000);
    for (let i = 0; i < 100; i++) {
      assert.strictEqual(rl.check("flood"), true);
    }
  });

  it("allows after window expires", async () => {
    const rl = createRateLimiter(1, 50); // 50 ms window
    assert.strictEqual(rl.check("key3"), true);
    assert.strictEqual(rl.check("key3"), false);
    await new Promise((r) => setTimeout(r, 60)); // wait past window
    assert.strictEqual(rl.check("key3"), true);
  });
});

describe("createLogger", () => {
  /**
   * Spy on process.stdout.write and capture what was written.
   * @param {() => void} fn
   * @returns {string[]}
   */
  function captureStdout(fn) {
    const lines = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-ignore — replacing write with a spy for testing
    process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
    try { fn(); } finally { process.stdout.write = orig; }
    return lines;
  }

  it("emits a newline-terminated JSON line", () => {
    const logger = createLogger("test-mod");
    const lines = captureStdout(() => logger.log("hello"));
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].endsWith("\n"));
    const obj = JSON.parse(lines[0]);
    assert.ok(typeof obj.ts === "string");
    assert.strictEqual(obj.level, "info");
    assert.strictEqual(obj.module, "test-mod");
    assert.strictEqual(obj.msg, "hello");
  });

  it("sets level=warn for .warn()", () => {
    const logger = createLogger("test-mod");
    const lines = captureStdout(() => logger.warn("uh oh"));
    const obj = JSON.parse(lines[0]);
    assert.strictEqual(obj.level, "warn");
    assert.strictEqual(obj.msg, "uh oh");
  });

  it("sets level=error for .error()", () => {
    const logger = createLogger("test-mod");
    const lines = captureStdout(() => logger.error("boom"));
    const obj = JSON.parse(lines[0]);
    assert.strictEqual(obj.level, "error");
    assert.strictEqual(obj.msg, "boom");
  });

  it("spreads context fields into the JSON object", () => {
    const logger = createLogger("test-mod");
    const lines = captureStdout(() => logger.log("ctx test", { callSid: "CA123", from: "+15550001111" }));
    const obj = JSON.parse(lines[0]);
    assert.strictEqual(obj.callSid, "CA123");
    assert.strictEqual(obj.from, "+15550001111");
    assert.strictEqual(obj.msg, "ctx test");
  });

  it("ts is a valid ISO-8601 timestamp", () => {
    const logger = createLogger("test-mod");
    const lines = captureStdout(() => logger.log("ts test"));
    const obj = JSON.parse(lines[0]);
    const d = new Date(obj.ts);
    assert.ok(!isNaN(d.getTime()), `ts "${obj.ts}" should be a valid date`);
  });

  it("msg is always the last field (appears after context)", () => {
    const logger = createLogger("test-mod");
    const lines = captureStdout(() => logger.log("last", { extra: "x" }));
    const raw = lines[0].trim();
    const msgIdx = raw.lastIndexOf('"msg"');
    const extraIdx = raw.lastIndexOf('"extra"');
    assert.ok(msgIdx > extraIdx, "msg should come after context keys");
  });
});

describe("run", () => {
  it("runs a command and returns stdout", async () => {
    const result = await run("echo", ["hello world"]);
    assert.strictEqual(result.stdout.trim(), "hello world");
    assert.strictEqual(result.stderr, "");
  });

  it("captures stderr", async () => {
    // Use a command that writes to stderr
    const result = await run("sh", ["-c", "echo error >&2"]);
    assert.strictEqual(result.stderr.trim(), "error");
  });

  it("rejects on non-zero exit code", async () => {
    await assert.rejects(
      run("sh", ["-c", "exit 1"]),
      /exited 1/
    );
  });

  it("rejects on command not found", async () => {
    await assert.rejects(
      run("nonexistent-command-12345", []),
      /ENOENT|spawn/i
    );
  });

  it("passes options to spawn", async () => {
    const result = await run("pwd", [], { cwd: "/tmp" });
    assert.ok(result.stdout.includes("/tmp") || result.stdout.includes("/private/tmp"));
  });
});
