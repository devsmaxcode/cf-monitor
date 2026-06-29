const appPort = process.env.PORT || process.env.APP_PORT || '3033'
const appHost = process.env.HOST || process.env.APP_HOST || '127.0.0.1'

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'cf-cache-monitor',
      cwd: __dirname,
      script: 'scripts/start-server.mjs',
      interpreter: process.env.BUN_BIN || 'bun',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        APP_ROOT: process.env.APP_ROOT || __dirname,
        NODE_ENV: 'production',
        HOST: appHost,
        PORT: appPort,
      },
    },
  ],
}
