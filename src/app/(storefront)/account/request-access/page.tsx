import { peekSignupHandoff } from "@/server/services/google-auth";
import { RequestAccessPageClient } from "./RequestAccessPageClient";

export const dynamic = "force-dynamic";

/**
 * Server wrapper: a `?g=` signup handoff (Google sign-in, T-google) is PEEKED
 * here — read-only — to prefill the form; the submit action consumes it
 * authoritatively. An expired/absent token falls back to the normal
 * password-based form.
 */
export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const sp = await searchParams;
  const token = typeof sp.g === "string" ? sp.g : "";
  const peek = token ? await peekSignupHandoff(token) : null;
  return (
    <RequestAccessPageClient
      google={peek ? { token, email: peek.email, name: peek.name } : null}
    />
  );
}
