CREATE TABLE IF NOT EXISTS vl_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  constant_contact_contact_id TEXT,
  constant_contact_registration_id TEXT,
  constant_contact_event_id TEXT,
  constant_contact_track_key TEXT,
  registration_status TEXT NOT NULL DEFAULT 'REGISTERED',
  registered_at TIMESTAMP,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS vl_magic_links (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES vl_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  requested_ip TEXT,
  requested_user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vl_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES vl_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vl_integration_tokens (
  provider TEXT PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vl_library_sections (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vl_library_items (
  id BIGSERIAL PRIMARY KEY,
  section_id BIGINT NOT NULL REFERENCES vl_library_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  speaker TEXT,
  resource_date TEXT,
  url TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'resource',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vl_users_email ON vl_users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_vl_magic_links_token_hash ON vl_magic_links (token_hash);
CREATE INDEX IF NOT EXISTS idx_vl_sessions_token_hash ON vl_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_vl_library_sections_order ON vl_library_sections (display_order, name);
CREATE INDEX IF NOT EXISTS idx_vl_library_items_section_order ON vl_library_items (section_id, display_order, title);

CREATE OR REPLACE FUNCTION vl_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vl_integration_tokens_updated_at ON vl_integration_tokens;
CREATE TRIGGER vl_integration_tokens_updated_at
BEFORE UPDATE ON vl_integration_tokens
FOR EACH ROW
EXECUTE FUNCTION vl_touch_updated_at();

DROP TRIGGER IF EXISTS vl_library_sections_updated_at ON vl_library_sections;
CREATE TRIGGER vl_library_sections_updated_at
BEFORE UPDATE ON vl_library_sections
FOR EACH ROW
EXECUTE FUNCTION vl_touch_updated_at();

DROP TRIGGER IF EXISTS vl_library_items_updated_at ON vl_library_items;
CREATE TRIGGER vl_library_items_updated_at
BEFORE UPDATE ON vl_library_items
FOR EACH ROW
EXECUTE FUNCTION vl_touch_updated_at();
