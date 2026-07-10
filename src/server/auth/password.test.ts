import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("produces a bcrypt hash at cost 12 with a random salt", async () => {
    const hash = await hashPassword("customer1");
    // bcrypt format: $2<a|b>$<cost>$<22-char salt><31-char hash>
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    // Same input hashed twice yields different hashes (unique salts).
    const hash2 = await hashPassword("customer1");
    expect(hash2).not.toBe(hash);
  });

  it("verifies the correct password", async () => {
    const hash = await hashPassword("s3cret-pw");
    await expect(verifyPassword("s3cret-pw", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-pw");
    await expect(verifyPassword("nope", hash)).resolves.toBe(false);
  });

  it("returns false (never throws) for an empty or malformed hash", async () => {
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(verifyPassword("anything", "not-a-bcrypt-hash")).resolves.toBe(
      false,
    );
  });
});
