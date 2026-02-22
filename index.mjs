// @ts-check
/**
 * OpenClaw plugin entry point.
 *
 * Registers the Twilio gateway as a background service. OpenClaw starts it
 * on `openclaw plugins enable clawphone` and stops it on disable.
 *
 * Standalone / PM2 path: server.mjs (untouched by this file).
 */
import { createServer } from "./lib/http-server.mjs";
import { fromPluginConfig } from "./lib/config.mjs";

export default {
  id: "clawphone",
  name: "Twilio Phone Gateway",

  register(api) {
    api.registerService({
      id: "clawphone",
      name: "clawphone",
      start: async (pluginConfig) => {
        const server = await createServer(fromPluginConfig(pluginConfig), api);
        return {
          stop: () => new Promise((resolve, reject) =>
            server.close((err) => err ? reject(err) : resolve(undefined))
          ),
        };
      },
    });
  },
};
