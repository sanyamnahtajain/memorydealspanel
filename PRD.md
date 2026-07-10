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

> Implemented by the custom **DealSheet** component suite — full spec in §5A.4a (F-G1–F-G22).

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

## 5A. Mobile App-Like Experience & UI/UX (hard requirement — both surfaces)

Both the admin panel and the storefront must feel like a **native app on the phone**, not a website.

### 5A.1 PWA — installable app experience
- F-U1. Both surfaces ship as **Progressive Web Apps**: "Add to Home Screen" prompt, custom app icon and name, splash screen, standalone mode (no browser chrome/URL bar).
- F-U2. **Offline-tolerant admin**: catalog grid and product pages cached; edits and photo uploads made offline are queued and synced when the connection returns, with a visible sync-status pill.
- F-U3. **Push notifications** (Web Push): admin gets a real push on the phone for every new access request — approve/reject directly from the notification's deep link.
- F-U4. Instant back/forward navigation with preserved scroll position (no full-page reloads anywhere).

### 5A.2 App-like navigation & gestures
- F-U5. **Bottom tab bar** on mobile (admin: Dashboard / Products / Requests / Customers; storefront: Home / Categories / Search / Account) with badge counts.
- F-U6. **Bottom sheets** instead of desktop modals on mobile (access-request form, filters, product quick-view) — drag handle, swipe-down to dismiss, snap points.
- F-U7. **Swipe gestures**: swipe between product images; in the admin requests queue, swipe right to approve / left to reject (with undo toast).
- F-U8. **Pull-to-refresh** on lists; infinite scroll with skeleton loaders (no pagination buttons on mobile).
- F-U9. Haptic-style micro-feedback (where supported) on key actions: approve, save, delete.

### 5A.3 Motion & animation system
- F-U10. A consistent motion language (spring-based, 150–300 ms, respects `prefers-reduced-motion`):
  - **Page transitions**: shared-element transition from product card → product detail (image morphs into place) via the View Transitions API.
  - **List animations**: staggered fade-up on category/product grids as they enter the viewport.
  - **Price reveal moment**: when an approved customer logs in, prices animate in with a subtle unblur + count-up — the "unlock" is felt.
  - **Optimistic UI**: approvals, status toggles, and grid edits reflect instantly with animated state changes, then confirm/rollback.
  - **Skeleton screens** everywhere data loads — never a blank page or spinner-only state.
  - Smooth scrolling with momentum; scroll-linked effects kept subtle (sticky category header that condenses on scroll).
- F-U11. Delightful micro-interactions: animated success checkmarks, confetti-free but satisfying "request sent" state, animated notification badge, tactile button press states.

### 5A.4 Crazy custom components (signature UX pieces)
- F-U12. **PriceGate card** (storefront): the price area on every card is a shimmering locked chip — tapping it flips the card to the request form (or unblurs to the price when approved). This is the product's signature interaction.
- F-U13. **Batch camera capturer** (admin): the F-A10a full-screen capture UI — shutter, growing thumbnail strip, tap-to-retake — built as a custom component.
- F-U14. **Mobile grid editor** (admin): the spreadsheet degrades gracefully on phone into an editable card list — tap a field to edit in place, long-press to multi-select for bulk actions, sticky bulk-action bar slides up from the bottom.
- F-U15. **Approval swipe deck** (admin): pending requests presented as swipeable cards (business details + GST + phone) — swipe to decide, tap to expand; clears the queue fast.
- F-U16. **Expiry dial** (admin): setting access duration via a radial/slider control with live preview of the expiry date, plus quick-pick chips (7/30/90 days).
- F-U17. **Smart search overlay** (storefront): full-screen search with recent searches, category chips, instant results as you type, and highlighted matches.

### 5A.4a Custom data grid suite — "DealSheet" (the Excel-like editing system)

A family of custom components built on headless primitives (TanStack Table + TanStack Virtual) so every behavior below is fully ours to control — no licensed grid, no fighting a vendor theme. This component suite implements F-A14–F-A19.

