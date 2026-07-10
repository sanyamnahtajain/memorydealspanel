"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScaleTap } from "@/components/motion/primitives";
import { logout } from "@/server/auth/actions";

/**
 * Signs the customer out via the canonical `logout` server action (revokes the
 * session + clears the cookie), then routes back to the login screen.
 */
export function AccountLogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <ScaleTap>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await logout();
            router.replace("/account/login");
            router.refresh();
          })
        }
      >
        <LogOut className="size-4" aria-hidden />
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </ScaleTap>
  );
}
