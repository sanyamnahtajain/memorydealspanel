import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PRODUCTION GUARD for the test suite.
 *
 * Many tests create and DELETE rows. Prisma reads DATABASE_URL from `.env`
 * on its own when the variable is not set in the shell, and `.env` may hold
 * the production connection string on a developer machine. So before any
 * test runs, resolve the URL exactly as Prisma would and refuse to start
 * unless it points at a local database (localhost / 127.0.0.1 / ::1).
 *
 * To run the suite with a production `.env`, pass the local URL inline:
 *   DATABASE_URL="mongodb://127.0.0.1:27018/memorydeals?replicaSet=rs0local&directConnection=true" npx vitest run
 */
function urlFromDotEnv(): string | undefined {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m) return m[1]!.replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env — nothing to guard */
  }
  return undefined;
}

export function assertLocalTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? urlFromDotEnv();
  if (!url) return; // no database configured: DB tests fail on their own
  let host = "";
  try {
    host = new URL(url.replace(/^mongodb(\+srv)?:/, "http:")).hostname;
  } catch {
    host = "";
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!local) {
    throw new Error(
      `Refusing to run tests against a non-local database (${host || "unparseable URL"}). ` +
        "The suite deletes rows. Set DATABASE_URL to the local test database inline.",
    );
  }
}
