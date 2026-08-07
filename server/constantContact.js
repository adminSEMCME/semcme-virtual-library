import { config } from "./config.js";
import { getIntegrationTokens, saveIntegrationTokens } from "./repositories.js";
import { normalizeEmail } from "./security.js";

const API_BASE = "https://api.cc.email/v3";
const TOKEN_URL = "https://authz.constantcontact.com/oauth2/default/v1/token";

let accessToken = config.constantContact.accessToken;
let refreshToken = config.constantContact.refreshToken;
let loadedStoredTokens = false;
const resolvedTrackKeys = new Map();

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

export async function saveConstantContactTokens(tokens) {
  accessToken = tokens.accessToken || tokens.access_token || accessToken;
  refreshToken = tokens.refreshToken || tokens.refresh_token || refreshToken;
  loadedStoredTokens = true;
  await saveIntegrationTokens("constant_contact", { accessToken, refreshToken });
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

function readPath(value, path) {
  return path.split(".").reduce((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return current[key];
  }, value);
}

function fieldLabel(field) {
  if (!field || typeof field !== "object") return "";
  return String(
    field.label ||
      field.name ||
      field.question ||
      field.question_text ||
      field.text ||
      field.title ||
      field.display_name ||
      field.field_label ||
      field.custom_field_name ||
      field.custom_field_id ||
      field.id ||
      ""
  ).trim();
}

function fieldValue(field) {
  if (!field || typeof field !== "object") return "";
  const value =
    field.value ??
    field.answer ??
    field.answer_text ??
    field.answers ??
    field.response ??
    field.response_text ??
    field.field_value ??
    field.custom_field_value ??
    field.selected_value ??
    field.selected_option ??
    field.choices ??
    "";

  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    return String(value.label || value.name || value.value || "").trim();
  }
  return String(value || "").trim();
}

function labelMatches(label, candidates) {
  const normalized = String(label || "").trim().toLowerCase();
  if (!normalized) return false;
  return candidates.some((candidate) => normalized === candidate || normalized.includes(candidate));
}

function flattenRegistrationFields(record) {
  const fields = [];
  const visit = (value, parentLabel = "") => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, parentLabel));
      return;
    }
    if (typeof value !== "object") return;

    const label = fieldLabel(value) || parentLabel;
    const answer = fieldValue(value);
    if (label && answer) fields.push({ label, value: answer });

    for (const key of ["custom_fields", "custom_questions", "questions", "answers", "fields", "form_fields", "registration_fields"]) {
      if (value[key]) visit(value[key], label);
    }
  };

  visit(record);
  return fields;
}

function findFieldValueByLabel(record, candidates) {
  const field = flattenRegistrationFields(record).find((entry) => labelMatches(entry.label, candidates));
  if (field?.value) return field.value;

  const queue = [record];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    const label = fieldLabel(value);
    const answer = fieldValue(value);
    if (labelMatches(label, candidates) && answer) return answer;

    Object.entries(value).forEach(([key, child]) => {
      if (labelMatches(key, candidates) && child != null && typeof child !== "object") {
        queue.unshift({ label: key, value: child });
      } else {
        queue.push(child);
      }
    });
  }

  return null;
}

function flattenRegistrationStrings(value, path = "", strings = []) {
  if (value == null) return strings;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text) strings.push({ path, value: text });
    return strings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenRegistrationStrings(item, `${path}[${index}]`, strings));
    return strings;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      flattenRegistrationStrings(child, path ? `${path}.${key}` : key, strings);
    });
  }
  return strings;
}

function findStringByPath(record, pathCandidates) {
  const strings = flattenRegistrationStrings(record);
  const match = strings.find((entry) => {
    const path = entry.path.toLowerCase();
    return pathCandidates.some((candidate) => path.includes(candidate));
  });
  return match?.value || null;
}

