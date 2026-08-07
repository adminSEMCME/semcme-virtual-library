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
} from "./constantContact.js";
import { sendMagicLinkEmail } from "./mailer.js";
import { clearLibraryCache, getVirtualLibrary } from "./library.js";
import {
  consumeMagicLink,
  createMagicLink,
  createSession,
  deleteLibraryItem,
  deleteLibrarySection,
  findUserByEmail,
  getLibraryContent,
  revokeSession,
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

function requireAdmin(request, response, next) {
  if (isAdminCookieValid(request.cookies?.[ADMIN_COOKIE])) {
    next();
    return;
  }

  clearAdminCookie(response);
  response.status(401).json({ error: "Admin login required." });
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

async function resolveRegisteredUser(email) {
  const existing = await findUserByEmail(email);
  if (existing) return existing;

  const registration = await findVirtualLibraryRegistrationByEmail(email);
  if (!registration) return null;

  return upsertUserFromRegistration(registration);
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

    request.user = await upsertUserFromRegistration(registration);
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
    sourceUrl: config.sourceUrl,
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

app.post("/api/admin/library/import-source", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const current = await getVirtualLibrary({ force: true });
    for (const [sectionIndex, section] of current.sections.entries()) {
      const savedSection = await saveLibrarySection({
        name: section.name,
        slug: section.id,
        displayOrder: sectionIndex,
        isVisible: true
      });
      for (const [itemIndex, item] of section.items.entries()) {
        await saveLibraryItem({
          sectionId: savedSection.id,
          title: item.title,
          speaker: item.speaker,
          date: item.date,
          url: item.url,
          itemType: item.embedUrl ? "video" : "resource",
          displayOrder: itemIndex,
          isVisible: true
        });
      }
    }
    clearLibraryCache();
    response.json(publicAdminLibrary(await getLibraryContent({ includeHidden: true })));
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
    if (!config.previewUnlock) {
      response.status(404).json({ error: "Not found." });
      return;
    }

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
