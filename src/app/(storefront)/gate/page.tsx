import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { APP_NAME } from "@/lib/constants";
import { getEntryGate, hasPassedEntryGate } from "@/server/auth/entry-gate";
import { getSlabyBranding } from "@/server/services/store-settings";
import { slabyPlacementOn } from "@/lib/slaby/branding";
import { GatePageClient } from "./GatePageClient";

/**
 * The shop-code wall — what the middleware shows a stranger at ANY storefront
 * URL while the gate is on (the rewrite keeps their URL; this page renders in
 * its place with `?next=` carrying the destination).
 *
 * This page double-checks the gate itself rather than trusting that it was
 * only ever reached via the rewrite: someone landing on /gate directly while
 * the gate is off (a stale link, the middleware's config cache still catching
 * up after the owner toggled it) is sent straight through instead of being
 * shown a lock the shop has removed. That is the owner's kill-switch working
 * end to end — turning the gate off removes it everywhere, including here.
 */
export const metadata: Metadata = {
  title: `Enter the shop code — ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Only ever bounce to our own pages — a foreign ?next= is discarded. */
function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = safeNext(next);

  const gate = await getEntryGate();
  if (!gate.enabled || (await hasPassedEntryGate(gate))) {
    redirect(destination);
  }

  // Slaby branding (owner request) — rides the existing "Sign-in page"
  // toggle: the gate screens are sign-in-adjacent, and one switch in the
  // branding settings governs all of them together.
  const slaby = slabyPlacementOn(await getSlabyBranding(), "login");

  return <GatePageClient destination={destination} showSlaby={slaby} />;
}
