import { findUserBySessionToken } from "./repositories.js";

export const SESSION_COOKIE = "vl_session";
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function setSessionCookie(response, token, expiresAt, secure) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS,
    expires: expiresAt,
    path: "/"
  });
}

export function clearSessionCookie(response) {
  response.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function requireSession(request, response, next) {
  const user = await findUserBySessionToken(request.cookies?.[SESSION_COOKIE]);

  if (!user) {
    clearSessionCookie(response);
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  request.user = user;
  next();
}
