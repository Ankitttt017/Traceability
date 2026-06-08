const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ACCESS_ENUM = ["HIDDEN", "VIEW", "VIEW_EDIT", "VIEW_CONTROL"];

const RoleAccessSetting = sequelize.define("RoleAccessSetting", {
  module_key: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  admin_access: {
    type: DataTypes.ENUM(...ACCESS_ENUM),
    allowNull: false,
    defaultValue: "VIEW_EDIT",
  },
  engineer_access: {
    type: DataTypes.ENUM(...ACCESS_ENUM),
    allowNull: false,
    defaultValue: "VIEW",
  },
  supervisor_access: {
    type: DataTypes.ENUM(...ACCESS_ENUM),
    allowNull: false,
    defaultValue: "VIEW",
  },
  operator_access: {
    type: DataTypes.ENUM(...ACCESS_ENUM),
    allowNull: false,
    defaultValue: "HIDDEN",
  },
  other_access: {
    type: DataTypes.ENUM(...ACCESS_ENUM),
    allowNull: false,
    defaultValue: "HIDDEN",
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
});

module.exports = RoleAccessSetting;
