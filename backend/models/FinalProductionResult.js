const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FinalProductionResult = sequelize.define("FinalProductionResult", {
  report_group_key: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  traceability_part_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  part_serial_no: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  customer_qr_code: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  shot_number: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  first_scan_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  final_result_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  last_activity_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  production_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  shift_code: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  final_status: {
    type: DataTypes.STRING(40),
    allowNull: false,
    defaultValue: "IN_PROGRESS",
  },
  part_status: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  plant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  line_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  line_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  anchor_machine_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  anchor_machine_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  die_casting_machine_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  part_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  die_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  ng_station: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  ng_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  rejection_category: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  rejection_view: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  rejection_zone: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  rejection_sub_zone: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  rejection_reason: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  op100_status: DataTypes.STRING(40),
  op110_status: DataTypes.STRING(40),
  op120_status: DataTypes.STRING(40),
  op130_status: DataTypes.STRING(40),
  op140_status: DataTypes.STRING(40),
  op150_status: DataTypes.STRING(40),
  op160_status: DataTypes.STRING(40),
  station_results_json: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  leak_test_json: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  shot_details_json: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  plc_shot_json: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  rejection_json: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  report_rows_json: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, {
  tableName: "FinalProductionResults",
  indexes: [
    { fields: ["report_group_key"], unique: true },
    { fields: ["first_scan_at"] },
    { fields: ["final_result_at"] },
    { fields: ["last_activity_at"] },
    { fields: ["production_date"] },
    { fields: ["final_status"] },
    { fields: ["part_serial_no"] },
    { fields: ["customer_qr_code"] },
    { fields: ["shot_number"] },
    { fields: ["shift_code"] },
  ],
});

module.exports = FinalProductionResult;
