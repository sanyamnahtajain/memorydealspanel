"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common";
import { FadeUp } from "@/components/motion/primitives";
import { GoogleAccessGate, RequestAccessForm } from "@/components/storefront/RequestAccessSheet";

/**
 * Standalone "request price access" page — the same F-C7 form the "See price"
 * bottom sheet uses, given its own route so it can be linked from the login
 * page and shared directly. On success/close, returns to the account page.
 *
 * THE GATE DECISION IS LATCHED ON FIRST RENDER — do not "simplify" it back to
 * reading the prop directly. The signup handoff is single-use: submitting the
 * form CONSUMES it. A server action re-renders its own route, so the very next
 * server render peeks, finds no valid token, and asks for the Google gate. If
 * we followed that prop we would tear down the just-submitted form — success
 * screen and all — and show "Continue with Google" to a customer whose request
 * had in fact been created and who was already signed in. That is the exact
 * "it asks me to sign in with Google again" the owner reported, and it fired
 * however fast the form was filled.
 *
 * Latching is safe: a visitor who genuinely needs the gate gets it on first
 * paint, and clicking it is a full navigation that remounts this component.
 */
export function RequestAccessPageClient({
  google = null,
  googleGateHref = null,
}: {
  google?: { token: string; email: string; name: string | null } | null;
  /** Google-only storefront: when set (configured + no valid token yet), show
   *  the Continue-with-Google gate instead of the password form. */
  googleGateHref?: string | null;
}) {
  const router = useRouter();

  // Captured once, on mount. Later prop changes cannot flip the form away.
  const [gateHref] = React.useState(googleGateHref);
  const [handoff] = React.useState(google);

  return (
    <StorefrontShell>
      <div className="mx-auto max-w-lg py-6 md:py-10">
        <PageHeader
          title="Request price access"
          description="Share your business details and we'll review your request. Once approved, wholesale prices unlock across the catalog."
          backHref="/account"
          backLabel="Account"
        />
        <FadeUp>
          <div className="mt-6 rounded-xl border border-border bg-card p-5 md:p-6">
            {gateHref ? (
              <GoogleAccessGate href={gateHref} />
            ) : (
              <RequestAccessForm onClose={() => router.push("/account")} google={handoff} />
            )}
          </div>
        </FadeUp>
      </div>
    </StorefrontShell>
  );
}
