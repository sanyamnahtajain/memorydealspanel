"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "./use-is-mobile";

interface ConfirmSheetProps {
  title: string;
  description?: string;
  /**
   * Called when the user confirms. May return a promise — while it is
   * pending the confirm button shows a spinner and the surface cannot be
   * dismissed. On success the surface closes; on rejection it stays open
   * (surface errors to the user inside `onConfirm`, e.g. via a toast).
   */
  onConfirm: () => void | Promise<void>;
  /** Renders the danger styling and a destructive confirm button. */
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Element that opens the confirmation (uncontrolled usage), e.g.
   * `<Button variant="destructive">Delete</Button>`. Base UI merges the
   * trigger props onto it.
   */
  trigger?: React.ReactElement<Record<string, unknown>>;
  /** Controlled open state (optional — omit when using `trigger`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra content rendered between the description and the buttons. */
  children?: React.ReactNode;
}

/**
 * Confirmation surface: a centered Dialog on desktop, a bottom Sheet on
 * mobile (via useIsMobile). Supports an async confirm with loading state
 * and a destructive variant.
 */
export function ConfirmSheet({
  title,
  description,
  onConfirm,
  destructive = false,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  trigger,
  open: controlledOpen,
  onOpenChange,
  children,
}: ConfirmSheetProps) {
  const isMobile = useIsMobile();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const open = controlledOpen ?? uncontrolledOpen;

  const applyOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
    },
    [controlledOpen, onOpenChange]
  );

  /** Open-change requests from the surface itself (backdrop, esc, close). */
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (loading && !next) return; // block dismissal while confirming
      applyOpen(next);
    },
    [applyOpen, loading]
  );

  const handleConfirm = React.useCallback(async () => {
    setLoading(true);
    try {
      await onConfirm();
      applyOpen(false);
    } catch {
      // Keep the surface open so the user can retry; error feedback is
      // the caller's responsibility (toast inside onConfirm).
    } finally {
      setLoading(false);
    }
  }, [applyOpen, onConfirm]);

  const confirmButton = (
    <Button
      variant={destructive ? "destructive" : "default"}
      disabled={loading}
      onClick={handleConfirm}
      data-loading={loading || undefined}
    >
      {loading ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
      {confirmLabel}
    </Button>
  );

  const cancelButton = (
    <Button variant="outline" disabled={loading} onClick={() => handleOpenChange(false)}>
      {cancelLabel}
    </Button>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        {trigger ? <SheetTrigger render={trigger} /> : null}
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="rounded-t-2xl pb-safe"
        >
          <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
          <SheetHeader className="pb-0 text-center">
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          {children ? <div className="px-4 text-sm">{children}</div> : null}
          <SheetFooter className="pt-2">
            {confirmButton}
            {cancelButton}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <DialogFooter>
          {cancelButton}
          {confirmButton}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
