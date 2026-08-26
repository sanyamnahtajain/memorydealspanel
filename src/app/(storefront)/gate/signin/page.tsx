import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { APP_NAME } from "@/lib/constants";
import { googleOAuthConfigured } from "@/server/services/google-auth";
import { resolveViewer } from "@/server/auth/viewer";
import { isCustomer } from "@/server/types/viewer";
import { GoogleSignInBlock } from "@/components/auth/GoogleSignInBlock";
import { SlabyBadge } from "@/components/slaby/SlabyMark";
import { getSlabyBranding } from "@/server/services/store-settings";
import { slabyPlacementOn } from "@/lib/slaby/branding";

/**
 * The BARE sign-in page for existing customers, reached from the shop-code
 * wall (owner request). While the gate is on, a stranger sees exactly two
 * screens — the wall and this — so like the wall it deliberately renders NO
 * shell: no navbar, no search, no categories. Nothing about the catalogue
 * leaks to someone who has not passed the code or signed in.
 *
 * Google only, per the owner: existing customers are recognised by their
 * linked Google account (or verified matching email) and go straight in.
 * A phone-and-password customer signs in by entering the shop code first —
 * they are Raghav's known customers, so they have it.
 */
export const metadata: Metadata = {
  title: `Sign in — ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function GateSignInPage() {
  // Already signed in — nothing to do here.
  const viewer = await resolveViewer();
  if (isCustomer(viewer)) redirect("/account");

  const googleReady = googleOAuthConfigured();
  const slaby = slabyPlacementOn(await getSlabyBranding(), "login");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <div className="flex flex-col items-center gap-2">
        <Image
          src="/brand/logo.png"
          alt=""
          width={56}
          height={56}
          className="rounded-xl"
          priority
        />
        <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          {APP_NAME}
        </h1>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm ring-1 ring-foreground/5 sm:p-6">
        {googleReady ? (
          <GoogleSignInBlock
            href="/auth/google/start?returnTo=/account"
            headline="Welcome back"
            sub="Sign in with the Google account you used before. You do not need the shop code."
          />
        ) : (
          // Google not configured (dev / misconfigured env): the page must
          // not strand real customers behind a button that cannot exist.
          <p className="text-sm text-muted-foreground">
            Google sign-in is not set up right now. Please enter the shop code
            instead, then sign in with your phone number.
          </p>
        )}
      </div>

      {slaby ? <SlabyBadge placement="login" prefix="Secured by" /> : null}

      <p className="max-w-xs text-center text-xs text-muted-foreground">
        New here, or use a phone number to sign in?{" "}
        <Link
          href="/gate"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Enter the shop code
        </Link>
      </p>
    </main>
  );
}
