# Deployment runbook — The Memory Deals

Production deployment guide. The app is a single Next.js (App Router) project serving both the storefront and the admin panel, backed by MongoDB. Prices are gated server-side; there is no payment integration.

## 0. Prerequisites
- Node.js 20+ (see `.nvmrc`)
- A domain (e.g. `thememorydeals.com`)
- Accounts: MongoDB Atlas, Cloudflare (R2 + Turnstile + DNS), Upstash (Redis), and either Vercel or a VPS.

## 1. Provision services (all have free tiers)

### MongoDB Atlas (database)
1. Create an **M0** (free) cluster — pick the Mumbai (ap-south-1) region for India.
2. Database user + password; Network Access → allow your host (or 0.0.0.0/0 for Vercel, then restrict).
3. Copy the `mongodb+srv://…` connection string → `DATABASE_URL` (append `/memorydeals`).
4. **Prisma + MongoDB needs a replica set** — Atlas clusters are replica sets by default (✓).
5. Enable automated backups (paid tiers) once live.

### Cloudflare R2 (product images)
1. Create a bucket `memorydeals-images`; enable public access (or a public r2.dev / custom domain).
2. Create an API token (Object Read & Write) → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_PUBLIC_URL`.

### Upstash Redis (rate limiting)
1. Create a Redis database → `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
2. Without these the app falls back to an in-memory limiter (fine for a single instance; use Upstash for serverless/multi-instance so limits are shared).

### Cloudflare Turnstile (bot protection on the access-request form)
1. Add a site → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
2. When unset, the form works without a challenge (dev behaviour).

### Web Push (admin notifications) — VAPID
1. `npx web-push generate-vapid-keys` → `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
2. Also expose the public key to the browser: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (= the same public key).
3. Set `VAPID_SUBJECT="mailto:you@domain"`.

## 2. Environment variables
Copy `.env.example` and fill every value. Required for a real deployment:
`DATABASE_URL`, `AUTH_SECRET` (`openssl rand -base64 32`), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `CRON_SECRET` (`openssl rand -hex 32`).
Recommended: R2 (images), Upstash (rate limits), Turnstile (bot protection), VAPID (push).
Also edit `src/lib/constants.ts` `CONTACT` with your real email/phone/address.

## 3. Database schema + first admin
```bash
npm ci
npx prisma db push          # creates collections + indexes (no SQL migrations on Mongo)
npm run seed                # OPTIONAL demo data — DO NOT run on a real production DB you want empty
```
**Bootstrap the first admin (Owner):** the seed creates `admin@memorydeals.test` / `admin1234` and the Owner role. For production, either run the seed once then change the password + email via `/admin/users`, or insert one Admin with a bcrypt-hashed password and the Owner role directly. The migration `scripts/migrate-brands.mjs` links any legacy free-text brands to the Brand master (idempotent).

## 4A. Deploy on Vercel (simplest)
1. Import the repo. Framework: Next.js. Node 20.
2. Add all env vars (Project → Settings → Environment Variables).
3. Deploy. Point your domain at Vercel; set `NEXT_PUBLIC_SITE_URL` to the domain.
4. **Cron:** `vercel.json` defines the daily expiry sweep (`/api/cron/expiry`). Ensure the cron sends the `x-cron-secret` header = `CRON_SECRET` (Vercel Cron + a check in the route).
5. Vercel's Hobby plan is non-commercial — use **Pro** for the live business.

## 4B. Deploy on a VPS (cheaper at scale)
1. Node 20 + a process manager (PM2) or Docker + Coolify.
2. `npm ci && npm run build && npm start` (port 3000) behind Nginx/Caddy (TLS).
3. Put **Cloudflare** in front (DNS proxied) for WAF, bot filtering, CDN, DDoS.
4. Schedule the cron: `curl -H "x-cron-secret: $CRON_SECRET" https://DOMAIN/api/cron/expiry` daily.

## 5. Security posture (already in the app — verify after deploy)
- Prices are server-gated (never in an anonymous payload). Verified by invariant + adversarial tests.
- Security headers (CSP, HSTS, nosniff, frame-deny, referrer-policy) applied in `src/middleware.ts` via `src/server/security/headers.ts` — confirm CSP allows your R2 image host + Turnstile.
- Sessions are httpOnly/Secure/SameSite cookies with DB-backed revocation; admin has TOTP.
- Rate limits on login, request-access, add-to-cart, place-order.
- Orders are server-authoritative (client price/qty ignored); IDOR-protected.
- Set Atlas backups + a tested restore. Consider Sentry (`@sentry/nextjs`) for error visibility.

## 6. Go-live checklist
- [ ] `npm run build` passes locally (it does).
- [ ] All env vars set in the host; `CONTACT` details updated.
- [ ] `prisma db push` run against the production Atlas DB.
- [ ] First admin secured (password/email changed, TOTP enrolled).
- [ ] Domain + TLS live; `NEXT_PUBLIC_SITE_URL` correct; Cloudflare in front.
- [ ] Turnstile keys set; test the request-access form.
- [ ] R2 image upload works from the product editor; CSP allows the image host.
- [ ] Expiry cron scheduled and authorised (`CRON_SECRET`).
- [ ] Web Push: enable notifications as admin, confirm a test push.
- [ ] Smoke test: browse storefront (no prices as guest) → request access → approve in admin → prices unlock → build a cart → place an order → see it in `/admin/orders`.
