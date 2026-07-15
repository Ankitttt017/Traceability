const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const isTest = process.env.NODE_ENV === "test";

function buildMssqlConfig() {
  const rawHost = process.env.DB_HOST || "localhost";
  const [baseHost, hostInstanceName] = rawHost.split("\\");
  const instanceName = process.env.DB_INSTANCE || hostInstanceName;
  const resolvedHost = instanceName ? baseHost || "localhost" : rawHost;
  const parsedPort = Number(process.env.DB_PORT);
  const hasExplicitPort = Number.isFinite(parsedPort) && parsedPort > 0;

  const options = {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== "false",
    enableArithAbort: true,
    requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 60000),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 60000),
  };

  if (instanceName) {
    options.instanceName = instanceName;
  }

  const config = {
    username: process.env.DB_USER || "sa",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "Tracebility",
    host: resolvedHost,
    dialect: "mssql",
    dialectOptions: { options },
    pool: {
      max: Number(process.env.DB_POOL_MAX || 20),
      min: Number(process.env.DB_POOL_MIN || 2),
      acquire: Number(process.env.DB_POOL_ACQUIRE_MS || 60000),
      idle: Number(process.env.DB_POOL_IDLE_MS || 10000),
    },
    logging: false,
  };

  if (!instanceName) {
    config.port = hasExplicitPort ? parsedPort : 1433;
  }

  return config;
}

const mssqlConfig = buildMssqlConfig();

module.exports = {
  development: isTest
    ? { dialect: "sqlite", storage: ":memory:", logging: false }
    : mssqlConfig,
  test: { dialect: "sqlite", storage: ":memory:", logging: false },
  production: mssqlConfig,
};
