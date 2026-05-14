require("dotenv").config();
const sequelize = require("../config/db");
const User = require("../models/User");
const bcrypt = require("bcrypt");

async function diagnosticCheck() {
  try {
    await sequelize.authenticate();
    console.log("✓ Database connection successful!");
    console.log(`\nDatabase: Tracebility`);
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`User: ${process.env.DB_USER}`);
    
    // Check all users
    const allUsers = await User.findAll({ raw: true, attributes: { exclude: ['password'] } });
    console.log("\n=== All Users in Database ===");
    if (allUsers.length === 0) {
      console.log("No users found!");
    } else {
      allUsers.forEach(user => {
        console.log(`- ID: ${user.id}, Username: ${user.username}, Role: ${user.role}, Status: ${user.status}`);
      });
    }

    // Check admin user specifically
    const adminUser = await User.findOne({ where: { username: "admin" }, raw: true });
    if (adminUser) {
      console.log("\n=== Admin User Details ===");
      console.log(`Username: ${adminUser.username}`);
      console.log(`Role: ${adminUser.role}`);
      console.log(`Status: ${adminUser.status}`);
      
      // Test password
      const testPassword = "admin@123";
      const isValidPassword = await bcrypt.compare(testPassword, adminUser.password);
      console.log(`\nPassword Test (admin@123): ${isValidPassword ? "✓ VALID" : "✗ INVALID"}`);
      
      if (!isValidPassword) {
        const oldPassword = "admin123";
        const isOldValid = await bcrypt.compare(oldPassword, adminUser.password);
        console.log(`Password Test (admin123): ${isOldValid ? "⚠ OLD PASSWORD STILL WORKS" : "✗ Neither password works"}`);
      }
    } else {
      console.log("\n✗ Admin user NOT found in database!");
    }

    await sequelize.close();
  } catch (error) {
    console.error("✗ Error:", error.message);
    process.exit(1);
  }
}

diagnosticCheck();
