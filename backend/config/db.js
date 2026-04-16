const { Sequelize } = require("sequelize");

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

if (instanceName) {
  dialectOptions.instanceName = instanceName;
}

const sequelizeConfig = {
  host: resolvedHost,
  dialect: "mssql",
  dialectOptions: {
    options: dialectOptions,
  },
  logging: false,
};

if (!instanceName) {
  sequelizeConfig.port = hasExplicitPort ? parsedPort : 1433;
}

const sequelize = isTest
  ? new Sequelize("sqlite::memory:", { logging: false })
  : new Sequelize(
      process.env.DB_NAME || "Tracebility",
      process.env.DB_USER || "sa",
      process.env.DB_PASS || "",
      sequelizeConfig
    );

module.exports = sequelize;
