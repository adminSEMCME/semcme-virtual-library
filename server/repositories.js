import { query, withTransaction } from "./db.js";
import { hashToken, randomToken } from "./security.js";

export async function findUserByEmail(email) {
  const result = await query(
    `
      SELECT *
      FROM vl_users
      WHERE email = $1
        AND registration_status = 'REGISTERED'
      LIMIT 1
    `,
    [email]
  );
  return result.rows[0] || null;
}

export async function upsertUserFromRegistration(registration) {
  const result = await query(
    `
      INSERT INTO vl_users (
        email,
        full_name,
        first_name,
        last_name,
        member_institution,
        organization,
        degree,
        role_title,
        specialty,
        constant_contact_contact_id,
        constant_contact_registration_id,
        constant_contact_event_id,
        constant_contact_track_key,
        registration_status,
        registered_at,
        synced_at,
        raw_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15::timestamp, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, $16::jsonb)
      ON CONFLICT (email)
      DO UPDATE SET
        full_name = COALESCE(EXCLUDED.full_name, vl_users.full_name),
        first_name = COALESCE(EXCLUDED.first_name, vl_users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, vl_users.last_name),
        member_institution = COALESCE(EXCLUDED.member_institution, vl_users.member_institution),
        organization = COALESCE(EXCLUDED.organization, vl_users.organization),
        degree = COALESCE(EXCLUDED.degree, vl_users.degree),
        role_title = COALESCE(EXCLUDED.role_title, vl_users.role_title),
        specialty = COALESCE(EXCLUDED.specialty, vl_users.specialty),
        constant_contact_contact_id = EXCLUDED.constant_contact_contact_id,
        constant_contact_registration_id = EXCLUDED.constant_contact_registration_id,
        constant_contact_event_id = EXCLUDED.constant_contact_event_id,
        constant_contact_track_key = EXCLUDED.constant_contact_track_key,
        registration_status = EXCLUDED.registration_status,
        registered_at = COALESCE(EXCLUDED.registered_at, vl_users.registered_at),
        raw_data = CASE
          WHEN EXCLUDED.raw_data = '{}'::jsonb THEN vl_users.raw_data
          ELSE EXCLUDED.raw_data
        END,
        synced_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
    [
      registration.email,
      registration.fullName || null,
      registration.firstName || null,
      registration.lastName || null,
      registration.memberInstitution || null,
      registration.organization || registration.memberInstitution || null,
      registration.degree || null,
      registration.roleTitle || null,
      registration.specialty || null,
      registration.contactId || null,
      registration.registrationId || null,
      registration.eventId || null,
      registration.trackKey || null,
      registration.registrationStatus || "REGISTERED",
      registration.registrationTime || null,
      JSON.stringify(registration.rawData || {})
    ]
  );
  return result.rows[0];
}

export async function updateUserRegistrationStatus(email, registrationStatus) {
  const result = await query(
    "UPDATE vl_users SET registration_status = $2, synced_at = CURRENT_TIMESTAMP WHERE email = $1 RETURNING *",
    [email, registrationStatus]
  );
  return result.rows[0] || null;
}

export async function createMagicLink(userId, request) {
  const token = randomToken(32);
  const result = await query(
    `
      INSERT INTO vl_magic_links (
        user_id,
        token_hash,
        expires_at,
        requested_ip,
        requested_user_agent
      )
      VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '15 minutes', $3, $4)
      RETURNING expires_at
    `,
    [userId, hashToken(token), request.ip, request.get("user-agent") || null]
  );
  return { token, expiresAt: result.rows[0].expires_at };
}

export async function consumeMagicLink(rawToken) {
  const tokenHash = hashToken(rawToken);

  return withTransaction(async (client) => {
    const result = await client.query(
      `
        SELECT ml.*, u.email, u.full_name
        FROM vl_magic_links ml
        JOIN vl_users u ON u.id = ml.user_id
        WHERE ml.token_hash = $1
          AND ml.used_at IS NULL
          AND ml.expires_at > CURRENT_TIMESTAMP
          AND u.registration_status = 'REGISTERED'
        FOR UPDATE
      `,
      [tokenHash]
    );
    const link = result.rows[0];
    if (!link) return null;

    await client.query("UPDATE vl_magic_links SET used_at = CURRENT_TIMESTAMP WHERE id = $1", [link.id]);
    await client.query("UPDATE vl_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1", [link.user_id]);

    return {
      id: link.user_id,
      email: link.email,
      full_name: link.full_name
    };
  });
}

export async function createSession(userId) {
  const token = randomToken(32);
  const result = await query(
    "INSERT INTO vl_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours') RETURNING expires_at",
    [userId, hashToken(token)]
  );
  return { token, expiresAt: result.rows[0].expires_at };
}

export async function findUserBySessionToken(rawToken) {
  if (!rawToken) return null;
  const result = await query(
    `
      SELECT u.*
      FROM vl_sessions s
      JOIN vl_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP
        AND s.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
        AND u.registration_status = 'REGISTERED'
      LIMIT 1
    `,
    [hashToken(rawToken)]
  );
  return result.rows[0] || null;
}

export async function revokeSession(rawToken) {
  if (!rawToken) return;
  await query("UPDATE vl_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1", [hashToken(rawToken)]);
}

export async function getIntegrationTokens(provider) {
  const result = await query("SELECT * FROM vl_integration_tokens WHERE provider = $1", [provider]);
  return result.rows[0] || null;
}

export async function saveIntegrationTokens(provider, tokens) {
  await query(
    `
      INSERT INTO vl_integration_tokens (provider, access_token, refresh_token)
      VALUES ($1, $2, $3)
      ON CONFLICT (provider)
      DO UPDATE SET access_token = EXCLUDED.access_token,
                    refresh_token = COALESCE(EXCLUDED.refresh_token, vl_integration_tokens.refresh_token)
    `,
    [provider, tokens.accessToken || null, tokens.refreshToken || null]
  );
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export async function getLibraryContent({ includeHidden = false } = {}) {
  const visibility = includeHidden ? "" : "WHERE s.is_visible = TRUE";
  const sectionResult = await query(
    `
      SELECT *
      FROM vl_library_sections s
      ${visibility}
      ORDER BY s.display_order ASC, s.name ASC
    `
  );

  if (!sectionResult.rows.length) return [];

  const itemResult = await query(
    `
      SELECT i.*
      FROM vl_library_items i
      JOIN vl_library_sections s ON s.id = i.section_id
      WHERE i.section_id = ANY($1::bigint[])
        ${includeHidden ? "" : "AND i.is_visible = TRUE AND s.is_visible = TRUE"}
      ORDER BY i.section_id ASC, i.display_order ASC, i.title ASC
    `,
    [sectionResult.rows.map((section) => section.id)]
  );

  const itemsBySection = new Map();
  itemResult.rows.forEach((item) => {
    if (!itemsBySection.has(String(item.section_id))) itemsBySection.set(String(item.section_id), []);
    itemsBySection.get(String(item.section_id)).push(item);
  });

  return sectionResult.rows.map((section) => ({
    ...section,
    items: itemsBySection.get(String(section.id)) || []
  }));
}

export async function saveLibrarySection(section) {
  const name = String(section.name || "").trim();
  if (!name) throw Object.assign(new Error("Section name is required."), { status: 400 });
  const slug = slugify(section.slug || name);
  if (!section.id) {
    const result = await query(
      `
        INSERT INTO vl_library_sections (name, slug, description, display_order, is_visible)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [
        name,
        slug,
        String(section.description || "").trim() || null,
        Number(section.displayOrder || section.display_order || 0),
        section.isVisible ?? section.is_visible ?? true
      ]
    );
    return result.rows[0];
  }
  const result = await query(
    `
      UPDATE vl_library_sections
      SET name = $2,
          slug = $3,
          description = $4,
          display_order = $5,
          is_visible = $6
      WHERE id = $1
      RETURNING *
    `,
    [
      section.id || null,
      name,
      slug,
      String(section.description || "").trim() || null,
      Number(section.displayOrder || section.display_order || 0),
      section.isVisible ?? section.is_visible ?? true
    ]
  );
  return result.rows[0];
}

