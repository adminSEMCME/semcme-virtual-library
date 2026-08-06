# SEMCME Virtual Library

Protected SEMCME Virtual Library site with SBS-style magic-link login, Constant Contact registration lookup, and a scraper-backed library UI.

## What Is Built

- Express/Node production app.
- 24-hour participant sessions with 15-minute one-use sign-in links.
- Constant Contact lookup by Virtual Library event ID and track key.
- PostgreSQL tables namespaced with `vl_*`.
- Staff admin page at `/admin` for editing library sections, links, videos, PDFs, and materials.
- Admin-managed library content with section/resource ordering.
- Protected `/api/library` scraper for `https://semcme.org/semcme-virtual-library/`.
- Optional `VIRTUAL_LIBRARY_WORDPRESS_PASSWORD` for the currently password-protected WordPress source page.
- Search by word and multi-section filtering.
- Resource panels with embedded YouTube/Vimeo/video links where possible.

## Setup

1. Copy `.env.example` to `.env` and fill in production values.
2. Install dependencies with `npm install`.
3. Run the database schema with `npm run db:migrate`.
4. Start locally with `npm start`.

## Admin

Set `GLOBAL_ADMIN_USERNAME` and `GLOBAL_ADMIN_PASSWORD`, then visit `/admin`.

The admin page can:

- Import the current library content into editable database rows.
- Add, edit, hide, delete, and reorder sections.
- Add, edit, hide, delete, and reorder videos, links, PDFs, and materials.
- Update the member-facing library immediately after a save.

## Production Notes

- Set `APP_BASE_URL` to the final deployed URL before sending emails.
- Set `COOKIE_SECURE=true` and `TRUST_PROXY=true` behind a production proxy.
- Add `CONSTANT_CONTACT_VIRTUAL_LIBRARY_EVENT_ID` and `CONSTANT_CONTACT_VIRTUAL_LIBRARY_TRACK_KEY` once the Constant Contact campaign is ready.
- Add `VIRTUAL_LIBRARY_WORDPRESS_PASSWORD` if the WordPress source remains password protected.
- Use `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=resend`, and a Virtual Library Resend API key as `SMTP_PASS`.
- Without SMTP settings, sign-in links are logged to the server console for local testing.
- You can reuse an existing SEMCME Postgres database. This project uses `vl_` table names to avoid conflicting with the other sites.

## Scraper Behavior

The app caches a successful scrape for `VIRTUAL_LIBRARY_SCRAPE_CACHE_MINUTES`. If the WordPress page cannot be read or is still locked, the API returns seed content based on the current SEMCME Virtual Library screenshot so the UI remains usable during setup.