function findProfileField(record, directPaths, labels, pathCandidates = labels) {
  for (const path of directPaths) {
    const value = readPath(record, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return findFieldValueByLabel(record, labels) || findStringByPath(record, pathCandidates);
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
    firstName: firstName || null,
    lastName: lastName || null,
    memberInstitution: findProfileField(
      record,
      ["member_institution", "organization", "company_name", "company", "contact.company", "profile.company"],
      ["semcme member institution", "semcme member organization", "member institution", "member organization", "institution", "organization"]
    ),
    organization: findProfileField(
      record,
      ["organization", "company_name", "company", "contact.company", "profile.company"],
      ["organization", "company", "institution"]
    ),
    degree: findProfileField(
      record,
      ["degree", "designation", "credentials"],
      ["degree", "credentials", "designation"]
    ),
    roleTitle: findProfileField(
      record,
      ["role_title", "role", "title", "job_title", "contact.job_title", "profile.job_title"],
      ["role/title", "role", "title", "job title"]
    ),
    specialty: findProfileField(
      record,
      ["specialty", "select_specialty"],
      ["specialty", "select specialty"]
    ),
    contactId: firstPresent(record.contact_id, record.contact?.contact_id, record.contact?.id),
    registrationId: firstPresent(record.registration_id, record.registrant_id, record.id),
    eventId: program.eventId,
    trackKey: program.trackKey,
    registrationStatus: firstPresent(record.registration_status, record.status) || "REGISTERED",
    registrationTime: firstPresent(record.registration_time, record.created_at, record.registered_at),
    rawData: record
  };
}

function registrationMatchesEmail(record, email, program) {
  const mapped = mapRegistration(record, program);
  return mapped?.email === email;
}

function trackKeyFromTrack(track) {
  return firstPresent(
    track.track_key,
    track.trackKey,
    track.key,
    track.id,
    track.track_id,
    track.registration_track_key,
    track.registrationTrackKey
  );
}

function trackListFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.records)) return data.records;
  if (Array.isArray(data.tracks)) return data.tracks;
  if (Array.isArray(data.registration_tracks)) return data.registration_tracks;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

async function resolveTrackKey(eventId) {
  if (config.constantContact.trackKey) return config.constantContact.trackKey;
  if (resolvedTrackKeys.has(eventId)) return resolvedTrackKeys.get(eventId);

  const response = await constantContactFetch(`/events/${encodeURIComponent(eventId)}/tracks`);
  if (!response.ok) {
    const body = await response.text();
    throw new ConstantContactError(`Constant Contact event track lookup failed: ${response.status} ${body}`, { status: response.status });
  }

  const data = await response.json();
  const tracks = trackListFromResponse(data);
  const preferredTrack = tracks.find((track) => {
    const status = String(firstPresent(track.status, track.registration_status, track.state) || "").toLowerCase();
    return !status || ["active", "open", "published", "live"].includes(status);
  }) || tracks[0];
  const trackKey = preferredTrack ? trackKeyFromTrack(preferredTrack) : null;
  if (!trackKey) {
    throw new ConstantContactError("No Constant Contact registration track was found for the Virtual Library event.", { status: 503 });
  }

  resolvedTrackKeys.set(eventId, trackKey);
  return trackKey;
}

export async function findVirtualLibraryRegistrationByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const eventId = config.constantContact.eventId;

  if (!eventId) {
    throw new ConstantContactError("Constant Contact Virtual Library event is not configured.", { status: 503 });
  }

  const trackKey = await resolveTrackKey(eventId);
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
    const match = records.find((record) => registrationMatchesEmail(record, normalizedEmail, program));
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

export async function listVirtualLibraryRegistrations() {
  const eventId = config.constantContact.eventId;

  if (!eventId) {
    throw new ConstantContactError("Constant Contact Virtual Library event is not configured.", { status: 503 });
  }

  const trackKey = await resolveTrackKey(eventId);
  const program = { eventId, trackKey };
  const registrations = [];
  let cursor = null;

  do {
    const params = new URLSearchParams({
      registration_status: "REGISTERED",
      limit: "100"
    });
    if (cursor) params.set("cursor", cursor);

    const response = await constantContactFetch(`/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(trackKey)}/registrations?${params}`);
    if (!response.ok) {
      const body = await response.text();
      throw new ConstantContactError(`Constant Contact registration sync failed: ${response.status} ${body}`, { status: response.status });
    }

    const data = await response.json();
    const records = data.records || data.registrations || [];
    records.forEach((record) => {
      const registration = mapRegistration(record, program);
      if (registration) registrations.push(registration);
    });

    cursor = data.next_cursor || null;
    if (!cursor && data._links?.next?.href) {
      try {
        cursor = new URL(data._links.next.href, API_BASE).searchParams.get("cursor");
      } catch {
        cursor = null;
      }
    }
  } while (cursor);

  return registrations;
}
