/**
 * Local development MongoDB replica set (Prisma's MongoDB connector
 * requires a replica set for transactions).
 *
 * Usage:
 *   npm run dev:db
 *
 * Then, in another terminal, export the printed DATABASE_URL and run
 * `npx prisma db push` / `npm run seed` / `npm run dev`.
 *
 * Binary resolution:
 *   1. Prefers the system mongod at /opt/homebrew/bin/mongod (fast, no
 *      download) when it exists and reports a compatible version (>= 5.0).
 *   2. Falls back to letting mongodb-memory-server download a binary.
 *
 * Persistence:
 *   Data files live under .devdb/data with a FIXED port + replica-set
 *   name, so the same data set survives restarts of this script.
 *   (A replica-set config is bound to its host:port, which is why the
 *   port must be stable.) If the data directory ever gets corrupted or
 *   a previously-used mongod version is incompatible with the on-disk
 *   files, delete .devdb/ and re-run — it is disposable dev data.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const SYSTEM_MONGOD = "/opt/homebrew/bin/mongod";
const MIN_MAJOR_VERSION = 5;
const PORT = Number(process.env.DEV_DB_PORT ?? 27717);
const REPL_SET_NAME = "memorydeals-rs";
const DB_NAME = "memorydeals";
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, ".devdb", "data");

/** Returns the system mongod version ("8.0.4") or null if unusable. */
function systemMongodVersion(): string | null {
  if (!existsSync(SYSTEM_MONGOD)) return null;
  const result = spawnSync(SYSTEM_MONGOD, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) return null;
  const match = /db version v(\d+\.\d+\.\d+)/.exec(result.stdout ?? "");
  return match ? match[1] : null;
}

function isCompatible(version: string): boolean {
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) && major >= MIN_MAJOR_VERSION;
}

async function startReplSet(useSystemBinary: boolean): Promise<MongoMemoryReplSet> {
  if (useSystemBinary) {
    process.env.MONGOMS_SYSTEM_BINARY = SYSTEM_MONGOD;
    // The system binary version will rarely equal the library's default
    // "requested" version; we've already checked compatibility ourselves,
    // so silence the noisy mismatch warning path.
    process.env.MONGOMS_SYSTEM_BINARY_VERSION_CHECK = "false";
  } else {
    delete process.env.MONGOMS_SYSTEM_BINARY;
  }

  return MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      name: REPL_SET_NAME,
      dbName: DB_NAME,
      storageEngine: "wiredTiger",
    },
    instanceOpts: [
      {
        port: PORT,
        dbPath: DATA_DIR,
        storageEngine: "wiredTiger",
      },
    ],
  });
}

async function main(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  // Stale lock files from a previous crashed run prevent startup.
  rmSync(path.join(DATA_DIR, "mongod.lock"), { force: true });

  const version = systemMongodVersion();
  let useSystemBinary = false;

  if (version && isCompatible(version)) {
    console.log(`Using system mongod ${version} at ${SYSTEM_MONGOD}`);
    useSystemBinary = true;
  } else if (version) {
    console.warn(
      `System mongod ${version} at ${SYSTEM_MONGOD} is older than v${MIN_MAJOR_VERSION}; ` +
        "falling back to a mongodb-memory-server managed binary (may download on first run)."
    );
  } else {
    console.warn(
      `No usable mongod found at ${SYSTEM_MONGOD}; ` +
        "falling back to a mongodb-memory-server managed binary (may download on first run)."
    );
  }

  let replSet: MongoMemoryReplSet;
  try {
    replSet = await startReplSet(useSystemBinary);
  } catch (err) {
    if (!useSystemBinary) throw err;
    console.warn(
      "System mongod failed to start a replica set; retrying with a downloaded binary.\n" +
        `Reason: ${err instanceof Error ? err.message : String(err)}`
    );
    replSet = await startReplSet(false);
  }

  const base = replSet.getUri(DB_NAME); // mongodb://127.0.0.1:PORT/memorydeals?replicaSet=...
  const url = base.includes("directConnection=")
    ? base
    : `${base}${base.includes("?") ? "&" : "?"}directConnection=true`;

  console.log("\nDev MongoDB replica set is up.");
  console.log(`  data dir : ${DATA_DIR} (persists across runs; delete .devdb/ to reset)`);
  console.log(`  replSet  : ${REPL_SET_NAME} (port ${PORT})`);
  console.log("\nConnection string:\n");
  console.log(`  DATABASE_URL="${url}"`);
  console.log("\nIn another terminal:\n");
  console.log(`  export DATABASE_URL="${url}"`);
  console.log("  npx prisma db push   # sync schema + indexes");
  console.log("  npm run seed         # load sample data");
  console.log("  npm run dev          # start the app");
  console.log("\nPress Ctrl+C to stop.");

  let stopping = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`\nReceived ${signal}, stopping MongoDB...`);
    try {
      await replSet.stop({ doCleanup: false, force: false });
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Keep the event loop alive until a signal arrives.
  setInterval(() => undefined, 1 << 30);
}

main().catch((err) => {
  console.error("Failed to start dev database:", err);
  process.exit(1);
});
