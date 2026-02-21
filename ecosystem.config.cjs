module.exports = {
  apps: [
    {
      name: 'twilio-phone-gateway',
      script: './server.mjs',
      cwd: '/path/to/twilio-phone-gateway',
      env: {
        PORT: 8787,
        ALLOW_FROM: '+15550001111,+15550002222',
        DISCORD_LOG_CHANNEL_ID: 'DISCORD_CHANNEL_ID_PLACEHOLDER',
        OPENCLAW_PHONE_SESSION_ID: 'phone-rana',
        NODE_ENV: 'production'
      },
      // Load additional env vars from .env file
      env_file: '/path/to/twilio-phone-gateway/.env',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      log_file: '/path/to/twilio-phone-gateway/logs/combined.log',
      out_file: '/path/to/twilio-phone-gateway/logs/out.log',
      error_file: '/path/to/twilio-phone-gateway/logs/error.log',
      time: true
    }
  ]
};
