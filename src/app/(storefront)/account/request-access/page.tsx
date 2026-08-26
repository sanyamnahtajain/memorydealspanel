import { googleOAuthConfigured, peekSignupHandoff } from "@/server/services/google-auth";
import { getEntryGate, hasPassedEntryGate } from "@/server/auth/entry-gate";
import { RequestAccessPageClient } from "./RequestAccessPageClient";

export const dynamic = "force-dynamic";

/**
 * Server wrapper. STOREFRONT IS GOOGLE-ONLY when the GOOGLE_* env is present
 * (owner call): a visitor without a `?g=` signup handoff first sees a
 * "Continue with Google" gate; the callback bounces new visitors back here
 * with the single-use token, whose PEEK (read-only) prefills the form — the
 * submit action consumes it authoritatively. Without the env, the classic
 * password form still operates (dev / not-yet-configured environments).
 */
export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const sp = await searchParams;
  const token = typeof sp.g === "string" ? sp.g : "";
  const peek = token ? await peekSignupHandoff(token) : null;
  const googleConfigured = googleOAuthConfigured();
  // The shop code is the OUTERMOST door: when the gate is on and this device
  // has not entered the code yet, the client shows the code screen before the
  // Google gate / form. Server actions enforce it regardless.
  const gate = await getEntryGate();
  const gateRequired = gate.enabled && !(await hasPassedEntryGate(gate));
  return (
    <RequestAccessPageClient
      gateRequired={gateRequired}
      google={peek ? { token, email: peek.email, name: peek.name } : null}
      // With Google configured but no (valid) token yet, the client renders
      // the Google gate instead of the password form. An expired token lands
      // here too — the gate lets the visitor restart the flow in one tap.
      googleGateHref={
        googleConfigured && !peek ? "/auth/google/start?returnTo=/account" : null
      }
    />
  );
}
