const { join } = require('path');

module.exports = {
  apps: [
    {
      name: 'twilio-phone-gateway',
      script: './server.mjs',
      cwd: __dirname,
      env: {
        PORT: 8787,
        NODE_ENV: 'production'
      },
      // All other config (ALLOW_FROM, DISCORD_LOG_CHANNEL_ID, Twilio creds, etc.)
      // is loaded from .env — see .env.example for the full reference.
      env_file: join(__dirname, '.env'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      log_file: join(__dirname, 'logs/combined.log'),
      out_file: join(__dirname, 'logs/out.log'),
      error_file: join(__dirname, 'logs/error.log'),
      time: true
    }
  ]
};
