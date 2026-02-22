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

export const server = await createServer(envConfig);
