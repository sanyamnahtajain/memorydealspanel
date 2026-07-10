# MemoryDeals Panel

Gated B2B price catalog for mobile-accessories wholesale. Anyone can browse the catalog; **prices are visible only to admin-approved customers** with time-bound access. Includes an app-like admin panel (PWA) with spreadsheet-style bulk editing and phone-camera product photography.

📄 Full product spec: [PRD.md](./PRD.md)

## Stack

- **Next.js** (App Router, SSR) + TypeScript + Tailwind CSS
- **shadcn/ui** + Motion (Framer Motion) + Vaul + Embla — app-like UI & animations
- **MongoDB (Atlas)** + Prisma 6 — prices stored as integer paise
- **TanStack Query** + Zod

## Getting started

Requires **Node.js 20+** (`nvm use` picks it up from `.nvmrc`).

```bash
nvm use
npm install
cp .env.example .env            # local DATABASE_URL is pre-filled
./scripts/local-mongo.sh start  # project-local MongoDB replica set (port 27018, data in .localdb/)
npx prisma db push              # sync schema
npm run seed                    # demo data (admin@memorydeals.test / admin1234)
npm run dev
```

The local database is completely separate from any system MongoDB — stop it with `./scripts/local-mongo.sh stop`. For production, point `DATABASE_URL` at MongoDB Atlas instead.

Open [http://localhost:3000](http://localhost:3000).

## Project layout

- `src/app/` — routes (storefront + admin)
- `src/components/ui/` — shadcn/ui components
- `prisma/schema.prisma` — data model (categories, products, customers, access grants, audit log)
- `PRD.md` — product requirements, feature list, security design
