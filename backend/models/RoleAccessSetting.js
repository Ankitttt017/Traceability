const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ACCESS_ENUM = ["HIDDEN", "VIEW", "VIEW_EDIT", "VIEW_CONTROL"];

const accessColumn = (defaultValue = "VIEW") => ({
  type: DataTypes.ENUM(...ACCESS_ENUM),
  allowNull: true,
  defaultValue,
});

const RoleAccessSetting = sequelize.define("RoleAccessSetting", {
  module_key: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  super_admin_access: accessColumn("VIEW_CONTROL"),
  company_admin_access: accessColumn("VIEW_EDIT"),
  plant_admin_access: accessColumn("VIEW_EDIT"),
  production_manager_access: accessColumn("VIEW"),
  quality_manager_access: accessColumn("VIEW"),
  maintenance_access: accessColumn("VIEW"),
  engineer_access: accessColumn("VIEW"),
  supervisor_access: accessColumn("VIEW"),
  operator_access: accessColumn("HIDDEN"),
  auditor_access: accessColumn("VIEW"),
  viewer_access: accessColumn("VIEW"),
  admin_access: {
    type: DataTypes.ENUM(...ACCESS_ENUM),
    allowNull: true,
    defaultValue: "VIEW_EDIT",
  },
  other_access: {
    type: DataTypes.ENUM(...ACCESS_ENUM),
    allowNull: true,
    defaultValue: "HIDDEN",
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
});

module.exports = RoleAccessSetting;
