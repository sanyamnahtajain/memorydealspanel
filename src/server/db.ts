import { PrismaClient } from "@prisma/client";

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
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
