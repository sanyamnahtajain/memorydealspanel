import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { APP_NAME } from "@/lib/constants";

/**
 * Admin two-factor authentication (TOTP / RFC 6238).
 *
 * Uses otplib v13's functional API with its default audited plugins
 * (@noble/hashes crypto, @scure/base base32). Secrets are Base32 strings
 * stored as-is in Admin.totpSecret. All operations are async.
 */

/**
 * Accept codes from the current 30s step plus one step on either side
 * (±30s) to tolerate clock skew between the server and the authenticator.
 */
const EPOCH_TOLERANCE_SECONDS = 30;

/** Generate a fresh Base32 TOTP secret (160-bit, Google Authenticator-compatible). */
export function generateTotpSecret(): string {
  return generateSecret();
}

/**
 * Build the `otpauth://totp/...` provisioning URI for a given secret and
 * admin email. The URI encodes issuer + label so authenticator apps show a
 * meaningful account name.
 */
export function totpAuthUri(secret: string, email: string): string {
  return generateURI({
    issuer: APP_NAME,
    label: email,
    secret,
  });
}

/**
 * Render the provisioning URI as a QR-code PNG data URL (`data:image/png;base64,...`)
 * suitable for direct use in an <img src>. Used during 2FA enrollment.
 */
export async function totpQrDataUrl(
  secret: string,
  email: string,
): Promise<string> {
  const uri = totpAuthUri(secret, email);
  return QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1 });
}

/**
 * Verify a 6-digit token against the secret with a ±1 step window.
 * Returns a plain boolean; never throws (a malformed token/secret is false).
 */
export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  const normalized = token.replace(/\s/g, "");
  if (!secret || !/^\d{6}$/.test(normalized)) {
    return false;
  }
  try {
    const result = await verify({
      secret,
      token: normalized,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    return result.valid;
  } catch {
    return false;
  }
}
