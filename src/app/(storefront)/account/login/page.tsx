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
 * Human copy for the Google-callback `?error=` codes. Without this the
 * callback's redirects landed on a BARE sign-in page — to the customer that
 * read as "I signed in and it just asked me to sign in again" (the #1
 * complaint). Unknown codes get the generic retry line.
 */
const GOOGLE_ERROR_COPY: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled. Tap the button to try again.",
  google_bad_state:
    "That sign-in attempt timed out (they only stay valid a few minutes). Tap the button to try again.",
  google_unverified_email:
    "Your Google email isn't verified. Verify it in your Google account, then try again.",
  google_blocked:
    "This account has been blocked. Please contact the store if you think this is a mistake.",
};

function googleErrorMessage(code: string): string {
  return (
    GOOGLE_ERROR_COPY[code] ??
    "Couldn't complete Google sign-in. Please try again."
  );
}

/**
 * Customer login route (storefront shell). Wires the pure
 * {@link CustomerLoginForm} (via {@link CustomerLoginRedirectForm}) to the
 * `customerLogin` server action; on success it routes to /account.
 */
export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const slaby = slabyPlacementOn(await getSlabyBranding(), "login");
  const rawError = (await searchParams).error;
  const errorMessage =
    typeof rawError === "string" && rawError ? googleErrorMessage(rawError) : null;
  return (
    <StorefrontShell>
      <div className="mx-auto flex w-full max-w-sm flex-col justify-center py-10 sm:py-16">
        {errorMessage ? (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {errorMessage}
          </div>
        ) : null}
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
