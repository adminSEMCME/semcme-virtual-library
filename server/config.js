import dotenv from "dotenv";

dotenv.config();

const isLocalPreview =
  process.env.NODE_ENV !== "production" &&
  !process.env.VIRTUAL_LIBRARY_DATABASE_URL &&
  !process.env.SBS_DATABASE_URL;

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  appBaseUrl:
    process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  databaseUrl:
    process.env.VIRTUAL_LIBRARY_DATABASE_URL ||
    process.env.SBS_DATABASE_URL ||
    (isLocalPreview
      ? "postgres://local:local@localhost:5432/local"
      : undefined),
  sessionSecret:
    process.env.VIRTUAL_LIBRARY_SESSION_SECRET ||
    process.env.SBS_SESSION_SECRET ||
    "local-dev-session-secret",
  adminUsername:
    process.env.GLOBAL_ADMIN_USERNAME ||
    process.env.ADMIN_USERNAME ||
    "",
  adminPassword:
    process.env.GLOBAL_ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    "",
  trustProxy: process.env.TRUST_PROXY === "true",
  libraryCacheMinutes: Number(
    process.env.VIRTUAL_LIBRARY_CACHE_MINUTES || 10,
  ),
  registrationUrl:
    process.env.VIRTUAL_LIBRARY_REGISTRATION_URL ||
    "https://semcme.org/semcme-virtual-library/",
  constantContact: {
    clientId: process.env.CONSTANT_CONTACT_CLIENT_ID,
    clientSecret: process.env.CONSTANT_CONTACT_CLIENT_SECRET,
    accessToken: process.env.CONSTANT_CONTACT_ACCESS_TOKEN,
    refreshToken: process.env.CONSTANT_CONTACT_REFRESH_TOKEN,
    eventId: process.env.CONSTANT_CONTACT_VIRTUAL_LIBRARY_EVENT_ID,
    trackKey: process.env.CONSTANT_CONTACT_VIRTUAL_LIBRARY_TRACK_KEY,
    registrationRecheckMinutes: Number(
      process.env.CONSTANT_CONTACT_REGISTRATION_RECHECK_MINUTES || 60,
    ),
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from:
      process.env.SMTP_FROM || "SEMCME Virtual Library <no-reply@semcme.org>",
  },
  cookieSecure:
    process.env.COOKIE_SECURE === "true" ||
    process.env.NODE_ENV === "production",
};

export function requireConfig(keys) {
  const missing = keys.filter((key) => {
    const value = key
      .split(".")
      .reduce((current, part) => current?.[part], config);
    return !value;
  });

  if (missing.length && !isLocalPreview) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
}
