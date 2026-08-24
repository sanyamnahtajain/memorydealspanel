import type { Metadata } from "next";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import { CustomerLoginRedirectForm } from "./CustomerLoginRedirectForm";
import { googleOAuthConfigured } from "@/server/services/google-auth";
import { SlabyBadge } from "@/components/slaby/SlabyMark";
import { getSlabyBranding } from "@/server/services/store-settings";
import { slabyPlacementOn } from "@/lib/slaby/branding";

export const metadata: Metadata = {
  title: "Sign in — MemoryDeals",
  robots: { index: false, follow: false },
};

/**
 * Customer login route (storefront shell). Wires the pure
 * {@link CustomerLoginForm} (via {@link CustomerLoginRedirectForm}) to the
 * `customerLogin` server action; on success it routes to /account.
 */
export default async function CustomerLoginPage() {
  const slaby = slabyPlacementOn(await getSlabyBranding(), "login");
  return (
    <StorefrontShell>
      <div className="mx-auto flex w-full max-w-sm flex-col justify-center py-10 sm:py-16">
        <FadeUp>
          <CustomerLoginRedirectForm
            googleHref={
              googleOAuthConfigured() ? "/auth/google/start?returnTo=/account" : null
            }
            googleOnly={googleOAuthConfigured()}
          />
        </FadeUp>
        {slaby ? (
          <div className="mt-6 flex justify-center">
            <SlabyBadge placement="login" />
          </div>
        ) : null}
      </div>
    </StorefrontShell>
  );
}
