module.exports = {
  apps: [
    {
      name: "ozon-api",
      script: "node_modules/.bin/next",
      args: "start -p 3006",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "ozon-sync-cron",
      script: "node_modules/.bin/tsx",
      args: "src/scripts/sync-orders-cron.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
