
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ProductionReport = sequelize.define(
  "ProductionReport",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    part_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    customer_qr: {
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
    machine_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    shift_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    overall_status: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    first_scan_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    final_scan_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    ng_reason: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    rejection_category: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    rejection_reason: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    cycle_time: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    station_keys: {
      type: DataTypes.STRING(1000), // Comma-separated list of machines/stations this part went through
      allowNull: true,
    },
    station_data: {
      type: DataTypes.TEXT, // Store as JSON string since SQL Server lacks native JSON in older dialects for Sequelize
      allowNull: true,
      get() {
        const rawValue = this.getDataValue('station_data');
        return rawValue ? JSON.parse(rawValue) : {};
      },
      set(value) {
        this.setDataValue('station_data', value ? JSON.stringify(value) : null);
      }
    },
    plc_data: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const rawValue = this.getDataValue('plc_data');
        return rawValue ? JSON.parse(rawValue) : {};
      },
      set(value) {
        this.setDataValue('plc_data', value ? JSON.stringify(value) : null);
      }
    },
    leak_data: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const rawValue = this.getDataValue('leak_data');
        return rawValue ? JSON.parse(rawValue) : {};
      },
      set(value) {
        this.setDataValue('leak_data', value ? JSON.stringify(value) : null);
      }
    },
    raw_logs: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    station_keys: {
      type: DataTypes.STRING(1000),
      allowNull: true,
    },
    op100_status: { type: DataTypes.STRING(50), allowNull: true },
    op110_status: { type: DataTypes.STRING(50), allowNull: true },
    op120_status: { type: DataTypes.STRING(50), allowNull: true },
    op130_status: { type: DataTypes.STRING(50), allowNull: true },
    op140_status: { type: DataTypes.STRING(50), allowNull: true },
    op150_status: { type: DataTypes.STRING(50), allowNull: true },
    op160_status: { type: DataTypes.STRING(50), allowNull: true },
    shot_number: { type: DataTypes.STRING(255), allowNull: true },
    plc_cycle_time: { type: DataTypes.FLOAT, allowNull: true },
    die_close_core_in_time: { type: DataTypes.FLOAT, allowNull: true },
    pouring_time: { type: DataTypes.FLOAT, allowNull: true },
    shot_fwd_time: { type: DataTypes.FLOAT, allowNull: true },
    curing_time: { type: DataTypes.FLOAT, allowNull: true },
    die_open_core_out_time: { type: DataTypes.FLOAT, allowNull: true },
    ejector_time: { type: DataTypes.FLOAT, allowNull: true },
    extract_time: { type: DataTypes.FLOAT, allowNull: true },
    spray_time: { type: DataTypes.FLOAT, allowNull: true },
    v1_speed: { type: DataTypes.FLOAT, allowNull: true },
    v2_speed: { type: DataTypes.FLOAT, allowNull: true },
    v3_speed: { type: DataTypes.FLOAT, allowNull: true },
    v4_speed: { type: DataTypes.FLOAT, allowNull: true },
    metal_pressure: { type: DataTypes.FLOAT, allowNull: true },
    furnace_metal_temp: { type: DataTypes.FLOAT, allowNull: true },
    cooling_water_mov: { type: DataTypes.FLOAT, allowNull: true },
    cooling_water_sta: { type: DataTypes.FLOAT, allowNull: true },
    accel_point: { type: DataTypes.FLOAT, allowNull: true },
    deaccel_point: { type: DataTypes.FLOAT, allowNull: true },
    intensification_time: { type: DataTypes.FLOAT, allowNull: true },
    biscuit_thickness: { type: DataTypes.FLOAT, allowNull: true },
    jet_cooling_pressure: { type: DataTypes.FLOAT, allowNull: true },
    clamp_tonnage_he_low_pct: { type: DataTypes.FLOAT, allowNull: true },
    clamp_tonnage_he_low_mn: { type: DataTypes.FLOAT, allowNull: true },
    clamp_tonnage_op_up_pct: { type: DataTypes.FLOAT, allowNull: true },
    clamp_tonnage_op_low_pct: { type: DataTypes.FLOAT, allowNull: true },
    clamp_tonnage_he_up_pct: { type: DataTypes.FLOAT, allowNull: true },
    vacuum_pressure: { type: DataTypes.FLOAT, allowNull: true },
    clamp_force_pct: { type: DataTypes.FLOAT, allowNull: true },
    clamp_tonnage: { type: DataTypes.FLOAT, allowNull: true },
    shot_acc_pressure: { type: DataTypes.FLOAT, allowNull: true },
    intensification_acc_pressure: { type: DataTypes.FLOAT, allowNull: true },
    fixed_die_temp_f1: { type: DataTypes.FLOAT, allowNull: true },
    fixed_die_temp_f2: { type: DataTypes.FLOAT, allowNull: true },
    moving_die_temp_m1: { type: DataTypes.FLOAT, allowNull: true },
    moving_die_temp_m2: { type: DataTypes.FLOAT, allowNull: true },
    slide_temp_s1: { type: DataTypes.FLOAT, allowNull: true },
    fix_1_flow: { type: DataTypes.FLOAT, allowNull: true },
    fix_2_flow: { type: DataTypes.FLOAT, allowNull: true },
    fix_3_flow: { type: DataTypes.FLOAT, allowNull: true },
    mov_1_flow: { type: DataTypes.FLOAT, allowNull: true },
    mov_2_flow: { type: DataTypes.FLOAT, allowNull: true },
    mov_3_flow: { type: DataTypes.FLOAT, allowNull: true },
    vacuum_pressure_mmhg: { type: DataTypes.FLOAT, allowNull: true },
    average_die_clamp_tonnage_count: { type: DataTypes.FLOAT, allowNull: true },
    time_for_stroke: { type: DataTypes.FLOAT, allowNull: true },
    stroke: { type: DataTypes.FLOAT, allowNull: true },
    shot_status: { type: DataTypes.STRING(255), allowNull: true },
    leak_body_leak_value: { type: DataTypes.FLOAT, allowNull: true },
    leak_gall_1: { type: DataTypes.FLOAT, allowNull: true },
    leak_gall_2: { type: DataTypes.FLOAT, allowNull: true },
    leak_cycle_time: { type: DataTypes.FLOAT, allowNull: true },
    leak_running_mode: { type: DataTypes.STRING(255), allowNull: true },
    leak_dry_wey_both: { type: DataTypes.STRING(255), allowNull: true }
  },
  {
    timestamps: true,
    indexes: [
      {
        unique: false,
        fields: ["part_id"],
      },
      {
        unique: false,
        fields: ["first_scan_at"],
      },
      {
        unique: false,
        fields: ["overall_status"],
      },
      {
        unique: false,
        fields: ["shift_code"],
      }
    ],
  }
);

module.exports = ProductionReport;
