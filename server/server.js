import express from "express";
import cookieParser from "cookie-parser";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { config } from "./config.js";
import { query } from "./db.js";
import {
  clearSessionCookie,
  requireSession,
  SESSION_COOKIE,
  setSessionCookie,
} from "./auth.js";
import {
  findVirtualLibraryRegistrationByEmail,
  ConstantContactError,
  listVirtualLibraryRegistrations,
  saveConstantContactTokens,
  withVirtualLibraryRegistrationDetails,
} from "./constantContact.js";
import { sendMagicLinkEmail } from "./mailer.js";
import {
  clearLibraryCache,
  getOriginalLibrary,
  getVirtualLibrary,
} from "./library.js";
import {
  consumeMagicLink,
  createMagicLink,
  createSession,
  deleteLibraryItem,
  deleteLibrarySection,
  findUserByEmail,
  getLibraryContent,
  listUsers,
  revokeSession,
  replaceLibraryContent,
  saveLibraryItem,
  saveLibrarySection,
  updateUserRegistrationStatus,
  upsertUserFromRegistration,
} from "./repositories.js";
import { isValidEmail, normalizeEmail, randomToken } from "./security.js";
import { rateLimit } from "./rateLimit.js";
import { applySchema } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const app = express();
const ADMIN_COOKIE = "vl_admin";
const CC_OAUTH_STATE_COOKIE = "vl_cc_oauth_state";
const CC_AUTHORIZE_URL = "https://authz.constantcontact.com/oauth2/default/v1/authorize";
const CC_TOKEN_URL = "https://authz.constantcontact.com/oauth2/default/v1/token";
const CC_OAUTH_SCOPES = ["account_read", "contact_data", "campaign_data", "offline_access"];

let schemaReady = false;
let schemaError = null;
async function ensureSchema() {
  if (schemaReady) return;
  if (!config.databaseUrl) {
    throw Object.assign(new Error("Virtual Library database URL is not configured."), { status: 503 });
  }
  try {
    await applySchema();
    schemaReady = true;
    schemaError = null;
  } catch (error) {
    schemaError = error;
    throw error;
  }
}

app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", 1);

app.use((request, response, next) => {
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-src https://www.youtube.com https://player.vimeo.com https://*.zoom.us",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  if (config.nodeEnv === "production") {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  next();
});

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(
  "/assets",
  express.static(path.join(rootDir, "assets"), { maxAge: "1h" }),
);
app.get("/styles.css", (request, response) =>
  response.sendFile(path.join(rootDir, "styles.css")),
);
app.get("/app.js", (request, response) =>
  response.sendFile(path.join(rootDir, "app.js")),
);
app.get("/admin.js", (request, response) =>
  response.sendFile(path.join(rootDir, "admin.js")),
);
app.get("/admin.css", (request, response) =>
  response.sendFile(path.join(rootDir, "admin.css")),
);

function signAdminValue(value) {
  return createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
}

function createAdminCookieValue() {
  const issuedAt = String(Date.now());
  return `${issuedAt}.${signAdminValue(issuedAt)}`;
}

function isAdminCookieValid(value) {
  const [issuedAt, signature] = String(value || "").split(".");
  if (!issuedAt || !signature) return false;
  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;
  const expected = signAdminValue(issuedAt);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function setAdminCookie(response) {
  response.cookie(ADMIN_COOKIE, createAdminCookieValue(), {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/"
  });
}

function clearAdminCookie(response) {
  response.clearCookie(ADMIN_COOKIE, { path: "/" });
}

function clearOAuthStateCookie(response) {
  response.clearCookie(CC_OAUTH_STATE_COOKIE, { path: "/" });
}

function createSignedValue(value) {
  return `${value}.${signAdminValue(value)}`;
}

function verifySignedValue(value) {
  const [raw, signature] = String(value || "").split(".");
  if (!raw || !signature) return "";
  const expected = signAdminValue(raw);
  if (signature.length !== expected.length) return "";
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return "";
  return raw;
}

function requireAdmin(request, response, next) {
  if (isAdminCookieValid(request.cookies?.[ADMIN_COOKIE])) {
    next();
    return;
  }

  clearAdminCookie(response);
  response.status(401).json({ error: "Admin login required." });
}

function constantContactRedirectUri() {
  return `${config.appBaseUrl.replace(/\/$/, "")}/api/admin/constant-contact/callback`;
}

function constantContactAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: config.constantContact.clientId || "",
    response_type: "code",
    redirect_uri: constantContactRedirectUri(),
    scope: CC_OAUTH_SCOPES.join(" "),
    state,
  });
  return `${CC_AUTHORIZE_URL}?${params}`;
}

