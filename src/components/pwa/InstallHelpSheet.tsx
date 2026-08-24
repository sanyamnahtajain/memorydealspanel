"use client";

import * as React from "react";
import { CheckCircle2Icon, DownloadIcon, SmartphoneIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/components/common/use-is-mobile";
import { useEngagement } from "@/components/notify/useEngagement";
import {
  IosInstallGuide,
  isIosDevice,
  isStandaloneDisplay,
} from "@/components/pwa/IosInstallGuide";

/**
 * "How do I install this?" — one trigger that opens the right answer for the
 * device it is tapped on, as a bottom sheet on a phone and a dialog on a
 * desktop (the same responsive pairing as `ConfirmSheet`).
 *
 *   iPhone / iPad → the step-by-step guide, because Apple has no install API.
 *   Chromium      → one button, because it does: the deferred
 *                   `beforeinstallprompt` event is all we need.
 *   anything else → a sentence about the browser's own menu, which is the
 *                   honest answer rather than a button that does nothing.
 *
 * WHY THE MODULE-LEVEL LATCH: `beforeinstallprompt` fires once, shortly after
 * the page loads. This sheet mounts much later (it lives inside a success
 * screen the user reaches minutes in), so a listener registered on mount would
 * always miss it. The latch is installed when this module is first evaluated —
 * during hydration — and simply holds the event until someone asks for it.
 * `InstallPrompt` keeps its own listener for its own card; both may capture
 * the same event, and only whichever one the user actually taps calls
 * `prompt()`.
 *
 * The install-state storage keys are `InstallPrompt`'s (`md-pwa-installed` /
 * `md-pwa-admin-installed`) — that file does not export them, so they are
 * repeated here rather than duplicating the flag under a new name, which would
 * make the two surfaces disagree about whether the app is installed.
 */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

type InstallVariant = "storefront" | "admin";

const INSTALLED_KEY: Record<InstallVariant, string> = {
  storefront: "md-pwa-installed",
  admin: "md-pwa-admin-installed",
};

function markInstalled(variant: InstallVariant) {
  try {
    window.localStorage.setItem(INSTALLED_KEY[variant], "1");
  } catch {
    /* storage unavailable — the flag simply won't persist */
  }
}

/* ------------------------------------------------------------------ */
/* the deferred-prompt latch                                           */
/* ------------------------------------------------------------------ */

type Listener = () => void;

let deferred: BeforeInstallPromptEvent | null = null;
let wired = false;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function wireLatch() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress Chrome's mini-infobar; we offer the install ourselves.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

// Installed as early as this module is evaluated, which is the whole point.
wireLatch();

function subscribeLatch(listener: Listener): () => void {
  wireLatch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function clearDeferred() {
  deferred = null;
  emit();
}

/** The captured install event, or null when this browser has not offered one. */
function useDeferredPrompt(): BeforeInstallPromptEvent | null {
  return React.useSyncExternalStore(
    subscribeLatch,
    () => deferred,
    () => null,
  );
}

/* ------------------------------------------------------------------ */
/* body                                                                */
/* ------------------------------------------------------------------ */

function InstallHelpBody({
  variant,
  appName,
}: {
  variant: InstallVariant;
  appName: string;
}) {
  const engagement = useEngagement(variant);
  const prompt = useDeferredPrompt();
  const [busy, setBusy] = React.useState(false);
  const [installed, setInstalled] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [ios] = React.useState(() => isIosDevice());
  const [standalone] = React.useState(() => isStandaloneDisplay());

  const install = React.useCallback(async () => {
    if (!prompt) return;
    setBusy(true);
    setError(null);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        markInstalled(variant);
        engagement.markSatisfied("install");
        setInstalled(true);
        clearDeferred();
        return;
      }
      // A dismissed prompt cannot be shown again with the same event, so drop
      // it and fall through to the browser-menu instructions below.
      setError("You closed the box. You can still add it from the browser menu.");
      clearDeferred();
    } catch {
      setError("Could not add the app. Please try again.");
      clearDeferred();
    } finally {
      setBusy(false);
    }
  }, [engagement, prompt, variant]);

  if (installed) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-success/35 bg-success/10 p-3">
        <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">Added.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Open {appName} from your home screen from now on.
          </p>
        </div>
      </div>
    );
  }

  if (standalone) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3">
        <SmartphoneIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <p className="text-sm text-foreground">
          You are already using the installed app. Nothing to do.
        </p>
      </div>
    );
  }

  if (ios) {
    return <IosInstallGuide appName={appName} />;
  }

  if (prompt) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-foreground">
          Add {appName} to your home screen. It opens faster and you can get
          alerts.
        </p>
        <Button size="lg" onClick={install} disabled={busy} className="w-full">
          {busy ? <Spinner size="sm" label="" /> : <DownloadIcon aria-hidden />}
          {busy ? "Adding…" : "Add to home screen"}
        </Button>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
      <p className="text-sm leading-relaxed text-foreground">
        You can add {appName} from your browser&apos;s own menu.
      </p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>
          Chrome or Edge: open the menu (three dots at the top right) and choose{" "}
          <span className="font-medium text-foreground">Install</span>.
        </li>
        <li>
          Safari on a Mac: open{" "}
          <span className="font-medium text-foreground">File</span>, then{" "}
          <span className="font-medium text-foreground">Add to Dock</span>.
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        If you do not see it, this browser cannot add apps. Try Chrome or
        Safari.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* surface                                                             */
/* ------------------------------------------------------------------ */

export interface InstallHelpSheetProps {
  /** Your own trigger element. Defaults to a small outline button. */
  trigger?: React.ReactElement<Record<string, unknown>>;
  /** Label for the default trigger. */
  label?: string;
  /** Which of the two installable apps this is. */
  variant?: InstallVariant;
  /** Name shown in the copy. */
  appName?: string;
  /** Controlled open state (optional — omit when using `trigger`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * A trigger plus the right install help for this device.
 */
export function InstallHelpSheet({
  trigger,
  label = "How to install",
  variant = "storefront",
  appName = "The Memory Deals",
  open: controlledOpen,
  onOpenChange,
  className,
}: InstallHelpSheetProps) {
  const isMobile = useIsMobile();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (controlledOpen === undefined) setUncontrolledOpen(next);
    },
    [controlledOpen, onOpenChange],
  );

  const triggerNode = trigger ?? (
    <Button variant="outline" size="sm" className={className}>
      <SmartphoneIcon aria-hidden />
      {label}
    </Button>
  );

  const title = "Add to home screen";
  const description = "Open the shop in one tap, straight from your phone.";

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger render={triggerNode} />
        <SheetContent
          side="bottom"
          showCloseButton
          className="max-h-[88dvh] overflow-y-auto rounded-t-2xl pb-safe"
        >
          <div
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted"
          />
          <SheetHeader className="pb-0 text-center">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <InstallHelpBody variant={variant} appName={appName} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={triggerNode} />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <InstallHelpBody variant={variant} appName={appName} />
      </DialogContent>
    </Dialog>
  );
}

export default InstallHelpSheet;
