import { config } from "./config.js";
import { getIntegrationTokens, saveIntegrationTokens } from "./repositories.js";
import { normalizeEmail } from "./security.js";

const API_BASE = "https://api.cc.email/v3";
const TOKEN_URL = "https://authz.constantcontact.com/oauth2/default/v1/token";

let accessToken = config.constantContact.accessToken;
let refreshToken = config.constantContact.refreshToken;
let loadedStoredTokens = false;
const resolvedTrackKeyLists = new Map();
let contactCustomFieldDefinitionsCache = null;

export class ConstantContactError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message);
    this.name = "ConstantContactError";
    this.status = status;
    this.cause = cause;
  }
}

function normalizeApiPath(value) {
  const url = new URL(String(value), API_BASE);
  const pathname = url.pathname.replace(/^\/v3(?=\/)/, "");
  return `${pathname}${url.search}`;
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

function customFieldId(field) {
  if (!field || typeof field !== "object") return "";
  return String(
    field.custom_field_id ||
      field.customFieldId ||
      field.field_id ||
      field.fieldId ||
      field.id ||
      ""
  ).trim();
}

async function contactCustomFieldDefinitions() {
  if (contactCustomFieldDefinitionsCache) return contactCustomFieldDefinitionsCache;

  const definitions = new Map();
  let path = "/contact_custom_fields?limit=100";

  try {
    for (let page = 0; path && page < 10; page += 1) {
      const response = await constantContactFetch(path);
      if (!response.ok) break;

      const data = await response.json();
      const fields = data.custom_fields || data.records || [];
      fields.forEach((field) => {
        const id = customFieldId(field);
        if (!id) return;

        const choices = new Map();
        (field.choices || field.options || field.values || []).forEach((choice) => {
          const choiceId = String(choice.choice_id || choice.id || choice.value || "").trim();
          const choiceLabel = String(choice.choice_label || choice.label || choice.name || choice.value || "").trim();
          if (choiceId && choiceLabel) choices.set(choiceId, choiceLabel);
        });

        definitions.set(id, {
          id,
          label: String(field.label || field.name || field.display_name || "").trim(),
          name: String(field.name || field.label || field.display_name || "").trim(),
          choices
        });
      });

      const nextHref = data.next_cursor || data._links?.next?.href || data.links?.next?.href || null;
      path = nextHref
        ? (String(nextHref).startsWith("http") || String(nextHref).startsWith("/")
          ? normalizeApiPath(nextHref)
          : `/contact_custom_fields?limit=100&cursor=${encodeURIComponent(nextHref)}`)
        : "";
    }
  } catch {
    // Custom field labels are helpful but not required for syncing users.
  }

  contactCustomFieldDefinitionsCache = definitions;
  return definitions;
}

async function decorateContactCustomFields(contact) {
  const definitions = await contactCustomFieldDefinitions();
  const decorate = (field) => {
    const id = customFieldId(field);
    const definition = definitions.get(id);
    if (!definition) return field;

    const rawValue = fieldValue(field);
    const value = definition.choices.get(rawValue) || rawValue;
    return {
      ...field,
      label: field.label || definition.label,
      name: field.name || definition.name,
      value
    };
  };

  const customFields = contact.custom_fields || contact.customFields || contact.contact_custom_fields || contact.contactCustomFields;
  if (!Array.isArray(customFields)) return contact;

  return {
    ...contact,
    custom_fields: customFields.map(decorate)
  };
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

function registrationNeedsDetail(registration) {
  return !registration ||
    !registration.memberInstitution ||
    !registration.degree ||
    !registration.roleTitle;
}

async function fetchVirtualLibraryRegistrationDetail(registration) {
  if (!registration?.registrationId) return registration;

  const eventId = registration.eventId || config.constantContact.eventId;
  const trackKey = registration.trackKey || config.constantContact.trackKey;
  const registrationId = encodeURIComponent(registration.registrationId);
  const paths = [
    trackKey ? `/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(trackKey)}/registrations/${registrationId}` : "",
    `/events/${encodeURIComponent(eventId)}/registrations/${registrationId}`
  ].filter(Boolean);

  for (const path of paths) {
    const response = await constantContactFetch(path);
    if (response.ok) {
      const record = await response.json();
      return mapRegistration({ ...registration.rawData, ...record }, {
        eventId,
        trackKey
      }) || registration;
    }

    if (![404, 405].includes(response.status)) {
      const body = await response.text();
      console.warn(`Constant Contact registration detail lookup skipped: ${response.status} ${body}`);
      return registration;
    }
  }

  return registration;
}

async function fetchVirtualLibraryContactDetail(registration) {
  if (!registration?.contactId) return registration;

  const params = new URLSearchParams({ include: "custom_fields" });
  const response = await constantContactFetch(`/contacts/${encodeURIComponent(registration.contactId)}?${params}`);
  if (!response.ok) {
    if ([404, 405].includes(response.status)) return registration;
    const body = await response.text();
    console.warn(`Constant Contact contact detail lookup skipped: ${response.status} ${body}`);
    return registration;
  }

  const contact = await decorateContactCustomFields(await response.json());
  const mergedRecord = {
    ...registration.rawData,
    contact: {
      ...(registration.rawData?.contact || {}),
      ...contact
    },
    contact_detail: contact
  };
  return mapRegistration(mergedRecord, {
    eventId: registration.eventId || config.constantContact.eventId,
    trackKey: registration.trackKey || config.constantContact.trackKey
  }) || registration;
}

function mergeRegistrationDetails(base, detail) {
  return {
    ...base,
    ...detail,
    fullName: detail.fullName || base.fullName,
    firstName: detail.firstName || base.firstName,
    lastName: detail.lastName || base.lastName,
    memberInstitution: detail.memberInstitution || base.memberInstitution,
    organization: detail.organization || base.organization,
    degree: detail.degree || base.degree,
    roleTitle: detail.roleTitle || base.roleTitle,
    specialty: detail.specialty || base.specialty,
    contactId: detail.contactId || base.contactId,
    registrationId: detail.registrationId || base.registrationId,
    eventId: detail.eventId || base.eventId,
    trackKey: detail.trackKey || base.trackKey,
    rawData: {
      ...(base.rawData || {}),
      ...(detail.rawData || {})
    }
  };
}

export async function withVirtualLibraryRegistrationDetails(registration) {
  if (!registrationNeedsDetail(registration)) return registration;

  let enriched = registration;
  const registrationDetail = await fetchVirtualLibraryRegistrationDetail(enriched);
  enriched = mergeRegistrationDetails(enriched, registrationDetail);
  if (!registrationNeedsDetail(enriched)) return enriched;

  const contactDetail = await fetchVirtualLibraryContactDetail(enriched);
  enriched = mergeRegistrationDetails(enriched, contactDetail);
  return enriched;
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

function eventIdFromRecord(event) {
  return firstPresent(
    event.event_id,
    event.eventId,
    event.campaign_id,
    event.campaignId,
    event.placeholder_campaign_id,
    event.placeholderCampaignId,
    event.id
  );
}

function eventMatchesId(event, eventId) {
  const normalized = String(eventId || "").trim();
  return [
    event.event_id,
    event.eventId,
    event.campaign_id,
    event.campaignId,
    event.placeholder_campaign_id,
    event.placeholderCampaignId,
    event.id
  ].some((value) => String(value || "").trim() === normalized);
}

async function fetchEventTracks(eventId) {
  const response = await constantContactFetch(`/events/${encodeURIComponent(eventId)}/tracks`);
  if (!response.ok) {
    const body = await response.text();
    throw new ConstantContactError(`Constant Contact event track lookup failed: ${response.status} ${body}`, { status: response.status });
  }

  return trackListFromResponse(await response.json());
}

async function findEventById(eventId) {
  let cursor = null;
  let pageCount = 0;

  do {
    let path;
    if (cursor && (String(cursor).startsWith("http") || String(cursor).startsWith("/"))) {
      path = normalizeApiPath(cursor);
    } else {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);
      path = `/events?${params}`;
    }

    const response = await constantContactFetch(path);
    if (!response.ok) {
      const body = await response.text();
      throw new ConstantContactError(`Constant Contact event list lookup failed: ${response.status} ${body}`, { status: response.status });
    }

    const data = await response.json();
    const events = data.records || data.events || [];
    const match = events.find((event) => eventMatchesId(event, eventId));
    if (match) return match;

    cursor = data.next_cursor || data._links?.next?.href || data.links?.next?.href || null;
    pageCount += 1;
  } while (cursor && pageCount < 20);

  return null;
}

async function fetchEventDefaultTrackKeys(eventId) {
  const response = await constantContactFetch(`/events/${encodeURIComponent(eventId)}`);
  let event = null;

  if (!response.ok) {
    if ([400, 404].includes(response.status)) {
      event = await findEventById(eventId);
    }

    if (!event) {
      const body = await response.text();
      throw new ConstantContactError(`Constant Contact event details lookup failed: ${response.status} ${body}`, { status: response.status });
    }
  } else {
    event = await response.json();
  }

  const tracks = [
    event.default_track,
    event.registration_track,
    event.track,
    ...(Array.isArray(event.tracks) ? event.tracks : []),
    ...(Array.isArray(event.registration_tracks) ? event.registration_tracks : [])
  ].filter(Boolean);

  return {
    eventId: eventIdFromRecord(event) || eventId,
    trackKeys: tracks.map((track) => trackKeyFromTrack(track)).filter(Boolean)
  };
}

async function resolveTrackKeys(eventId) {
  if (resolvedTrackKeyLists.has(eventId)) return resolvedTrackKeyLists.get(eventId);

  const configuredTrackKey = config.constantContact.trackKey;
  if (configuredTrackKey) {
    const resolved = { eventId, trackKeys: [configuredTrackKey] };
    resolvedTrackKeyLists.set(eventId, resolved);
    return resolved;
  }

  let discoveredTrackKeys = [];
  let resolvedEventId = eventId;
  try {
    const eventDetails = await fetchEventDefaultTrackKeys(eventId);
    resolvedEventId = eventDetails.eventId || eventId;
    discoveredTrackKeys = eventDetails.trackKeys;
  } catch (error) {
    if (![400, 404].includes(error.status)) throw error;
  }

  if (!discoveredTrackKeys.length) {
    const tracks = await fetchEventTracks(resolvedEventId);
    discoveredTrackKeys = tracks
      .map((track) => trackKeyFromTrack(track))
      .filter(Boolean);
  }

  const trackKeys = [...new Set(discoveredTrackKeys)];

  if (!trackKeys.length) {
    throw new ConstantContactError("No Constant Contact registration tracks were found for the Virtual Library event.", { status: 503 });
  }

  const resolved = { eventId: resolvedEventId, trackKeys };
  resolvedTrackKeyLists.set(eventId, resolved);
  return resolved;
}

export async function findVirtualLibraryRegistrationByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const eventId = config.constantContact.eventId;

  if (!eventId) {
    throw new ConstantContactError("Constant Contact Virtual Library event is not configured.", { status: 503 });
  }

  const resolved = await resolveTrackKeys(eventId);
  const trackKeys = resolved.trackKeys;
  for (const trackKey of trackKeys) {
    const program = { eventId: resolved.eventId, trackKey };
    let cursor = null;

    do {
      const params = new URLSearchParams({
        registration_status: "REGISTERED",
        limit: "100"
      });
      if (cursor) params.set("cursor", cursor);

      const response = await constantContactFetch(`/events/${encodeURIComponent(resolved.eventId)}/tracks/${encodeURIComponent(trackKey)}/registrations?${params}`);
      if (!response.ok) {
        if (trackKeys.length > 1 && [400, 404].includes(response.status)) break;
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
  }

  return null;
}

async function fetchRegistrationsForTrack(eventId, trackKey, onRegistration) {
  const program = { eventId, trackKey };
  let cursor = null;
  let count = 0;

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
    count += records.length;
    records.forEach((record) => onRegistration(record, program));

    cursor = data.next_cursor || null;
    if (!cursor && data._links?.next?.href) {
      try {
        cursor = new URL(data._links.next.href, API_BASE).searchParams.get("cursor");
      } catch {
        cursor = null;
      }
    }
  } while (cursor);

  return count;
}

export async function listVirtualLibraryRegistrations() {
  const eventId = config.constantContact.eventId;

  if (!eventId) {
    throw new ConstantContactError("Constant Contact Virtual Library event is not configured.", { status: 503 });
  }

  const resolved = await resolveTrackKeys(eventId);
  const trackKeys = resolved.trackKeys;
  const registrationsByEmail = new Map();
  let recordsFound = 0;

  for (const trackKey of trackKeys) {
    try {
      recordsFound += await fetchRegistrationsForTrack(resolved.eventId, trackKey, (record, program) => {
        const registration = mapRegistration(record, program);
        if (registration?.email) registrationsByEmail.set(registration.email, registration);
      });
    } catch (error) {
      if (trackKeys.length > 1 && [400, 404].includes(error.status)) continue;
      throw error;
    }
  }

  const registrations = [...registrationsByEmail.values()];
  registrations.recordsFound = recordsFound;
  registrations.tracksChecked = trackKeys.length;
  return registrations;
}
