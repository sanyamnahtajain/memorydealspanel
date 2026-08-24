import { describe, expect, it } from "vitest";

import type { ViewerContext } from "@/server/types/viewer";
import { ANON_VIEWER, canContactOnWhatsApp } from "@/server/types/viewer";
import {
  BUSINESS_PHONE,
  phoneDisplayForViewer,
  whatsappContactHrefForViewer,
  whatsappEnquiryHrefForViewer,
  whatsappNumberForViewer,
} from "./contact";

/**
 * The WhatsApp gate (owner request): the shop's number must be unreachable
 * for anyone without LIVE price access — anon Instagram traffic, and every
 * non-live customer state. Only an approved customer with a live grant (or an
 * admin) ever receives a wa.me link or the number.
 */

const approvedLive: ViewerContext = {
  kind: "customer",
  customerId: "c1",
  priceAccess: true,
  status: "APPROVED",
};

const GATED: { name: string; viewer: ViewerContext }[] = [
  { name: "anonymous visitor", viewer: ANON_VIEWER },
  {
    name: "PENDING customer",
    viewer: { kind: "customer", customerId: "c2", priceAccess: false, status: "PENDING" },
  },
  {
    name: "REJECTED customer",
    viewer: { kind: "customer", customerId: "c3", priceAccess: false, status: "REJECTED" },
  },
  {
    name: "EXPIRED customer",
    viewer: { kind: "customer", customerId: "c4", priceAccess: false, status: "EXPIRED" },
  },
  {
    name: "BLOCKED customer",
    viewer: { kind: "customer", customerId: "c5", priceAccess: false, status: "BLOCKED" },
  },
  {
    // Belt-and-braces: APPROVED status but the grant has lapsed → still gated.
    name: "APPROVED customer whose grant is not live",
    viewer: { kind: "customer", customerId: "c6", priceAccess: false, status: "APPROVED" },
  },
];

describe("WhatsApp contact gate", () => {
  for (const { name, viewer } of GATED) {
    it(`hands NOTHING to a ${name}`, () => {
      expect(canContactOnWhatsApp(viewer)).toBe(false);
      expect(whatsappNumberForViewer(viewer)).toBeNull();
      expect(phoneDisplayForViewer(viewer)).toBeNull();
      expect(whatsappContactHrefForViewer(viewer)).toBeNull();
      expect(
        whatsappEnquiryHrefForViewer(viewer, { productName: "Tempered Glass", sku: "TG-1" }),
      ).toBeNull();
    });
  }

  it("opens for an approved customer with a live grant", () => {
    expect(canContactOnWhatsApp(approvedLive)).toBe(true);
    expect(whatsappNumberForViewer(approvedLive)).toBe(BUSINESS_PHONE.whatsapp);
    expect(phoneDisplayForViewer(approvedLive)).toBe(BUSINESS_PHONE.display);
    expect(whatsappContactHrefForViewer(approvedLive)).toBe(
      `https://wa.me/${BUSINESS_PHONE.whatsapp}`,
    );
    const href = whatsappEnquiryHrefForViewer(approvedLive, {
      productName: "Tempered Glass",
      sku: "TG-1",
    });
    expect(href).toContain(`https://wa.me/${BUSINESS_PHONE.whatsapp}?text=`);
    expect(decodeURIComponent(href!)).toContain("Tempered Glass");
    expect(decodeURIComponent(href!)).toContain("SKU: TG-1");
  });

  it("opens for an admin", () => {
    const admin: ViewerContext = {
      kind: "admin",
      adminId: "a1",
      name: "Raghav",
      roleId: null,
      permissions: ["*"],
    };
    expect(whatsappNumberForViewer(admin)).toBe(BUSINESS_PHONE.whatsapp);
  });

  it("never puts a price in the enquiry text", () => {
    const href = whatsappEnquiryHrefForViewer(approvedLive, {
      productName: "Charger",
      sku: "CH-1",
    })!;
    expect(decodeURIComponent(href)).not.toMatch(/₹|Rs\.?\s?\d|price:/i);
  });
});
