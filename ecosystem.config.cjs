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
  ],
};
