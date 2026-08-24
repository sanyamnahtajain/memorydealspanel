"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { accessCopy } from "@/lib/access-status";
import { requestRenewalAction } from "@/server/actions/access";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner, StatusChip, useIsMobile } from "@/components/common";

/**
 * RenewAccessDialog — the ONE-TAP renewal surface for a signed-in customer
 * whose access has lapsed (expired) or whose last request was declined
 * (rejected). No form, no field re-entry: a single primary action calls
 * {@link requestRenewalAction}, which files a renewal-flagged request from
 * the record we already hold and rings the admin.
 *
 * Bottom Sheet on mobile / centered Dialog on desktop (RequestAccessSheet's
 * responsive pattern). Holds NO pricing.
 */

export type RenewAccessState = "expired" | "rejected";

/* ------------------------------------------------------------------ */
/* Illustrations (EmptyState art style: token strokes, ~96px)          */
/* ------------------------------------------------------------------ */

function HourglassIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      {/* ground */}
      <path
        d="M22 84h76"
        className="stroke-border"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      {/* caps */}
      <path
        d="M42 16h36M42 78h36"
        className="stroke-muted-foreground"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* glass */}
      <path
        d="M46 20h28v8c0 8-6 12-11 16l-3 3-3-3c-5-4-11-8-11-16v-8ZM46 74h28v-8c0-8-6-12-11-16l-3-3-3 3c-5 4-11 8-11 16v8Z"
        className="fill-muted stroke-muted-foreground"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* sand: all run down */}
      <path
        d="M52 66c0-5 4-8 8-11 4 3 8 6 8 11v4H52v-4Z"
        className="fill-primary/60"
      />
      <path
        d="M60 44v14"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 5"
      />
      {/* hint sparkles */}
      <path
        d="M94 26l4 4M98 26l-4 4M22 34v6M19 37h6"
        className="stroke-primary/60"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RefreshIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      {/* ground */}
      <path
        d="M22 84h76"
        className="stroke-border"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      {/* disc */}
      <circle cx="60" cy="46" r="28" className="fill-muted" />
      {/* circular refresh arrows */}
      <path
        d="M78 40a19 19 0 0 0-33-6"
        className="stroke-muted-foreground"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M45 26v9h9"
        className="stroke-muted-foreground"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M42 52a19 19 0 0 0 33 6"
        className="stroke-primary"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M75 66v-9h-9"
        className="stroke-primary"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* hint sparkles */}
      <path
        d="M96 24l4 4M100 24l-4 4M20 32v6M17 35h6"
        className="stroke-primary/60"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SentIllustration(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      {/* ground */}
      <path
        d="M22 84h76"
        className="stroke-border"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      {/* disc */}
      <circle
        cx="60"
        cy="46"
        r="28"
        className="fill-success/10 stroke-success/40"
        strokeWidth="2"
      />
      {/* check */}
      <path
        d="M47 47l9 9 17-19"
        className="stroke-success"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* confetti */}
      <path
        d="M94 24l4 4M98 24l-4 4M22 30v6M19 33h6"
        className="stroke-primary/60"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="98" cy="52" r="2" className="fill-primary/60" />
    </svg>
  );
}

const STATE_ILLUSTRATIONS: Record<
  RenewAccessState,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  expired: HourglassIllustration,
  rejected: RefreshIllustration,
};

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

type Phase =
  | { kind: "idle" }
  | { kind: "success"; duplicate: boolean }
  | { kind: "error"; message: string };

interface RenewAccessContentProps {
  state: RenewAccessState;
  onClose: () => void;
  onRequested?: () => void;
}

function RenewAccessContent({
  state,
  onClose,
  onRequested,
}: RenewAccessContentProps) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [pending, startTransition] = React.useTransition();
  const onRequestedRef = React.useRef(onRequested);
  React.useEffect(() => {
    onRequestedRef.current = onRequested;
  }, [onRequested]);

  const copy = accessCopy(state);
  const Illustration = STATE_ILLUSTRATIONS[state];

  const submit = React.useCallback(() => {
    startTransition(async () => {
      try {
        const result = await requestRenewalAction();
        if (result.ok) {
          setPhase({ kind: "success", duplicate: result.duplicate });
          toast.success(
            result.duplicate
              ? "Already in the queue — we'll get to it shortly."
              : "Renewal request sent!",
          );
          onRequestedRef.current?.();
        } else {
          setPhase({ kind: "error", message: result.error });
        }
      } catch {
        setPhase({
          kind: "error",
          message: "Could not send your request. Please try again.",
        });
      }
    });
  }, []);

  if (phase.kind === "success") {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <motion.div
          className="text-muted-foreground"
          initial={reduced ? false : { scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 24 }}
        >
          <SentIllustration className="h-24 w-30" />
        </motion.div>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-foreground">
            {phase.duplicate ? "You're already in the queue" : "Request sent!"}
          </h3>
          <p className="max-w-xs text-sm text-pretty text-muted-foreground">
            {phase.duplicate
              ? "Already in the queue — we'll get to it shortly."
              : "We'll notify you once it's renewed — usually within a business day."}
          </p>
        </div>
        <StatusChip variant="pending" label="Under review" />
        <Button variant="outline" onClick={onClose} className="mt-2 w-full">
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <motion.div
        className="text-muted-foreground"
        initial={reduced ? false : { y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <Illustration className="h-24 w-30" />
      </motion.div>

      <p className="max-w-xs text-sm text-pretty text-muted-foreground">
        No forms to fill — one tap files your renewal from the details we
        already have, and we&apos;ll take it from there.
      </p>

      {phase.kind === "error" ? (
        <p
          role="alert"
          className="w-full rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {phase.message}
        </p>
      ) : null}

      <Button
        type="button"
        size="lg"
        className="mt-1 w-full"
        disabled={pending}
        onClick={submit}
      >
        {pending ? <Spinner size="sm" label="" /> : null}
        {pending
          ? "Sending…"
          : phase.kind === "error"
            ? "Retry"
            : (copy.ctaLabel ?? "Request renewal")}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Responsive shell                                                    */
/* ------------------------------------------------------------------ */

export interface RenewAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which lapsed state the viewer is in — drives copy + illustration. */
  state: RenewAccessState;
  /** Called once a renewal request is filed (fresh or duplicate) — e.g. the
   *  useAccessStatus `refresh`, so every mounted surface repaints. */
  onRequested?: () => void;
}

/**
 * Controlled renewal surface: bottom sheet on mobile, dialog on desktop.
 * Content remounts on every open so a previous success/error never lingers.
 */
export function RenewAccessDialog({
  open,
  onOpenChange,
  state,
  onRequested,
}: RenewAccessDialogProps) {
  const isMobile = useIsMobile();
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  const copy = accessCopy(state);
  // Remount the content on each open so a previous success/error doesn't linger.
  const contentKey = open ? "open" : "closed";

  const body = (
    <RenewAccessContent
      key={contentKey}
      state={state}
      onClose={close}
      onRequested={onRequested}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton
          className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-safe"
        >
          <div
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted"
          />
          <SheetHeader className="pb-1 text-center">
            <SheetTitle>{copy.title}</SheetTitle>
            <SheetDescription>{copy.body}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
