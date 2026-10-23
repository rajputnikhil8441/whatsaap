# Multi-Brand Customer Contact Hub

A premium dark, mobile-first directory where customers pick a gaming brand and find that brand's customer-support WhatsApp numbers (Customer Support, Deposits, Withdrawals, General Enquiries), with an optional email/Telegram backup.

- **Public site:** static HTML/CSS/vanilla JS, no framework, no runtime dependencies.
- **Data:** Supabase Postgres, with Row Level Security. Visitors can only read *active* brands and contacts.
- **Admin (`/admin`):** Supabase Auth login, brand/contact management, logo uploads to Supabase Storage.
- **Content edits are live immediately.** Public pages read from Supabase on every load, so saving in the admin needs no commit or redeploy.

This is an independent contact directory. It is not affiliated with or endorsed by WhatsApp or Meta, and it uses no WhatsApp logos or branding.

## Design system

One dark theme shared by the public site and the admin panel (`src/css/styles.css` tokens, `src/css/admin.css` for the admin):
near-black surfaces (`#07110E` / `#0C1914` / `#10221A`), emerald (`#00B86B`) and WhatsApp-style green (`#25D366`) for actions and active states, and a muted gold (`#D6B46A`) used sparingly for small accents. Text and button colours were checked for WCAG AA contrast (buttons use dark text on the bright greens). The font stack is `Inter, Manrope, system-ui…`; no web fonts are downloaded, which keeps the strict CSP and fast loads.

The public site has no link to the admin panel. `/admin` stays reachable only by typing the address, and access is enforced by Supabase Auth, the `admin_users` allowlist and Row Level Security, not by hiding the link.

## Project layout

```
src/                 Source for the static site (copied to dist/ by the build)
  index.html         Public shell (home + /brand/<slug>)
  admin/index.html   Admin shell (noindex)
  js/                lib.js (pure helpers), icons.js (inline SVG icons), api.js + public.js (public), admin.js (admin)
  vendor/supabase.js supabase-js 2.45.4 UMD, self-hosted (admin only)
  css/               styles.css, admin.css
supabase/
  migrations/0001_init.sql   Schema, indexes, RLS, Storage bucket + policies
  seed.sql                   OPTIONAL clearly-labelled sample data
hosting/             _redirects (SPA rewrites) and _headers (security headers, noindex for /admin)
scripts/             build.mjs (dist + config + sitemap + robots), serve.mjs (local preview)
tests/               node:test unit tests (npm test)
vercel.json          Same rewrites/headers for Vercel
```

## Quick local preview (no Supabase needed)

Requires Node 18+.

```bash
npm run dev
```

Open <http://localhost:8080>. Without Supabase credentials the site shows a banner and clearly labelled **sample** data. `/admin` explains that Supabase is not configured.

## Set up Supabase (manual steps that need your account)

These cannot be done without your Supabase credentials. Never paste passwords or secret keys into chat or into this repo.

1. **Create a project** at <https://supabase.com/dashboard>.
2. **Run the schema.** In *SQL Editor*, paste and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). This creates the tables, indexes, RLS policies, the `brand-logos` Storage bucket (public read, admin-only write, 1 MB limit, PNG/JPEG/WebP only) and the reorder functions.
3. *(Optional)* Run [`supabase/seed.sql`](supabase/seed.sql) for two sample brands. Delete them from `/admin` once real data exists.
4. **Disable public sign-ups.** *Authentication → Sign In / Providers → Email* → turn **off** "Allow new users to sign up". There is no customer registration; this makes sure nobody can create an Auth account. (RLS would still deny them writes, but there is no reason to leave it open.)
5. **Copy the public config.** *Project Settings → API*: the **Project URL** and the **publishable** (or legacy **anon**) key. These two are safe in the browser. **Do not use the `service_role` / secret key anywhere in this project.** The build refuses to run if it detects one.

## First administrator (secure bootstrap)

An Auth account alone grants nothing. Admin rights come from a row in `public.admin_users`, which can only be written from the SQL editor or with the service role, never from the browser.

1. *Authentication → Users → Add user → Create new user.* Enter an email and a strong password (tick "Auto Confirm User"). Type the password only into the Supabase dashboard.
2. Copy that user's **UID**, then in the SQL editor run:

   ```sql
   insert into public.admin_users (user_id) values ('PASTE-THE-USER-UID-HERE');
   ```
3. Sign in at `https://your-site/admin`. A signed-in user who is *not* in `admin_users` is signed out immediately, and the database rejects their writes regardless of the UI.

