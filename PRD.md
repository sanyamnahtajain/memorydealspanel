# PRD — MemoryDeals: Gated B2B Price Catalog for Mobile Accessories Wholesale

**Version:** 1.0
**Date:** 10 July 2026
**Owner:** Anchal (Wholesaler / Admin)
**Status:** Draft for review

---

## 1. Problem Statement

A mobile-accessories wholesaler receives daily price enquiries from many retail business owners. Sharing prices manually (calls/WhatsApp) is slow and error-prone, but publishing prices openly would expose wholesale rates to competitors and the public.

**Goal:** A catalog website where anyone can browse products, but **prices are visible only to customers the wholesaler has explicitly approved**, with time-bound access. The wholesaler manages the entire catalog and customer access from a fast, spreadsheet-like admin panel.

## 2. Users & Roles

| Role | Description | Capabilities |
|---|---|---|
| **Admin (Wholesaler)** | Owner of the platform | Full control: catalog, customers, access approvals, dashboard |
| **Approved Customer** | Retailer whose access request was approved and is unexpired | Browse catalog **with prices** after login |
| **Pending / Expired Customer** | Requested access; not yet approved, rejected, or expired | Browse catalog **without prices**; can (re)request access |
| **Anonymous Visitor** | Not logged in | Browse catalog without prices; can submit access request |

*(Future: Staff sub-admin role with limited permissions — out of scope for v1.)*

## 3. Product Scope — Two Surfaces

1. **Admin Panel** (private, admin-only)
2. **Customer Storefront** (public B2B catalog site, SSR)

---

## 4. Feature List — Admin Panel

### 4.1 Authentication & Security
- F-A1. Admin login with email + password, **mandatory 2FA (TOTP)** — this account guards all pricing data.
- F-A2. Session management: view active sessions, force logout.
- F-A3. Audit log of admin actions (price changes, approvals, deletions) with timestamp.

### 4.2 Category Master
- F-A4. Create / edit / reorder categories (e.g. Chargers, Power Cables, Power Adapters, Power Banks, Cases, Screen Guards, Earphones…).
- F-A5. Category fields: name, slug (auto), display image, sort order, status (Active / Inactive).
- F-A6. **Mark category Inactive** → hides the category and all its products from the storefront instantly (soft hide, no data loss).
- F-A7. Optional sub-categories (one level deep, e.g. Chargers → 20W / 45W / Car Chargers).

### 4.3 Product Master
- F-A8. Create / edit products under a category.
- F-A9. Product fields:
  - Name, SKU/product code, category (+ sub-category), brand
  - Description, specifications (key–value pairs, e.g. Wattage: 20W, Cable Length: 1m)
  - **Wholesale price**, MRP (optional), MOQ (minimum order quantity, optional)
  - Stock status (In Stock / Low / Out of Stock — status only, not full inventory)
  - Status (Active / Inactive), tags (e.g. "New", "Hot Seller")
- F-A10. **Photo upload**: multiple images per product, drag-and-drop, client-side compression, auto thumbnail generation, reorder images, set primary image.
- F-A10a. **Camera capture on phone (key workflow)**: open a product in the admin panel on your phone → tap "Add photos" → camera opens in a **batch-capture mode** — click photo after photo without leaving the camera (shutter → thumbnail strip grows at the bottom → keep shooting). On done: review strip, delete bad shots, auto-compress, and upload all in one go with a per-photo progress indicator.
- F-A10b. **Rapid cataloging mode**: a dedicated mobile flow — pick a category → shoot photos → type name + price → save → "Next product" — designed so a new product can be added from the shop counter in under 30 seconds. Photos upload in the background while you fill details (retry on flaky networks).
- F-A11. **Mark product Inactive** → hidden from storefront, retained in admin.
- F-A12. Duplicate product (clone as starting point for similar SKUs).
- F-A13. Search, filter (category, status, brand, price range) and sort in product list.

