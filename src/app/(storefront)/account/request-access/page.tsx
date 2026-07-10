"use client";

import { useRouter } from "next/navigation";

import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common";
import { FadeUp } from "@/components/motion/primitives";
import { RequestAccessForm } from "@/components/storefront/RequestAccessSheet";

/**
 * Standalone "request price access" page — the same F-C7 form the "See price"
 * bottom sheet uses, given its own route so it can be linked from the login
 * page and shared directly. On success/close, returns to the account page.
 */
export default function RequestAccessPage() {
  const router = useRouter();

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
            <RequestAccessForm onClose={() => router.push("/account")} />
          </div>
        </FadeUp>
      </div>
    </StorefrontShell>
  );
}
