const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ScannerConnection = sequelize.define(
  "ScannerConnection",
  {
    scanner_ip: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM("CONNECTED", "DISCONNECTED"),
      allowNull: false,
      defaultValue: "DISCONNECTED",
    },
    connected_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_data_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "scanner_connections",
    timestamps: false,
  }
);

module.exports = ScannerConnection;
