module.exports = {
  apps: [
    {
    name: "traceability-backend",
      cwd: "./backend",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};
