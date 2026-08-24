import { cache } from "react";

import { prisma } from "@/server/db";
import { MAX_ORDER_VALUE_PAISE } from "@/server/services/orders";
import {
  parseSlabyBranding,
  type SlabyBrandingConfig,
  type SlabyBrandingInput,
} from "@/lib/slaby/branding";
import {
  parseDeliveryRules,
  resolveDeliveryDisclosure,
  type DeliveryDisclosure,
  type DeliveryRules,
} from "@/lib/delivery";

/**
 * Store settings service — reads and mutates the singleton `StoreSettings`
 * (key="default") document, following the SellerTaxProfile pattern: exactly
 * one row, upserted on first read, `cache()`d per request.
 *
 * Currently holds the MINIMUM ORDER VALUE (paise). null/0 ⇒ the feature is
 * off and placement behaves exactly as before. Extend this document for
 * future store-wide knobs rather than adding new singletons.
 *
 * Authorization (`settings.manage`), audit, and revalidation live in
 * `@/server/actions/store-settings`; intrinsic validation lives here.
 */

const SETTINGS_KEY = "default";

const SETTINGS_SELECT = {
  id: true,
  key: true,
  minOrderValuePaise: true,
  slabyBranding: true,
  deliveryRules: true,
  updatedAt: true,
} as const;

export interface StoreSettings {
  id: string;
  key: string;
  minOrderValuePaise: number | null;
  /** Raw JSON — parse with `parseSlabyBranding` (defensive, all-off default). */
  slabyBranding: unknown;
  /** Raw JSON — parse with `parseDeliveryRules` (defensive, off default). */
  deliveryRules: unknown;
  updatedAt: Date;
}

/** Thrown when an update carries an out-of-range minimum order value. */
export class InvalidMinOrderValueError extends Error {
  constructor() {
    super(
      "Minimum order value must be a whole amount between ₹0 and the maximum order value.",
    );
    this.name = "InvalidMinOrderValueError";
  }
}

/** Read the singleton, materialising it with defaults on first access. */
export const getStoreSettings = cache(async (): Promise<StoreSettings> => {
  const existing = await prisma.storeSettings.findUnique({
    where: { key: SETTINGS_KEY },
    select: SETTINGS_SELECT,
  });
  if (existing) return existing;
  // `upsert` (not `create`) to be safe against a concurrent first read.
  return prisma.storeSettings.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY },
    update: {},
    select: SETTINGS_SELECT,
  });
});

/**
 * The effective minimum order value in paise, or null when the feature is off
 * (unset or 0).
 *
 * Reads the row DIRECTLY (not through the `cache()`d getter): order placement
 * must always see the value as of *now* — a React request cache is fine for a
 * page render but must never make an order gate stale.
 */
export async function getMinOrderValuePaise(): Promise<number | null> {
  const row = await prisma.storeSettings.findUnique({
    where: { key: SETTINGS_KEY },
    select: { minOrderValuePaise: true },
  });
  const mov = row?.minOrderValuePaise;
  return typeof mov === "number" && mov > 0 ? mov : null;
}

/**
 * Update the minimum order value. `null` (or 0) disables the minimum. The
 * value is capped by the existing MAX order ceiling so the two can never
 * contradict each other (a minimum above the maximum would brick ordering).
 */
export async function updateMinOrderValue(
  minOrderValuePaise: number | null,
): Promise<StoreSettings> {
  if (minOrderValuePaise !== null) {
    if (
      !Number.isSafeInteger(minOrderValuePaise) ||
      minOrderValuePaise < 0 ||
      minOrderValuePaise > MAX_ORDER_VALUE_PAISE
    ) {
      throw new InvalidMinOrderValueError();
    }
  }
  const value =
    minOrderValuePaise && minOrderValuePaise > 0 ? minOrderValuePaise : null;
  return prisma.storeSettings.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, minOrderValuePaise: value },
    update: { minOrderValuePaise: value },
    select: SETTINGS_SELECT,
  });
}

/**
 * The resolved "Built with Slaby" branding config. Direct read (not the
 * request-cached getter) so an admin toggle reflects on the very next render;
 * absent/malformed JSON resolves to everything-off.
 */
export async function getSlabyBranding(): Promise<SlabyBrandingConfig> {
  const row = await prisma.storeSettings.findUnique({
    where: { key: SETTINGS_KEY },
    select: { slabyBranding: true },
  });
  return parseSlabyBranding(row?.slabyBranding);
}

/** Replace the Slaby branding config (validated by the action's zod schema). */
export async function updateSlabyBranding(
  input: SlabyBrandingInput,
): Promise<StoreSettings> {
  return prisma.storeSettings.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, slabyBranding: input },
    update: { slabyBranding: input },
    select: SETTINGS_SELECT,
  });
}

/**
 * The resolved delivery rules. DIRECT read (not the request-cached getter):
 * order placement freezes the disclosure, so it must see the value as of now.
 */
export async function getDeliveryRules(): Promise<DeliveryRules> {
  const row = await prisma.storeSettings.findUnique({
    where: { key: SETTINGS_KEY },
    select: { deliveryRules: true },
  });
  return parseDeliveryRules(row?.deliveryRules);
}

/** The disclosure the storefront/PDF must show, or null when off. */
export async function getDeliveryDisclosure(): Promise<DeliveryDisclosure | null> {
  return resolveDeliveryDisclosure(await getDeliveryRules());
}

/** Replace the delivery rules (validated by the action's zod schema). */
export async function updateDeliveryRules(input: DeliveryRules): Promise<StoreSettings> {
  return prisma.storeSettings.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, deliveryRules: input },
    update: { deliveryRules: input },
    select: SETTINGS_SELECT,
  });
}
