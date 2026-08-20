# CoDevelop — Property Co-Development Platform (clean functioning site)

A clean, functioning build of the CoDevelop platform (separate from the interactive prototype/demo).

- **Accounts** — visitors create accounts as Investor, Developer or Property owner (sign in/up).
- **Property listings** — developers **and** visitors (property owners) submit properties.
- **Admin verification** — `admin.html`: admin can **add/delete accounts** and **update & verify** every listing before it goes public. Only *verified* listings appear on the public site.
- **Separate access links** — Investor (`#/investor`), Developer (`#/developer`), Property owner (`#/list`), Admin (`admin.html`).

## Data
Runs standalone on `localStorage` (per-browser) so it works immediately. The store API in `data.js` is
structured to swap to **Supabase** (Postgres + Auth + RLS) for real, shared, multi-user data — set
`SUPABASE_URL` + `SUPABASE_KEY` in `data.js` and point the store methods at the `accounts`/`properties` tables.

## Sandbox
This is **sandbox mode** — no real capital, KYC or escrow. Real auth+MFA, KYC/AML, bank/escrow and the
legal/regulatory program are the production go-live build (see the CoDevelop go-live plan PDFs).

Admin passcode (demo): `admin2026`.
