require("dotenv").config();
const sequelize = require("../config/db");
const User = require("../models/User");

async function resetAdminUser() {
  try {
    await sequelize.authenticate();
    console.log("Database connection established.");

    // Delete existing admin user
    const deleted = await User.destroy({ where: { username: "admin" } });
    console.log(`Deleted ${deleted} existing admin user(s).`);

    // Create new admin user with updated password
    const newUser = await User.create({
      username: "admin",
      password: "admin@123",
      role: "Admin",
      status: "ACTIVE",
    });

    console.log(`✓ Admin user created successfully!`);
    console.log(`  Username: admin`);
    console.log(`  Password: admin@123`);
    console.log(`  Role: Admin`);

    await sequelize.close();
  } catch (error) {
    console.error("Error resetting admin user:", error.message);
    process.exit(1);
  }
}

resetAdminUser();