To add or remove other administrators, insert or delete rows in `admin_users` the same way. Enabling MFA for admin accounts in Supabase is recommended.

## Configuration

Copy `.env.example` to `.env` for local builds (it is git-ignored). On your host, set the same names as build environment variables.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Publishable/anon key (public) |
| `SITE_URL` | Public site URL, used for canonical links, Open Graph and `sitemap.xml` |
| `SITE_TITLE` | Optional header and page-title name; defaults to `WhatsApp Contact Hub`, so you normally leave it unset. Never use `SITE_NAME`: Netlify reserves it and fills it with the project name |

```bash
npm run build    # writes dist/
npm test         # unit + build tests
npm start        # serve the existing dist/ locally
```

## Deploy to static hosting and a custom domain

The output is the `dist/` folder. It needs two rewrites that are already configured: `/brand/*` → `index.html` and `/admin` → `admin/index.html`.

**Netlify or Cloudflare Pages** (`hosting/_redirects` and `_headers` are copied into `dist/`)
- Build command `npm run build`, publish directory `dist`.
- Add the four environment variables above.

**Vercel**: import the repo; `vercel.json` sets the build, output and rewrites. Add the four variables.

**Custom domain:** add the domain in your host's dashboard, create the DNS records it shows (CNAME for a subdomain, or the A/ALIAS records for an apex domain), wait for HTTPS to be issued, then set `SITE_URL` to `https://your-domain` and redeploy so canonical URLs, Open Graph and the sitemap use it.

GitHub Pages is *not* recommended: it cannot rewrite `/brand/<slug>`.

> Do not deploy until you have reviewed the result. Nothing in this repository deploys or pushes automatically.

## How immediate updates work

- Public pages fetch from Supabase with `cache: 'no-store'` on every load, so there is no hardcoded or build-time content.
- The admin only shows "Saved" after Supabase returns the written row (updates/deletes that affect zero rows, for example because of RLS, are reported as errors).
- After each save the admin broadcasts a `BroadcastChannel` message, so any open public tab in the same browser refreshes at once. Other visitors refresh on tab focus and by a 60-second poll while the tab is visible.
- Logo URLs include the brand's `updated_at` as a version, and each upload uses a fresh file name, so old logos never linger in caches.

## SEO

- Per-page `<title>`, meta description, canonical URL (from `SITE_URL`) and Open Graph tags (set by the page for each brand).
- Clean URLs: `/` and `/brand/<slug>`.
- `robots.txt` disallows `/admin`; the admin page has `noindex` and an `X-Robots-Tag` header.
- `sitemap.xml` is generated **at build time** from the active brands. After adding brands, trigger a redeploy (for example a build hook, optionally on a schedule) to refresh it; the site content itself never needs a redeploy.
- Unknown brand slugs render a "not found" view marked `noindex` (static hosts return HTTP 200 for the rewrite).
- Brand pages render in the browser, which Google handles; non-JS crawlers will see only the shell.

## Security notes

- Only public keys reach the browser. `build.mjs` rejects `service_role` or `sb_secret_` keys.
- RLS is enabled on `brands`, `contacts` and `admin_users`. `anon` has `SELECT` only; writes require `public.is_admin()`.
- Storage: public read of the `brand-logos` bucket; insert/update/delete only for admins; size and MIME limits enforced by the bucket.
- The admin UI is not a security boundary; the database policies are. Hiding `/admin` is not relied upon.
- All database text is rendered with text nodes (no `innerHTML`). A strict Content-Security-Policy is shipped in `_headers`/`vercel.json`. If you add a Supabase custom domain, add it to `connect-src` and `img-src`.
- Phone numbers are validated in the browser and again by database `CHECK` constraints (`^[1-9][0-9]{7,14}$`). Links are `https://wa.me/<digits>`.

## Maintenance

- **Add or change content:** `/admin`. No deploy needed.
- **Schema changes:** add a new numbered file under `supabase/migrations/` and run it in Supabase.
- **Upgrading supabase-js:** replace `src/vendor/supabase.js` with the new UMD build from jsDelivr (`@supabase/supabase-js/dist/umd/supabase.js`) and test the admin.

## Manual steps checklist (need your action)

- [ ] Create the Supabase project and run `0001_init.sql`
- [ ] Turn off public sign-ups
- [ ] Create the first admin user and insert their UID into `admin_users`
- [ ] Set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SITE_URL` on your host (`SITE_TITLE` is optional)
- [ ] Choose a host, connect the domain, deploy (after your review)
- [ ] Replace sample brands with real brands, logos and numbers in `/admin`
- [ ] Set up a build hook if you want `sitemap.xml` refreshed automatically
