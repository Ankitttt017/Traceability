const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const bcrypt = require("bcrypt");

const User = sequelize.define("User", {
  full_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM("Admin", "Engineer", "Supervisor", "Operator", "Other"),
    defaultValue: "Operator",
  },
  access_role: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  plant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  employee_code: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  phone_number: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  profile_image_url: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  page_access_overrides: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
    defaultValue: "ACTIVE",
  },
});

async function hashPassword(user) {
  if (!user.changed("password")) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(user.password, salt);
}

User.beforeCreate(hashPassword);
User.beforeUpdate(hashPassword);

module.exports = User;
