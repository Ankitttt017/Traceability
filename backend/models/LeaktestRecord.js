const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const LeaktestRecord = sequelize.define("LeaktestRecord", {
  Id: { type: DataTypes.INTEGER, primaryKey: true },
  Machine: { type: DataTypes.STRING, allowNull: true },
  PLC_IP: { type: DataTypes.STRING, allowNull: true },
  Status: { type: DataTypes.STRING, allowNull: true },
  Cycle_End_Time: { type: DataTypes.DATE, allowNull: true },
  Part_QR_Code: { type: DataTypes.STRING, allowNull: true },
  Result: { type: DataTypes.STRING, allowNull: true },
  Body_Leak_Value: { type: DataTypes.STRING, allowNull: true },
  Gall_1: { type: DataTypes.STRING, allowNull: true },
  Gall_2: { type: DataTypes.STRING, allowNull: true },
  Cycle_Time: { type: DataTypes.STRING, allowNull: true },
  Running_Mode: { type: DataTypes.STRING, allowNull: true },
  Manual: { type: DataTypes.STRING, allowNull: true },
  Dry: { type: DataTypes.STRING, allowNull: true },
  Wey: { type: DataTypes.STRING, allowNull: true },
  Both: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: "Leaktest",
  freezeTableName: true,
  timestamps: false,
});

module.exports = LeaktestRecord;
