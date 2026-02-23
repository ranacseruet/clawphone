// @ts-check
/**
 * Standalone entry point — used by `node server.mjs` and PM2.
 *
 * Reads config from environment variables (via lib/config.mjs) and starts the
 * HTTP server. Exports `{ server }` for the integration test.
 *
 * Plugin path: index.mjs imports createServer from lib/http-server.mjs directly
 * and never touches this file, so no plugin-vs-standalone conflict exists.
 */
import * as envConfig from "./lib/config.mjs";
import { createServer } from "./lib/http-server.mjs";
import { waitForVoiceDrain } from "./lib/voice-state.mjs";
import { createLogger } from "./lib/utils.mjs";

const serverLog = createLogger("server");

export const server = await createServer(envConfig);

/**
 * @param {string} signal
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal) {
  serverLog.log("stopping", { signal });
  server.close();

  const remaining = await waitForVoiceDrain();
  if (remaining > 0) {
    serverLog.warn("shutdown: voice turns abandoned", { remaining });
  } else {
    serverLog.log("shutdown: clean");
  }
  process.exit(0);
}

process.on("SIGTERM", () => { gracefulShutdown("SIGTERM").catch(() => process.exit(1)); });
process.on("SIGINT",  () => { gracefulShutdown("SIGINT").catch(() => process.exit(1)); });