export async function deleteLibrarySection(id) {
  await query("DELETE FROM vl_library_sections WHERE id = $1", [id]);
}

export async function saveLibraryItem(item) {
  const title = String(item.title || "").trim();
  const url = String(item.url || "").trim();
  if (!item.sectionId && !item.section_id) throw Object.assign(new Error("Section is required."), { status: 400 });
  if (!title) throw Object.assign(new Error("Title is required."), { status: 400 });
  if (!url) throw Object.assign(new Error("URL is required."), { status: 400 });
  if (!item.id) {
    const result = await query(
      `
        INSERT INTO vl_library_items (
          section_id,
          title,
          speaker,
          resource_date,
          url,
          item_type,
          display_order,
          is_visible
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        item.sectionId || item.section_id,
        title,
        String(item.speaker || "").trim() || null,
        String(item.date || item.resource_date || "").trim() || null,
        url,
        String(item.itemType || item.item_type || "resource").trim() || "resource",
        Number(item.displayOrder || item.display_order || 0),
        item.isVisible ?? item.is_visible ?? true
      ]
    );
    return result.rows[0];
  }
  const result = await query(
    `
      UPDATE vl_library_items
      SET section_id = $2,
          title = $3,
          speaker = $4,
          resource_date = $5,
          url = $6,
          item_type = $7,
          display_order = $8,
          is_visible = $9
      WHERE id = $1
      RETURNING *
    `,
    [
      item.id || null,
      item.sectionId || item.section_id,
      title,
      String(item.speaker || "").trim() || null,
      String(item.date || item.resource_date || "").trim() || null,
      url,
      String(item.itemType || item.item_type || "resource").trim() || "resource",
      Number(item.displayOrder || item.display_order || 0),
      item.isVisible ?? item.is_visible ?? true
    ]
  );
  return result.rows[0];
}

export async function deleteLibraryItem(id) {
  await query("DELETE FROM vl_library_items WHERE id = $1", [id]);
}

export async function replaceLibraryContent(library) {
  return withTransaction(async (client) => {
    await client.query("DELETE FROM vl_library_items");
    await client.query("DELETE FROM vl_library_sections");

    const savedSections = [];
    for (const [sectionIndex, section] of (library.sections || []).entries()) {
      const sectionResult = await client.query(
        `
          INSERT INTO vl_library_sections (name, slug, description, display_order, is_visible)
          VALUES ($1, $2, $3, $4, TRUE)
          RETURNING *
        `,
        [
          String(section.name || "").trim(),
          slugify(section.id || section.slug || section.name),
          String(section.description || "").trim() || null,
          sectionIndex,
        ],
      );
      const savedSection = sectionResult.rows[0];
      savedSections.push(savedSection);

      for (const [itemIndex, item] of (section.items || []).entries()) {
        await client.query(
          `
            INSERT INTO vl_library_items (
              section_id,
              title,
              speaker,
              resource_date,
              url,
              item_type,
              display_order,
              is_visible
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
          `,
          [
            savedSection.id,
            String(item.title || "").trim(),
            String(item.speaker || "").trim() || null,
            String(item.date || "").trim() || null,
            String(item.url || "").trim(),
            String(item.type || item.itemType || (item.embedUrl ? "video" : "resource")).trim() || "resource",
            itemIndex,
          ],
        );
      }
    }

    return savedSections;
  });
}
