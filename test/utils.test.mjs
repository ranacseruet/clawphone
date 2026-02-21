import { describe, it } from "node:test";
import assert from "node:assert";

import { parseForm, toSayableText, run } from "../lib/utils.mjs";

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