### 4.4 Bulk Operations (core differentiator — "Excel/Airtable experience")
- F-A14. **Spreadsheet grid view** of all products: inline cell editing, keyboard navigation (arrows, Tab, Enter), copy-paste from Excel/Google Sheets, fill-down, multi-cell selection.
- F-A15. **Autosave** on cell blur with visible per-row save indicator (saving… / saved ✓ / error ↻ retry). No explicit "Save" button needed.
- F-A16. **Undo/redo** within the editing session.
- F-A17. **Bulk edit**: select many rows → change category / status / price adjustment (e.g. +5% or +₹10 across selection) in one action.
- F-A18. **Bulk delete**: multi-select → soft delete with confirmation showing exact count; 30-day trash with restore.
- F-A19. **Bulk upload via CSV/XLSX**:
  - Downloadable template with all columns.
  - Upload → **preview & validation screen** showing every row with per-cell errors (bad category, missing price, duplicate SKU) *before* anything is committed.
  - Row-level choice: create new vs. update existing (matched by SKU).
  - Import summary report: X created, Y updated, Z skipped with reasons. Nothing partial and silent — foolproof by design.
- F-A20. **Bulk image upload**: zip or multi-file upload where filenames map to SKUs (e.g. `SKU123-1.jpg`), with a match-review screen.
- F-A21. **Export** full catalog to CSV/XLSX anytime (also serves as backup).

### 4.5 Customer & Access Management
- F-A22. Customer list with search/filter by status (Pending / Approved / Rejected / Expired / Blocked).
- F-A23. Customer profile: business name, contact person, phone, email, GST number (optional), city/address, notes (private admin notes).
- F-A24. **Access requests queue**: new "see price" requests appear as notifications; one-click **Approve / Reject** (with optional reason).
- F-A25. **Access expiry**: on approval, set validity (7 / 30 / 90 days / custom / no expiry). Access auto-revokes on expiry; customer sees "access expired — request renewal".
- F-A26. Extend / renew / revoke access anytime.
- F-A27. Block a customer (immediate logout + banned from re-requesting with same phone).
- F-A28. Customer activity: last login, products viewed (basic), request history.
- F-A29. Bulk actions on customers: approve, set expiry, revoke.
- F-A30. Manually add a customer directly (skip the request flow — for known buyers).

### 4.6 Notifications (to Admin)
- F-A31. In-panel notification center with badge count for new access requests.
- F-A32. **WhatsApp and/or email alert** to admin on each new access request (configurable).
- F-A33. Daily digest option instead of per-request pings.

### 4.7 Dashboard
- F-A34. KPIs: total products, active/inactive counts, total customers by status, pending requests, accesses expiring in next 7 days.
- F-A35. Recent activity feed: latest requests, recent logins, recent catalog edits.
- F-A36. Most-viewed products/categories (last 30 days).

### 4.8 Settings
- F-A37. Business profile (name, logo, contact info shown on storefront).
- F-A38. Default access-expiry duration.
- F-A39. Access-request form field configuration (which fields are required).
- F-A40. Notification preferences.

---

## 5. Feature List — Customer Storefront

### 5.1 Public Browsing (no login)
- F-C1. Home page: hero/banner, category grid, featured/new products.
- F-C2. Category pages with product cards (image, name, brand, specs) — **no price anywhere**.
- F-C3. Product detail page: images, description, specs — price area replaced by a **"See Price" button**.
- F-C4. Search and filters (category, brand).
- F-C5. Fully responsive, mobile-first (most retailers will browse on phones).
- F-C6. SEO-friendly SSR pages for products/categories (name, images, specs indexable — prices never in any public payload).

### 5.2 Access Request Flow
- F-C7. Clicking **"See Price"** (logged out) opens a popup form:
  - Business name *(required)*
  - Contact person name *(required)*
  - Phone number *(required, OTP-verified)*
  - GST number *(optional)*
  - Email, city *(optional)*
