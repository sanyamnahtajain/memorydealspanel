import type { Metadata } from "next";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import { CustomerLoginRedirectForm } from "./CustomerLoginRedirectForm";

export const metadata: Metadata = {
  title: "Sign in — MemoryDeals",
  robots: { index: false, follow: false },
};

/**
 * Customer login route (storefront shell). Wires the pure
 * {@link CustomerLoginForm} (via {@link CustomerLoginRedirectForm}) to the
 * `customerLogin` server action; on success it routes to /account.
 */
export default function CustomerLoginPage() {
  return (
    <StorefrontShell>
      <div className="mx-auto flex w-full max-w-sm flex-col justify-center py-10 sm:py-16">
        <FadeUp>
          <CustomerLoginRedirectForm />
        </FadeUp>
      </div>
    </StorefrontShell>
  );
}
