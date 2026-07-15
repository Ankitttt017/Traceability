const { Sequelize } = require("sequelize");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const isTest = process.env.NODE_ENV === "test";
const rawHost = process.env.DB_HOST || "localhost";
const [baseHost, hostInstanceName] = rawHost.split("\\");
const instanceName = process.env.DB_INSTANCE || hostInstanceName;
const resolvedHost = instanceName ? baseHost || "localhost" : rawHost;
const parsedPort = Number(process.env.DB_PORT);
const hasExplicitPort = Number.isFinite(parsedPort) && parsedPort > 0;

const dialectOptions = {
  encrypt: process.env.DB_ENCRYPT === "true",
  trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== "false",
  enableArithAbort: true,
};
const parsedRequestTimeout = Number(process.env.DB_REQUEST_TIMEOUT_MS);
if (Number.isFinite(parsedRequestTimeout) && parsedRequestTimeout > 0) {
  dialectOptions.requestTimeout = parsedRequestTimeout;
} else {
  dialectOptions.requestTimeout = 60000;
}
const parsedConnectTimeout = Number(process.env.DB_CONNECT_TIMEOUT_MS);
if (Number.isFinite(parsedConnectTimeout) && parsedConnectTimeout > 0) {
  dialectOptions.connectTimeout = parsedConnectTimeout;
} else {
  dialectOptions.connectTimeout = 60000;
}

if (instanceName) {
  dialectOptions.instanceName = instanceName;
}

const sequelizeConfig = {
  host: resolvedHost,
  dialect: "mssql",
  dialectOptions: {
    options: dialectOptions,
  },
  pool: {
    max: Number(process.env.DB_POOL_MAX || 20),
    min: Number(process.env.DB_POOL_MIN || 2),
    acquire: Number(process.env.DB_POOL_ACQUIRE_MS || 60000),
    idle: Number(process.env.DB_POOL_IDLE_MS || 10000),
    evict: Number(process.env.DB_POOL_EVICT_MS || 10000),
  },
  retry: {
    max: Number(process.env.DB_RETRY_MAX || 2),
    match: [
      /ECONNRESET/i,
      /ESOCKET/i,
      /ETIMEOUT/i,
      /ConnectionError/i,
      /SequelizeConnectionError/i,
      /Requests can only be made in the LoggedIn state/i,
    ],
  },
  logging: false,
};

if (!instanceName) {
  sequelizeConfig.port = hasExplicitPort ? parsedPort : 1433;
}

const sequelize = isTest
  ? new Sequelize({ dialect: "sqlite", storage: ":memory:", logging: false })
  : new Sequelize(
      process.env.DB_NAME || "Tracebility",
      process.env.DB_USER || "sa",
      process.env.DB_PASS || "",
      sequelizeConfig
    );

module.exports = sequelize;
