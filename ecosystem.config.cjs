module.exports = {
  apps: [
    {
      name: "rico-iot-backend",
      cwd: "./backend",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};
