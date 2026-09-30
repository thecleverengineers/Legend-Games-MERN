export const AppError = class AppError extends Error {
  constructor(message, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
};

export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export const notFound = (_req, _res, next) => next(new AppError("Route not found", 404, "NOT_FOUND"));

export const errorHandler = (error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    ok: false,
    error: { code: error.code || "INTERNAL_ERROR", message: status >= 500 ? "Unexpected server error" : error.message },
  });
};