async function exchangeConstantContactAuthorizationCode(code) {
  if (!config.constantContact.clientId || !config.constantContact.clientSecret) {
    throw Object.assign(new Error("Constant Contact client credentials are not configured."), { status: 503 });
  }

  const credentials = Buffer.from(
    `${config.constantContact.clientId}:${config.constantContact.clientSecret}`,
  ).toString("base64");
  const response = await fetch(CC_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: constantContactRedirectUri(),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error_description || data.error || "";
    throw new Error(`Constant Contact authorization failed ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  await saveConstantContactTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  });
}

function constantContactFailureRedirect(reason = "unknown") {
  return `/admin?cc=failed&reason=${encodeURIComponent(String(reason).slice(0, 240))}`;
}

function isSameOriginRequest(request) {
  const origin = request.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(config.appBaseUrl).origin;
  } catch {
    return false;
  }
}

app.use((request, response, next) => {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
    isSameOriginRequest(request)
  ) {
    next();
    return;
  }

  response.status(403).json({ error: "Forbidden." });
});

async function requireDatabase(request, response, next) {
  try {
    await ensureSchema();
    next();
  } catch (error) {
    next(error);
  }
}

function publicUser(user) {
  return {
    email: user.email,
    name: user.full_name || user.email,
  };
}

function publicRoleTitle(value) {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase().startsWith("summary for registration id:")) return "";
  return text;
}

function publicAdminUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.full_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email,
    memberInstitution: user.member_institution || user.organization || "",
    organization: user.organization || "",
    degree: user.degree || "",
    roleTitle: publicRoleTitle(user.role_title),
    specialty: user.specialty || "",
    registrationStatus: user.registration_status || "",
    registeredAt: user.registered_at || "",
    syncedAt: user.synced_at || "",
    lastLoginAt: user.last_login_at || "",
    createdAt: user.created_at || "",
  };
}

function shouldRecheckRegistration(user) {
  if (!config.constantContact.registrationRecheckMinutes) return false;
  if (!user.synced_at) return true;

  const syncedAt = new Date(user.synced_at).getTime();
  if (Number.isNaN(syncedAt)) return true;

  return (
    Date.now() - syncedAt >
    config.constantContact.registrationRecheckMinutes * 60 * 1000
  );
}

function userHasProfileDetails(user) {
  return Boolean(user?.member_institution && user?.degree && user?.role_title);
}

async function resolveRegisteredUser(email) {
  const existing = await findUserByEmail(email);
  if (existing && userHasProfileDetails(existing)) return existing;

  const registration = await findVirtualLibraryRegistrationByEmail(email);
  if (!registration) return existing || null;

  return upsertUserFromRegistration(await withVirtualLibraryRegistrationDetails(registration));
}

async function requireCurrentRegistration(request, response, next) {
  try {
    if (!shouldRecheckRegistration(request.user)) {
      next();
      return;
    }

    const registration = await findVirtualLibraryRegistrationByEmail(
      request.user.email,
    );
    if (!registration) {
      await updateUserRegistrationStatus(request.user.email, "NOT_REGISTERED");
      await revokeSession(request.cookies?.[SESSION_COOKIE]);
      clearSessionCookie(response);
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.user = await upsertUserFromRegistration(
      await withVirtualLibraryRegistrationDetails(registration),
    );
    next();
  } catch (error) {
    next(error);
  }
}

app.get("/api/health", async (request, response) => {
  try {
    await ensureSchema();
    await query("SELECT 1");
    response.json({
      ok: true,
      service: "semcme-virtual-library",
      environment: config.nodeEnv,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      service: "semcme-virtual-library",
      error: error.message,
    });
  }
});

app.get("/api/public-settings", (request, response) => {
  response.json({
    registrationUrl: config.registrationUrl,
  });
});

app.post(
  "/api/request-magic-link",
  requireDatabase,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: "vl-magic-link" }),
  async (request, response, next) => {
    try {
      const email = normalizeEmail(request.body?.email);

      if (!isValidEmail(email)) {
        response.status(400).json({ error: "Enter a valid email address." });
        return;
      }

      const user = await resolveRegisteredUser(email);
      if (!user) {
        response.status(403).json({
          error: "This email is not registered for the SEMCME Virtual Library.",
          registrationUrl: config.registrationUrl,
        });
        return;
      }

      const { token } = await createMagicLink(user.id, request);
      const magicLink = `${config.appBaseUrl.replace(/\/$/, "")}/?token=${encodeURIComponent(token)}`;
      await sendMagicLinkEmail({ to: user.email, magicLink });

      response.json({
        message:
          "Check your email for a secure Sign-In Link. Please allow up to 3 minutes for the Sign-In Link to arrive before requesting another one.",
      });
    } catch (error) {
      if (error instanceof ConstantContactError) {
        console.error("Virtual Library registration lookup failed:", error);
        response.status(error.status || 502).json({
          error:
            "Registration lookup is temporarily unavailable. Please try again in a few minutes.",
        });
        return;
      }

      next(error);
    }
  },
);

app.get("/api/verify-magic-link", requireDatabase, async (request, response, next) => {
  try {
    const token = String(request.query.token || "");
    const user = token ? await consumeMagicLink(token) : null;

    if (!user) {
      response
        .status(401)
        .json({ error: "This Sign-In Link is invalid or expired." });
      return;
    }

    const session = await createSession(user.id);
    setSessionCookie(
      response,
      session.token,
      session.expiresAt,
      config.cookieSecure,
    );
    response.json(publicUser(user));
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/me",
  requireDatabase,
  requireSession,
  requireCurrentRegistration,
  (request, response) => {
    response.json(publicUser(request.user));
  },
);

app.post("/api/logout", requireDatabase, async (request, response, next) => {
  try {
    await revokeSession(request.cookies?.[SESSION_COOKIE]);
    clearSessionCookie(response);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get(["/admin", "/admin/"], (request, response) => {
  response.sendFile(path.join(rootDir, "admin.html"));
});

app.post("/api/admin/login", requireDatabase, (request, response) => {
  const username = String(request.body?.username || "");
  const password = String(request.body?.password || "");
  if (!config.adminUsername || !config.adminPassword) {
    response.status(503).json({ error: "Admin login is not configured." });
    return;
  }
  if (username !== config.adminUsername || password !== config.adminPassword) {
    response.status(401).json({ error: "Invalid admin username or password." });
    return;
  }
  setAdminCookie(response);
  response.json({ ok: true });
});

app.post("/api/admin/logout", requireDatabase, (request, response) => {
  clearAdminCookie(response);
  response.json({ ok: true });
});

app.get("/api/admin/me", requireDatabase, requireAdmin, (request, response) => {
  response.json({ ok: true });
});

app.get("/api/admin/constant-contact/connect", requireDatabase, (request, response) => {
  if (!isAdminCookieValid(request.cookies?.[ADMIN_COOKIE])) {
    response.redirect("/admin");
    return;
  }
  if (!config.constantContact.clientId || !config.constantContact.clientSecret) {
    response.status(503).json({ error: "Constant Contact client credentials are not configured." });
    return;
  }

  const state = randomToken(16);
  response.cookie(CC_OAUTH_STATE_COOKIE, createSignedValue(state), {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
  response.redirect(constantContactAuthorizationUrl(state));
});

app.get("/api/admin/constant-contact/callback", requireDatabase, async (request, response) => {
  const expectedState = verifySignedValue(request.cookies?.[CC_OAUTH_STATE_COOKIE]);
  const returnedState = String(request.query?.state || "");
  const code = String(request.query?.code || "");
  clearOAuthStateCookie(response);

  if (!expectedState || returnedState !== expectedState || !code) {
    response.redirect(constantContactFailureRedirect("The Constant Contact response could not be verified. Please start the reconnect again from this admin page."));
    return;
  }

  try {
    await exchangeConstantContactAuthorizationCode(code);
    response.redirect("/admin?cc=connected");
  } catch (error) {
    console.error("Constant Contact authorization failed:", error);
    response.redirect(constantContactFailureRedirect(error.message || "Constant Contact authorization failed."));
  }
});

function publicAdminLibrary(sections) {
  return {
    sections: sections.map((section) => ({
      id: section.id,
      name: section.name,
      slug: section.slug,
      description: section.description || "",
      displayOrder: section.display_order,
      isVisible: section.is_visible,
      items: section.items.map((item) => ({
        id: item.id,
        sectionId: item.section_id,
        title: item.title,
        speaker: item.speaker || "",
        date: item.resource_date || "",
        url: item.url,
        itemType: item.item_type,
        displayOrder: item.display_order,
        isVisible: item.is_visible
      }))
    }))
  };
}

app.get("/api/admin/library", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    response.json(publicAdminLibrary(await getLibraryContent({ includeHidden: true })));
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/users", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const users = await listUsers();
    response.json({ users: users.map(publicAdminUser) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users/sync", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const registrations = await listVirtualLibraryRegistrations();
    const users = [];
    let institutionsFound = 0;
    let degreesFound = 0;
    let rolesFound = 0;
    for (const registration of registrations) {
      const detailedRegistration = await withVirtualLibraryRegistrationDetails(registration);
      users.push(await upsertUserFromRegistration(detailedRegistration));
      if (detailedRegistration.memberInstitution) institutionsFound += 1;
      if (detailedRegistration.degree) degreesFound += 1;
      if (detailedRegistration.roleTitle) rolesFound += 1;
    }
    response.json({
      synced: users.length,
      registrationsFound: registrations.recordsFound || registrations.length,
      institutionsFound,
      degreesFound,
      rolesFound,
      tracksChecked: registrations.tracksChecked || 1,
      users: (await listUsers()).map(publicAdminUser),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/library/import-source", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const current = getOriginalLibrary();
    await replaceLibraryContent(current);
    clearLibraryCache();
    response.json({
      ...publicAdminLibrary(await getLibraryContent({ includeHidden: true })),
      source: "original",
      importedItems: current.totalItems,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/library/sections", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const section = await saveLibrarySection(request.body || {});
    clearLibraryCache();
    response.json({ section });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/library/sections/:id", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const section = await saveLibrarySection({ ...(request.body || {}), id: request.params.id });
    clearLibraryCache();
    response.json({ section });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/library/sections/:id", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    await deleteLibrarySection(request.params.id);
    clearLibraryCache();
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/library/items", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const item = await saveLibraryItem(request.body || {});
    clearLibraryCache();
    response.json({ item });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/library/items/:id", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const item = await saveLibraryItem({ ...(request.body || {}), id: request.params.id });
    clearLibraryCache();
    response.json({ item });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/library/items/:id", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    await deleteLibraryItem(request.params.id);
    clearLibraryCache();
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/library",
  requireDatabase,
  requireSession,
  requireCurrentRegistration,
  async (request, response, next) => {
    try {
      const force =
        request.query.refresh === "true" && config.nodeEnv !== "production";
      response.json(await getVirtualLibrary({ force }));
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/library-preview", async (request, response, next) => {
  try {
    const force = request.query.refresh === "true";
    response.json(await getVirtualLibrary({ force }));
  } catch (error) {
    next(error);
  }
});

app.get("*", (request, response) => {
  response.sendFile(path.join(rootDir, "index.html"));
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error.status && error.status < 500) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  const requestId = randomToken(6);
  console.error(`Virtual Library error ${requestId}:`, error);
  response.status(500).json({ error: "Something went wrong.", requestId });
});

function startServer() {
  return app.listen(config.port, () => {
    console.log(`SEMCME Virtual Library listening on ${config.appBaseUrl}`);
  });
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  startServer();
}

export default app;
export { startServer };
