import * as React from "react";
import { Toaster } from "@/components/ui/sonner";

/**
 * App-wide toast outlet with MemoryDeals defaults: top-center on the
 * usual one-hand phone reach, brand popover surfaces (configured in
 * ui/sonner via theme tokens), close buttons, and a calm 3.5s duration.
 *
 * Mount exactly once per shell (root layout); fire toasts anywhere with
 * `import { toast } from "sonner"`.
 */
export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      closeButton
      duration={3500}
      gap={8}
      visibleToasts={4}
      offset={16}
      mobileOffset={12}
      toastOptions={{
        // Keep the base class from ui/sonner and add brand typography.
        classNames: {
          toast: "cn-toast font-sans shadow-lg",
          title: "text-sm font-medium",
          description: "text-xs text-muted-foreground",
        },
      }}
    />
  );
}
