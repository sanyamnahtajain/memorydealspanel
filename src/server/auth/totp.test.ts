import { describe, it, expect } from "vitest";
import { generate } from "otplib";
import { APP_NAME } from "@/lib/constants";
import {
  generateTotpSecret,
  totpAuthUri,
  totpQrDataUrl,
  verifyTotp,
} from "./totp";

describe("totp", () => {
  it("generates a non-empty Base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it("builds an otpauth URI with issuer and label", () => {
    const secret = generateTotpSecret();
    const uri = totpAuthUri(secret, "admin@memorydeals.test");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`issuer=${encodeURIComponent(APP_NAME)}`);
    expect(uri).toContain(encodeURIComponent("admin@memorydeals.test"));
    expect(uri).toContain(`secret=${secret}`);
  });

  it("renders a PNG data-url QR code", async () => {
    const secret = generateTotpSecret();
    const url = await totpQrDataUrl(secret, "admin@memorydeals.test");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("verifies the current token", async () => {
    const secret = generateTotpSecret();
    const token = await generate({ secret });
    await expect(verifyTotp(secret, token)).resolves.toBe(true);
  });

  it("accepts a token from the previous step (±1 window)", async () => {
    const secret = generateTotpSecret();
    const prevStep = await generate({
      secret,
      epoch: Math.floor(Date.now() / 1000) - 30,
    });
    await expect(verifyTotp(secret, prevStep)).resolves.toBe(true);
  });

  it("rejects a token three steps away (outside the window)", async () => {
    const secret = generateTotpSecret();
    const stale = await generate({
      secret,
      epoch: Math.floor(Date.now() / 1000) - 90,
    });
    await expect(verifyTotp(secret, stale)).resolves.toBe(false);
  });

  it("rejects malformed tokens without throwing", async () => {
    const secret = generateTotpSecret();
    await expect(verifyTotp(secret, "")).resolves.toBe(false);
    await expect(verifyTotp(secret, "12345")).resolves.toBe(false);
    await expect(verifyTotp(secret, "abcdef")).resolves.toBe(false);
    await expect(verifyTotp("", "123456")).resolves.toBe(false);
  });
});
