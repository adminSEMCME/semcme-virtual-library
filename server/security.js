import crypto from "crypto";
import { config } from "./config.js";

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return crypto
    .createHmac("sha256", config.sessionSecret || "development-session-secret")
    .update(String(token || ""))
    .digest("hex");
}
