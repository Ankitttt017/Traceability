require('dotenv').config();
const User = require('./models/User');
(async () => {
  try {
    const users = await User.findAll();
    console.log(users.map(u => ({ username: u.username, password: u.password, role: u.role })));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
