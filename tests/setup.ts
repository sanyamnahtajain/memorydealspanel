import { assertLocalTestDatabase } from "./db-guard";
import "@testing-library/jest-dom/vitest";

// Before anything touches Prisma: never the production database.
assertLocalTestDatabase();
