"use client";

import Image from "next/image";

import { APP_NAME } from "@/lib/constants";
import { ShopCodeGate } from "@/components/storefront/ShopCodeGate";
import { SlabyBadge } from "@/components/slaby/SlabyMark";

/**
 * Client half of the wall: brand mark + the shared code card, centred on a
 * bare page. Deliberately NOT the StorefrontShell — the wall must not leak
 * navigation, search or catalogue structure to someone who has not passed it.
 *
 * On success we hard-navigate (location.assign, not router.push) to the
 * destination: the middleware decides per REQUEST, and only a full document
 * request presents the fresh cookie to it. A soft navigation would re-render
 * through the same rewritten route and show the wall again.
 */
export function GatePageClient({
  destination,
  showSlaby = false,
}: {
  destination: string;
  showSlaby?: boolean;
}) {
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
        <ShopCodeGate onPassed={() => window.location.assign(destination)} />
      </div>

      {showSlaby ? (
        <SlabyBadge placement="login" prefix="Secured by" />
      ) : null}

      <p className="max-w-xs text-center text-xs text-muted-foreground">
        Already a customer?{" "}
        <a
          href="/gate/signin"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </a>{" "}
        — you do not need the code.
      </p>
      <p className="max-w-xs text-center text-xs text-muted-foreground">
        Want to ask us something?{" "}
        <a
          href="/contact"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Contact us
        </a>
      </p>
    </main>
  );
}
