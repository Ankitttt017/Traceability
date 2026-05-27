const { Sequelize } = require("sequelize");

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  let errorResponse = {
    status: err.status,
    message: err.message,
    error: err.message // Keep 'error' field for backward compatibility with frontend
  };

  // Sequelize Unique Constraint Error
  if (err.name === "SequelizeUniqueConstraintError") {
    errorResponse.statusCode = 409;
    errorResponse.message = err.errors ? err.errors[0].message : "Unique constraint violated";
    errorResponse.error = errorResponse.message;
  }

  // Sequelize Validation Error
  if (err instanceof Sequelize.ValidationError) {
    errorResponse.statusCode = 400;
    errorResponse.error = "Validation failed";
    errorResponse.details = err.errors.map((entry) => entry.message);
  }

  if (process.env.NODE_ENV === "development") {
    errorResponse.stack = err.stack;
  }

  res.status(err.statusCode).json(errorResponse);
};

module.exports = {
  AppError,
  errorHandler,
};
