const BaseController = require("./BaseController");
const userService = require("../services/UserService");

class UserController extends BaseController {
  constructor() {
    super(userService);
  }

  getUsers = this.catchAsync(async (req, res) => {
    const users = await this.service.getAllUsers();
    this.sendResponse(res, 200, users);
  });

  createUser = this.catchAsync(async (req, res) => {
    const user = await this.service.createUser(req.body);
    this.sendResponse(res, 201, user);
  });

  updateUser = this.catchAsync(async (req, res) => {
    const user = await this.service.updateUser(req.params.id, req.body);
    this.sendResponse(res, 200, user);
  });

  deleteUser = this.catchAsync(async (req, res) => {
    await this.service.deleteUser(req.params.id);
    res.status(204).send();
  });
}

// Export single instance of the controller
module.exports = new UserController();
