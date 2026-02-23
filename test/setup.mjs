// @ts-check
/**
 * Test environment preload — imported before any test module via NODE_OPTIONS.
 *
 * Problem: test files that use static imports (e.g. agent.test.mjs) cause
 * lib/config.mjs to run dotenvConfig() before any test code can zero
 * credentials. dotenv skips vars that are already in process.env, so if we
 * set them here — before any module loads — the real .env values are ignored.
 *
 * This is defence-in-depth: even if a future test forgets to pass run:mockRun,
 * the real Twilio / Discord / openclaw credentials will never be active.
 *
 * server.test.mjs already sets these vars explicitly; the preload just ensures
 * every other test file gets the same treatment automatically.
 */
process.env.TWILIO_ACCOUNT_SID     = "";
process.env.TWILIO_AUTH_TOKEN      = "";
process.env.DISCORD_LOG_CHANNEL_ID = "";
