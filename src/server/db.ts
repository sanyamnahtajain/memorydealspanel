import { PrismaClient } from "@prisma/client";

import { withBoundedTimeouts } from "./db-url";

/**
 * Prisma client singleton.
 *
 * Next.js dev mode hot-reloads modules on every change, which would otherwise
 * create a new PrismaClient (and a new Mongo connection pool) per reload.
 * We stash the instance on `globalThis`, which survives hot reloads, and only
 * do so outside production.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Bounded driver timeouts — see db-url.ts for the incident behind this.
    // `undefined` (no DATABASE_URL) falls through to Prisma's own handling.
    datasourceUrl: withBoundedTimeouts(process.env.DATABASE_URL),
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
