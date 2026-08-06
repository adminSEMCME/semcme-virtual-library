import { config } from "./config.js";
import { getIntegrationTokens, saveIntegrationTokens } from "./repositories.js";
import { normalizeEmail } from "./security.js";

const API_BASE = "https://api.cc.email/v3";
const TOKEN_URL = "https://authz.constantcontact.com/oauth2/default/v1/token";

let accessToken = config.constantContact.accessToken;
let refreshToken = config.constantContact.refreshToken;
let loadedStoredTokens = false;

export class ConstantContactError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message);
    this.name = "ConstantContactError";
    this.status = status;
    this.cause = cause;
  }
}

async function loadStoredTokens() {
  if (loadedStoredTokens) return;
  loadedStoredTokens = true;

  const storedTokens = await getIntegrationTokens("constant_contact");
  if (!storedTokens) return;

  accessToken = storedTokens.access_token || accessToken;
  refreshToken = storedTokens.refresh_token || refreshToken;
}

async function refreshAccessToken() {
  await loadStoredTokens();

  if (!config.constantContact.clientId || !config.constantContact.clientSecret || !refreshToken) {
    throw new ConstantContactError("Constant Contact refresh credentials are not configured.");
  }

  const credentials = Buffer.from(`${config.constantContact.clientId}:${config.constantContact.clientSecret}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ConstantContactError(`Constant Contact token refresh failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  refreshToken = data.refresh_token || refreshToken;
  await saveIntegrationTokens("constant_contact", { accessToken, refreshToken });
  return accessToken;
}

async function constantContactFetch(path, options = {}, allowRefresh = true) {
  await loadStoredTokens();

  if (!accessToken) throw new ConstantContactError("CONSTANT_CONTACT_ACCESS_TOKEN is not configured.");

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`
      }
    });
  } catch (error) {
    throw new ConstantContactError(`Constant Contact request failed: ${error.message}`, { cause: error });
  }

  if (response.status === 401 && allowRefresh) {
    await refreshAccessToken();
    return constantContactFetch(path, options, false);
  }

  return response;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function mapRegistration(record, program) {
  const email = normalizeEmail(firstPresent(
    record.email,
    record.email_address,
    record.contact?.email_address,
    record.registrant?.email_address,
    record.contact?.email,
    record.profile?.email
  ));

  if (!email) return null;

  const firstName = firstPresent(record.first_name, record.contact?.first_name, record.profile?.first_name);
  const lastName = firstPresent(record.last_name, record.contact?.last_name, record.profile?.last_name);
  const fullName = firstPresent(
    record.full_name,
    record.name,
    [firstName, lastName].filter(Boolean).join(" ")
  );

  return {
    email,
    fullName: fullName || email,
    contactId: firstPresent(record.contact_id, record.contact?.contact_id, record.contact?.id),
    registrationId: firstPresent(record.registration_id, record.registrant_id, record.id),
    eventId: program.eventId,
    trackKey: program.trackKey,
    registrationStatus: firstPresent(record.registration_status, record.status) || "REGISTERED",
    registrationTime: firstPresent(record.registration_time, record.created_at, record.registered_at)
  };
}

function registrationMatchesEmail(record, email) {
  const mapped = mapRegistration(record, {
    eventId: config.constantContact.eventId,
    trackKey: config.constantContact.trackKey
  });
  return mapped?.email === email;
}

export async function findVirtualLibraryRegistrationByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const eventId = config.constantContact.eventId;
  const trackKey = config.constantContact.trackKey;

  if (!eventId || !trackKey) {
    throw new ConstantContactError("Constant Contact Virtual Library event and track are not configured.", { status: 503 });
  }

  let cursor = null;
  const program = { eventId, trackKey };

  do {
    const params = new URLSearchParams({
      registration_status: "REGISTERED",
      limit: "100"
    });
    if (cursor) params.set("cursor", cursor);

    const response = await constantContactFetch(`/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(trackKey)}/registrations?${params}`);
    if (!response.ok) {
      const body = await response.text();
      throw new ConstantContactError(`Constant Contact registration lookup failed: ${response.status} ${body}`, { status: response.status });
    }

    const data = await response.json();
    const records = data.records || data.registrations || [];
    const match = records.find((record) => registrationMatchesEmail(record, normalizedEmail));
    if (match) return mapRegistration(match, program);

    cursor = data.next_cursor || null;
    if (!cursor && data._links?.next?.href) {
      try {
        cursor = new URL(data._links.next.href, API_BASE).searchParams.get("cursor");
      } catch {
        cursor = null;
      }
    }
  } while (cursor);

  return null;
}
