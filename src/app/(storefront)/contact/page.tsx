import type { Metadata } from "next";

import { APP_NAME } from "@/lib/constants";
import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { isCustomer } from "@/server/types/viewer";
import {
  googleOAuthConfigured,
  peekSignupHandoff,
} from "@/server/services/google-auth";
import { ContactPageClient } from "@/components/storefront/contact/ContactPageClient";

export const metadata: Metadata = {
  title: `Contact us — ${APP_NAME}`,
  description: `Write to ${APP_NAME} — we will call you back.`,
};

export const dynamic = "force-dynamic";

/**
 * Contact-us page. ANYONE may write to the shop — including people who are
 * not customers — but only after proving a Google identity:
 *
 *  - a SIGNED-IN customer skips the Google step entirely (their session is
 *    the identity; email may be null for phone customers);
 *  - a Google-verified visitor arrives with the single-use `?g=` handoff the
 *    OAuth callback minted (PEEKED here read-only, exactly like
 *    /account/request-access — the submit action consumes it);
 *  - everyone else sees the Continue-with-Google card.
 *
 * This route sits OUTSIDE the shop-code wall (see src/proxy.ts), so for
 * non-customers it renders a BARE page — no storefront shell, nothing about
 * the catalogue leaks to someone who has not passed the code. Sending a
 * message never creates a Customer and never grants price access.
 */
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const sp = await searchParams;
  const token = typeof sp.g === "string" ? sp.g : "";

  const viewer = await resolveViewer();

  if (isCustomer(viewer)) {
    const customer = await prisma.customer.findUnique({
      where: { id: viewer.customerId },
      select: {
        contactName: true,
        phone: true,
        businessName: true,
        city: true,
        email: true,
      },
    });
    if (customer) {
      return (
        <ContactPageClient
          mode={{
            kind: "customer",
            prefill: {
              name: customer.contactName,
              phone: customer.phone,
              businessName: customer.businessName,
              city: customer.city ?? "",
            },
            email: customer.email,
          }}
        />
      );
    }
  }

  const peek = token ? await peekSignupHandoff(token) : null;
  if (peek) {
    return (
      <ContactPageClient
        mode={{
          kind: "google",
          token,
          email: peek.email,
          name: peek.name,
        }}
      />
    );
  }

  return (
    <ContactPageClient
      mode={{ kind: "gate", googleReady: googleOAuthConfigured() }}
    />
  );
}
