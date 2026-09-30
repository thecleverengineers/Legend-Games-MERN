import jwt from "jsonwebtoken";
import { User } from "../models/index.js";
import { AppError, asyncHandler } from "../lib/http.js";

const cookieName = "legend_session";

export const issueToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d", issuer: "legend-casino" });

export const setSession = (res, token) => {
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

export const clearSession = (res) => res.clearCookie(cookieName, { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true" });

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = req.cookies[cookieName] || bearer;
  if (!token) throw new AppError("Authentication is required", 401, "UNAUTHENTICATED");
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: "legend-casino" });
  } catch {
    throw new AppError("Your session has expired", 401, "UNAUTHENTICATED");
  }
  const user = await User.findById(payload.sub);
  if (!user || user.status !== "active") throw new AppError("This account is unavailable", 403, "ACCOUNT_UNAVAILABLE");
  req.user = user;
  next();
});

export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(new AppError("You do not have access to this area", 403, "FORBIDDEN"));
  return next();
};
