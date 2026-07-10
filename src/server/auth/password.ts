import bcrypt from "bcryptjs";

/**
 * Password hashing for both admin and customer credentials.
 *
 * We use bcrypt at cost factor 12 — a deliberate balance between login
 * latency and brute-force resistance for a B2B app. bcrypt silently
 * truncates input at 72 bytes, which is why our credential schemas cap
 * password length at 72 characters.
 */
const BCRYPT_COST = 12;

/** Hash a plaintext password with a fresh per-hash salt. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 *
 * Never throws: a malformed/empty hash simply returns false so callers can
 * treat "no such user" and "wrong password" identically (avoids user
 * enumeration and keeps timing uniform).
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  if (!hash) {
    return false;
  }
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}
