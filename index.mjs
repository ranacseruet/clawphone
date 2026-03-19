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
import { waitForVoiceDrain } from "./lib/voice-state.mjs";

export default {
  id: "clawphone",
  name: "Twilio Phone Gateway",

  register(api) {
    let server = null;

    api.registerService({
      id: "clawphone",
      name: "clawphone",
      // OpenClaw service start/stop receive lifecycle context, while the
      // validated plugin config is exposed on the registration API object.
      start: async () => {
        server = await createServer(fromPluginConfig(api.pluginConfig ?? {}), api);
      },
      stop: async () => {
        if (!server) return;
        const activeServer = server;
        server = null;
        await new Promise((resolve, reject) =>
          activeServer.close((err) => (err ? reject(err) : resolve(undefined)))
        );
        await waitForVoiceDrain();
      },
    });
  },
};
