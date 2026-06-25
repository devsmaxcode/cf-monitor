module.exports = {
  apps: [
    {
      name: "cf-cache-monitor",
      script: "./src/server.ts",
      interpreter: "bun",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "3033",
      },
    },
  ],
};
