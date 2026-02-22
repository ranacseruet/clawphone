/**
 * OpenClaw plugin entry point.
 *
 * Registers the Twilio gateway as a background service. OpenClaw starts it
 * on `openclaw plugins enable twilio-phone-gateway` and stops it on disable.
 *
 * Standalone / PM2 path: server.mjs (untouched by this file).
 */
import { createServer } from "./lib/http-server.mjs";
import { fromPluginConfig } from "./lib/config.mjs";

export default {
  id: "twilio-phone-gateway",
  name: "Twilio Phone Gateway",

  register(api) {
    api.registerService({
      id: "twilio-phone-gateway",
      name: "twilio-phone-gateway",
      start: async (pluginConfig) => {
        const server = await createServer(fromPluginConfig(pluginConfig), api);
        return {
          stop: () => new Promise((resolve, reject) =>
            server.close((err) => err ? reject(err) : resolve())
          ),
        };
      },
    });
  },
};
