# MemoryDeals Panel

Gated B2B price catalog for mobile-accessories wholesale. Anyone can browse the catalog; **prices are visible only to admin-approved customers** with time-bound access. Includes an app-like admin panel (PWA) with spreadsheet-style bulk editing and phone-camera product photography.

📄 Full product spec: [PRD.md](./PRD.md)

## Stack

- **Next.js 15** (App Router, SSR) + TypeScript + Tailwind CSS
- **shadcn/ui** + Motion (Framer Motion) + Vaul + Embla — app-like UI & animations
- **PostgreSQL** + Prisma
- **TanStack Query** + Zod

## Getting started

Requires **Node.js 20+** (`nvm use` picks it up from `.nvmrc`).

```bash
nvm use
npm install
cp .env.example .env        # fill in DATABASE_URL etc.
npx prisma migrate dev      # create DB schema
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project layout

- `src/app/` — routes (storefront + admin)
- `src/components/ui/` — shadcn/ui components
- `prisma/schema.prisma` — data model (categories, products, customers, access grants, audit log)
- `PRD.md` — product requirements, feature list, security design
