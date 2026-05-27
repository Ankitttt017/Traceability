const BaseController = require("./BaseController");
const authService = require("../services/AuthService");

class AuthController extends BaseController {
  constructor() {
    super(authService);
  }

  register = this.catchAsync(async (req, res) => {
    const result = await this.service.register(req.body);
    this.sendResponse(res, 201, result);
  });

  login = this.catchAsync(async (req, res) => {
    const result = await this.service.login(req.body);
    this.sendResponse(res, 200, result);
  });
}

module.exports = new AuthController();
