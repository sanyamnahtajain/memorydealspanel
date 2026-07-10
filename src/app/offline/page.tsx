import type { Metadata } from "next";
import Link from "next/link";
import { WifiOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Offline — MemoryDeals",
  description: "You are currently offline.",
};

/**
 * Offline fallback page.
 *
 * Precached by the service worker and served for navigations that fail while
 * the device is offline. Intentionally self-contained (no data, no shell that
 * needs the network) so it always renders. Branded with semantic tokens; the
 * retry link re-attempts the last route via a fresh navigation.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-background px-6 py-16 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <WifiOffIcon className="size-7" aria-hidden />
        </span>

        <h1 className="mt-5 text-lg font-semibold tracking-tight">
          You&rsquo;re offline
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          MemoryDeals can&rsquo;t reach the network right now. Check your
          connection — recently viewed pages may still work.
        </p>

        <Button
          render={<Link href="/" />}
          variant="outline"
          className="mt-6"
        >
          Try again
        </Button>
      </div>
    </main>
  );
}
