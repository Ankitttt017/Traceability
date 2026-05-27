class BaseController {
  constructor(service) {
    this.service = service;
  }

  // Wrapper for async route handlers to pass errors to the centralized error handler
  catchAsync(fn) {
    return (req, res, next) => {
      fn(req, res, next).catch(next);
    };
  }

  sendResponse(res, statusCode, data) {
    res.status(statusCode).json(data);
  }

  sendError(res, statusCode, message) {
    res.status(statusCode).json({ error: message });
  }
}

module.exports = BaseController;
