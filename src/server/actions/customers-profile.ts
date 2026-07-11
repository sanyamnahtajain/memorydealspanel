"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { isCustomer } from "@/server/types/viewer";
import { gstinStateCode } from "@/lib/gstin";
import {
  businessProfileSchema,
  type BusinessProfileInput,
  type BusinessProfileResult,
} from "./customers-profile-schema";

/**
 * CUSTOMER-facing business-profile update (account page).
 *
 * A "use server" file may export ONLY async functions — the schema and result
 * type are imported from `./customers-profile-schema`.
 *
 * IDOR SAFETY: the target row is ALWAYS `viewer.customerId` from the resolved
 * session; no client-supplied id is ever accepted or trusted. A non-customer
 * viewer (anon/admin) is rejected outright.
 *
 * GST: a valid GSTIN's first two chars are the buyer's state — we derive
 * `gstStateCode` from it server-side (never trusting a client value). The
 * explicit place-of-supply state is stored separately so the CGST/SGST vs IGST
 * split is correct even for an unregistered buyer with no GSTIN. Clearing the
 * GSTIN clears the derived state too. This is inert while GST is off (the
 * fields simply never feed a tax calc), so writing them is always safe.
 */
export async function updateBusinessProfileAction(
  input: BusinessProfileInput,
): Promise<BusinessProfileResult> {
  try {
    const viewer = await resolveViewer();
    if (!isCustomer(viewer)) {
      return { ok: false, error: "You must be signed in to update your details." };
    }

    const parsed = businessProfileSchema.parse(input);

    const gstNumber = parsed.gstNumber === "" ? null : parsed.gstNumber;
    // Derive the buyer's state from a valid GSTIN; null when cleared.
    const gstStateCode = gstNumber ? gstinStateCode(gstNumber) : null;
    const placeOfSupplyStateCode =
      parsed.placeOfSupplyStateCode === ""
        ? null
        : parsed.placeOfSupplyStateCode;

    await prisma.customer.update({
      // IDOR-safe: only ever this customer's own row.
      where: { id: viewer.customerId },
      data: {
        businessName: parsed.businessName,
        gstNumber,
        gstStateCode,
        placeOfSupplyStateCode,
      },
    });

    // The account page is force-dynamic; revalidate to reflect the saved values.
    revalidatePath("/account");
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        error: error.issues[0]?.message ?? "Please check your details.",
      };
    }
    console.error("[actions/customers-profile] update failed:", error);
    return { ok: false, error: "Could not save your details. Please try again." };
  }
}