- F-C8. Phone verified via **SMS/WhatsApp OTP** → prevents junk requests and establishes the login identity.
- F-C9. On submit: "Request received — you'll be notified once approved." Request appears instantly in admin panel + admin gets WhatsApp/email alert.
- F-C10. Customer notified on approval/rejection via WhatsApp/SMS (with login link).
- F-C11. Duplicate-request handling: same phone re-requesting sees current status instead of creating duplicates.

### 5.3 Approved Customer Experience
- F-C12. **Login = phone + OTP** (passwordless — simplest for retailers).
- F-C13. Once logged in and approved (and unexpired): prices visible across all listing and detail pages.
- F-C14. Expiry banner when access is ending soon ("Your access expires in 3 days — request renewal").
- F-C15. Expired/rejected users see catalog without prices + a "Request access / renewal" button.
- F-C16. Simple enquiry action per product: "Enquire on WhatsApp" deep-link with product name pre-filled (v1 ordering happens off-platform).
- F-C17. *(Phase 2)* Price list download as PDF, watermarked with the customer's business name and date.

---

## 6. Security & Anti-Scraping Design (hard requirement)

Prices must be unobtainable without an approved, unexpired session:

1. **Server-side gating, not CSS hiding.** Prices are injected during SSR only when the server has validated the session AND approval status AND expiry. For anonymous/unapproved users the price **never leaves the server** — not in HTML, not in JSON, not in hydration data, not in meta tags.
2. **No public price API.** There is no endpoint that returns a price without an authenticated, approved session. API responses for public pages simply omit the price field.
3. **HttpOnly, Secure, SameSite session cookies** — tokens are not readable by page JavaScript.
4. **Middleware-enforced checks on every request** (session valid → customer approved → not expired → not blocked), not just at login.
5. **Rate limiting & bot defense:** per-IP and per-session rate limits on all routes; stricter limits on the OTP and request-access endpoints; Cloudflare (or similar) in front for bot filtering, WAF, and DDoS protection.
6. **Scraping-behavior detection:** flag sessions that fetch abnormally many product pages per minute; auto-throttle and alert admin (an approved customer's account can also be abused or shared).
7. **Session controls:** limit concurrent sessions per customer; instant revocation on block/expiry.
8. **Search-engine hygiene:** prices never appear in any public render, so crawlers/caches can never index them; no price in structured data (schema.org) markup.
9. **Audit trail:** log which customer viewed which product pages (deters and traces leaks).
10. **OTP abuse protection:** cooldowns, max attempts, per-number daily caps.
11. All traffic HTTPS; security headers (CSP, HSTS); images served via CDN with no pricing metadata.

---

## 7. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Framework** | **Next.js 15 (App Router) + TypeScript** | First-class SSR (the core security requirement), one codebase for storefront + admin + API, huge ecosystem, easy hiring |
| **Database** | **PostgreSQL** | Relational fit (categories → products → prices → customers → access grants), rock-solid |
| **ORM** | **Prisma** (or Drizzle) | Type-safe schema & migrations |
| **Auth** | **Auth.js (NextAuth)** — admin: email+password+TOTP; customers: phone OTP | Session cookies (httpOnly), battle-tested |
| **OTP / SMS / WhatsApp** | **MSG91** or **Twilio**; WhatsApp via **Interakt / AiSensy / WhatsApp Cloud API** | India-friendly delivery and pricing, GST-market fit |
| **Spreadsheet grid (bulk edit)** | **AG Grid** (Community) or **Glide Data Grid** + TanStack Query | Proven Excel-like UX: inline edit, keyboard nav, copy-paste, fill-down — don't build this from scratch |
| **File/Image storage** | **Cloudflare R2** (S3-compatible) + image resizing (next/image or Cloudflare Images) | Cheap egress, CDN-backed, thumbnails |
| **CSV/XLSX import-export** | **SheetJS (xlsx)** + **Zod** row validation | Robust parsing + per-cell validation for the foolproof preview screen |
| **Cache / rate limiting** | **Redis (Upstash)** | Rate limits, OTP counters, session throttling |
| **Edge / security** | **Cloudflare** (DNS, WAF, bot management, CDN) | Anti-scraping outer layer |
| **Hosting** | **Vercel** (simplest) or a VPS (Hetzner/DigitalOcean) with Docker + **Coolify** | Vercel = zero-ops SSR; VPS = lower fixed cost at scale |
| **Managed DB** | **Neon** or **Supabase** Postgres | Backups, branching, zero admin |
| **Monitoring** | Sentry + Vercel/Axiom logs | Error and abuse visibility |

**Why not plain React SPA?** A SPA fetches prices via client-visible APIs — far easier to scrape and directly against the stated requirement. SSR with server-gated data is the correct architecture here.

**Why not WordPress/WooCommerce?** The gated-pricing + expiring-access + Airtable-style bulk editing combo would be a pile of fragile plugins; custom Next.js keeps the security surface small and the UX exactly as specified.

## 8. Data Model (core entities)

```
Category      id, name, slug, image, sortOrder, status, parentId?
Product       id, categoryId, name, sku, brand, description, specs(jsonb),
              price, mrp?, moq?, stockStatus, status, tags[], deletedAt?
ProductImage  id, productId, url, thumbUrl, sortOrder, isPrimary
Customer      id, businessName, contactName, phone(unique), email?, gstNumber?,
              city?, status(pending|approved|rejected|expired|blocked), notes?
AccessGrant   id, customerId, approvedAt, expiresAt?, revokedAt?, grantedBy
AccessRequest id, customerId, createdAt, status, decidedAt?, reason?
Session       id, customerId/adminId, tokenHash, createdAt, lastSeenAt, revokedAt?
AuditLog      id, actorType, actorId, action, entity, entityId, diff(jsonb), at
Notification  id, type, payload(jsonb), readAt?
PageView      id, customerId?, productId, at   (for analytics & scrape detection)
```

## 9. Non-Functional Requirements

- **Performance:** storefront pages < 2s on 4G; grid handles 5,000+ products smoothly (virtualized rows).
- **Scale target v1:** ~500–5,000 SKUs, ~1,000 customers, ~50 concurrent users — modest; single Postgres + SSR handles this easily.
- **Availability:** 99.5%+; daily automated DB backups with tested restore.
- **Localization-ready:** ₹ INR formatting, IST timestamps, GST field validation (15-char format check when provided).
- **Accessibility:** storefront usable on low-end Android phones; admin optimized for desktop.

## 10. Release Plan

**Phase 1 — MVP (~4–6 weeks of build)**
Admin auth + 2FA · categories & products CRUD with photos · spreadsheet grid with inline edit + autosave · CSV import with validation preview · storefront (SSR, no prices public) · access request popup + OTP · approve/reject with expiry · price gating · admin notifications (in-panel + WhatsApp) · basic dashboard.

**Phase 2**
Bulk image upload by SKU · undo/redo & fill-down polish · sub-categories · customer analytics & most-viewed · watermarked PDF price list · daily digest · scrape-detection auto-throttle · trash/restore UI.

**Phase 3 (ideas)**
Per-customer price tiers (different prices for different buyers) · order/enquiry cart · staff sub-admin roles · customer-facing stock alerts · WhatsApp catalog sync.

## 11. Success Metrics

- ≥ 80% of price enquiries self-served via the site within 2 months of launch.
- Access request → decision median time < 1 hour (thanks to instant notifications).
- Bulk edit: admin can update 100 prices in < 5 minutes.
- Zero incidents of price data exposed to unapproved users.

## 12. Open Questions

1. Should different customers ever see **different prices** (tiered pricing)? — affects data model now (answer shifts `price` to a price-list table). Recommended to decide before build.
2. Is off-platform (WhatsApp) ordering fine for v1, or is an enquiry cart needed sooner?
3. Should rejected customers be told a reason, or just "not approved"?
4. Expected catalog size at launch? (Determines whether grid virtualization is a day-one need.)