**Core grid — `<DealSheet />`**
- F-G1. **Virtualized rows and columns**: 10,000+ products scroll at 60 fps; only visible cells render.
- F-G2. **Excel keyboard model**: arrows move the active cell; `Tab`/`Shift+Tab` horizontal; `Enter` commits + moves down; `F2` or double-click / start-typing to edit; `Esc` cancels; `Ctrl+A` select all; `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo; `Delete` clears cells.
- F-G3. **Selection model**: single cell, rectangular range (shift+click / shift+arrows / drag), full row(s) via checkbox or row-number gutter, full column via header — with animated selection outline.
- F-G4. **Copy/paste interop with Excel & Google Sheets**: `Ctrl+C` copies TSV; `Ctrl+V` pastes a multi-row/column block from a real spreadsheet, mapped by column position, with a confirm step when the paste extends beyond the current selection ("Paste will fill 40 rows — continue?").
- F-G5. **Fill operations**: fill-down handle (drag the corner of a selection, Excel-style), `Ctrl+D` fill-down, smart series for numbers (₹100, ₹110 → continues +10).
- F-G6. **Typed cells** — each column has a cell type with its own editor and renderer:
  - `text`, `number`, `currency` (₹ formatted, right-aligned), `percent`
  - `select` (category, stock status — searchable dropdown, colored chips)
  - `multi-tag` (tags — token chips with autocomplete)
  - `image` (thumbnail strip; tap opens the image manager / batch camera capture)
  - `toggle` (Active/Inactive — animated switch directly in the cell)
  - `computed/readonly` (e.g. margin % from price vs MRP — shown, never editable)
- F-G7. **Per-cell validation (Zod)**: invalid value → red cell corner + tooltip with the exact error; the cell keeps the draft until fixed or reverted — input is never silently dropped.
- F-G8. **Autosave engine**: edits queue per row and debounce-flush to the server; per-row status pill (`saving… / saved ✓ / failed ↻`); failed rows retry with backoff and never block further editing; optimistic UI with rollback on hard failure.
- F-G9. **Undo/redo stack** spanning cell edits, paste blocks, fill-downs, and bulk actions — undoing a 40-row paste is one `Ctrl+Z`.
- F-G10. **Conflict safety**: if a row changed on the server since load (e.g. edited from the phone), show a non-blocking merge chip on that row instead of overwriting.

**Grid chrome & productivity**
- F-G11. **Column management**: resize (drag), reorder (drag), pin left, hide/show; layout persisted per user.
- F-G12. **Header filters + sort**: type-ahead filter per column, multi-column sort, active-filter chip bar with one-tap clear.
- F-G13. **Saved views**: named filter/sort/column combinations ("Out of stock", "Power banks — price check") switchable from a tab strip above the grid.
- F-G14. **Floating bulk-action bar**: selecting rows slides up a bar with count + actions (Set category, Set status, Adjust price ±% / ±₹, Add tag, Delete) — each action animates across the affected rows.
- F-G15. **Quick row add**: ghost row at the bottom — start typing to create a product inline without leaving the grid.
- F-G16. **Search-in-grid** (`Ctrl+F` scoped to the grid): highlights matches and jumps between them.
- F-G17. **Group by category** view: collapsible category sections with per-group counts; drag a row between groups to recategorize.
- F-G18. **Density toggle** (compact / comfortable) and sticky first column (product name + thumbnail) during horizontal scroll.

**Derived components (same engine, reused)**
- F-G19. **`<ImportPreviewGrid />`**: the CSV/XLSX bulk-upload preview (F-A19) is the same grid in review mode — per-cell error highlighting, editable in place so errors are fixed *before* committing the import, error-only filter toggle, create-vs-update row badges.
- F-G20. **`<MobileCardEditor />`** (F-U14): the grid's row model rendered as editable cards on phones — same autosave engine, same validation, same undo — desktop and mobile never diverge in behavior.
- F-G21. **`<CustomerSheet />`**: customers managed with the same grid system (columns: business, phone, status, expiry — with the Expiry dial as the cell editor); bulk approve / extend / revoke from the bulk-action bar.
- F-G22. **`<TrashGrid />`**: soft-deleted products in review mode with restore action and days-remaining countdown.

**Definition of done (acceptance criteria)**
- Paste 200 rows × 8 columns from Excel → all cells land correctly, invalid ones flagged, in < 2 s.
- An edit is autosaved within 1.5 s of leaving the cell, the indicator confirms it, and it survives a page refresh.
- 5,000-row catalog scrolls, filters, and sorts with no dropped frames on a mid-range laptop.
- Every mouse action has a keyboard equivalent.

### 5A.5 Responsive design rules
- F-U18. Mobile-first breakpoints; every screen designed for 360 px width first, then scaled up. Desktop admin gets the full spreadsheet grid; mobile admin gets the card editor (F-U14) — same data, adapted UI, never a shrunken desktop page.
- F-U19. Touch targets ≥ 44 px, thumb-zone placement for primary actions (bottom third of screen), safe-area insets (notches) respected.
- F-U20. Storefront tested on low-end Android + slow 4G as the baseline device, not the exception.

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
| **UI components** | **Tailwind CSS + shadcn/ui** (customized) + **Vaul** (bottom sheets) + **Embla** (swipeable carousels) | Fast to build, fully ownable/customizable base for the signature components |
| **Animations / motion** | **Motion (Framer Motion)** + **View Transitions API** | Spring physics, gestures (swipe deck, bottom sheets), shared-element page transitions, layout animations |
| **PWA / offline / push** | **Serwist** (service worker for Next.js) + Web Push API + Background Sync | Installable app, offline edit queue, push notifications for access requests |
| **Camera capture** | `getUserMedia` / `<input capture>` + custom batch-capture component + **browser-image-compression** | Multi-shot product photography from the phone with client-side compression before upload |
| **Spreadsheet grid (bulk edit)** | **Custom "DealSheet" suite** (§5A.4a) built on **TanStack Table + TanStack Virtual** + TanStack Query | Headless primitives give full control over the Excel keyboard model, typed cells, autosave engine, and mobile card mode — one engine reused for products, import preview, customers, and trash |
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
- **Accessibility & devices:** both surfaces fully usable on low-end Android phones (app-like PWA experience per §5A); desktop admin additionally gets the full spreadsheet grid. All animations respect `prefers-reduced-motion`.
- **Perceived performance:** 60 fps animations on mid-range phones; interaction feedback < 100 ms via optimistic UI; images lazy-loaded with blur-up placeholders.

## 10. Release Plan

**Phase 1 — MVP (~5–7 weeks of build)**
Admin auth + 2FA · categories & products CRUD with photos · **phone camera batch capture (F-A10a)** · **DealSheet core** (virtualized grid, Excel keyboard model, typed cells, copy-paste, validation, autosave — F-G1–F-G8) · **mobile card editor (F-G20/F-U14)** · CSV import with validation preview (**ImportPreviewGrid**, F-G19) · storefront (SSR, no prices public) · **PWA install + push notifications** · **bottom-sheet access request form + OTP** · approve/reject with expiry · price gating with **PriceGate reveal animation** · core motion system (page transitions, skeletons, optimistic UI) · admin notifications (push + in-panel + WhatsApp) · basic dashboard.

**Phase 2**
Bulk image upload by SKU · rapid cataloging mode (F-A10b) · **approval swipe deck** · **offline edit queue + background sync** · **DealSheet productivity layer** (undo/redo, fill-down, saved views, group-by-category, search-in-grid, quick row add — F-G9–F-G18) · **CustomerSheet + TrashGrid** (F-G21/F-G22) · sub-categories · customer analytics & most-viewed · watermarked PDF price list · daily digest · scrape-detection auto-throttle · trash/restore UI.

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
