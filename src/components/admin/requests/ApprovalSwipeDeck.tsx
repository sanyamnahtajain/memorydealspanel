"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "motion/react";
import {
  CheckIcon,
  CheckCheck as CheckCheckIcon,
  ListChecks as ListChecksIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  ReceiptIcon,
  UserIcon,
  XIcon,
  Clock as ClockIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, StatusChip, useIsMobile } from "@/components/common";
import { springs } from "@/components/motion/tokens";
import { ViewCustomerButton } from "@/components/admin/requests/ViewCustomerButton";
import {
  CustomerDetailModal,
  type CustomerDetailSeed,
} from "@/components/admin/customers/CustomerDetailModal";
import {
  ExpiryDial,
  expiryValueToInput,
  type ExpiryValue,
} from "@/components/admin/ExpiryDial";
import { DEFAULT_ACCESS_EXPIRY_DAYS } from "@/lib/constants";
import {
  matchesReviewFilter,
  NO_ORDER_REJECT_REASON,
  REVIEW_FILTERS,
  type AccessReview,
  type ReviewFilterKey,
} from "@/lib/access-review";
import {
  AccessReviewLine,
  AccessReviewNotice,
  OverrideReasonField,
  ReviewAccentBar,
  ReviewLevelPill,
  suggestedActions,
  useApprovalGuard,
} from "@/components/admin/requests/AccessReview";
import {
  approveAccessAction,
  rejectAccessAction,
  snoozeAccessAction,
  bulkApproveAccessAction,
  bulkRejectAccessAction,
} from "@/server/actions/access";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PendingRequest {
  /** AccessRequest id. */
  id: string;
  customerId: string;
  /** Filed by an already-known customer re-requesting lapsed access. */
  renewal: boolean;
  /**
   * Set when this request also asks to CONNECT a Google sign-in to an existing
   * customer. Approving performs that link, so the admin must be able to see
   * it — this is the moment a human vouches for an identity we could not
   * prove. Never show it as a plain renewal.
   */
  linkGoogleEmail: string | null;
  businessName: string;
  contactName: string;
  /** Canonical +91… phone. */
  phone: string;
  gstNumber: string | null;
  city: string | null;
  /** ISO timestamp the request was submitted. */
  createdAt: string;
  /**
   * Order + approval history and its verdict (owner request) — so "approved
   * twice, never ordered" is on the card BEFORE anyone taps Approve.
   */
  review?: AccessReview | null;
}

export interface ApprovalSwipeDeckProps {
  requests: PendingRequest[];
  /** True when a page-level search is active — changes the empty-state wording
   * from "all caught up" to "no matches" (the list was narrowed by a query). */
  searching?: boolean;
}

type Decision = "approve" | "reject" | "later";

const SWIPE_THRESHOLD = 96;
const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function defaultExpiry(): ExpiryValue {
  return { kind: "days", days: DEFAULT_ACCESS_EXPIRY_DAYS };
}

/**
 * What a request row already knows about its customer, in the shape
 * `CustomerDetailModal` seeds itself from. Only the id is load-bearing — the
 * rest just paints the modal while the full profile loads.
 */
export function pendingRequestSeed(request: PendingRequest): CustomerDetailSeed {
  return {
    id: request.customerId,
    businessName: request.businessName,
    contactName: request.contactName,
    phone: request.phone,
    gstNumber: request.gstNumber,
    city: request.city,
  };
}

/* ------------------------------------------------------------------ */
/* Deck                                                                */
/* ------------------------------------------------------------------ */

/**
 * Pending access requests as an interactive review surface.
 *
 * - Mobile: a swipeable card deck (motion drag). Swipe right → approve
 *   (opens the ExpiryDial to pick validity, then confirms); swipe left →
 *   reject (optional reason); tap → expand full details.
 * - Desktop / accessibility: a plain list with explicit Approve / Reject
 *   buttons — the same actions, no gesture required.
 *
 * Decisions remove the card optimistically and animate out; an Undo toast
 * lets the admin re-queue the request before the decision "settles" (the
 * server mutation is deferred until the toast is dismissed or expires).
 */
export function ApprovalSwipeDeck({ requests, searching = false }: ApprovalSwipeDeckProps) {
  const isMobile = useIsMobile();
  const [queue, setQueue] = React.useState<PendingRequest[]>(requests);

  // Re-sync the local optimistic queue when the server sends a fresh list
  // (e.g. after revalidate). Done during render via the "store previous
  // value" pattern rather than an effect, so there is no cascading re-render.
  const [prevRequests, setPrevRequests] = React.useState(requests);
  if (prevRequests !== requests) {
    setPrevRequests(requests);
    setQueue(requests);
  }

  // Approve flow: which request is awaiting an expiry choice.
  const [approving, setApproving] = React.useState<PendingRequest | null>(null);
  // Reject flow: ONE dialog for cards, rows and the approve dialog's
  // "Reject instead" — which arrives with a reason already picked.
  const [rejecting, setRejecting] = React.useState<{
    request: PendingRequest;
    reason: string;
  } | null>(null);
  const askReject = React.useCallback(
    (request: PendingRequest, reason?: string) =>
      setRejecting({ request, reason: reason ?? "" }),
    [],
  );

  // History filter (owner request): with 100+ open requests, the shops that
  // never order after approval must be findable in one tap.
  const [filter, setFilter] = React.useState<ReviewFilterKey>("all");

  /**
   * Which customer profile is open, if any. ONE modal for the whole deck —
   * both the swipe card and the desktop list drive this same piece of state.
   *
   * Opening it is pure view state: it touches neither `queue` nor
   * `pendingCommits`, so a decision sitting in its 4.5s Undo window keeps its
   * timer and commits exactly once, whatever an admin does in the modal.
   */
  const [detailFor, setDetailFor] = React.useState<CustomerDetailSeed | null>(
    null,
  );
  const viewCustomer = React.useCallback((request: PendingRequest) => {
    setDetailFor(pendingRequestSeed(request));
  }, []);

  /**
   * Decisions in flight: each waits out the Undo window, then commits.
   *
   * The commit function is kept alongside the timer so that unmounting can
   * FLUSH it rather than drop it — see the cleanup below.
   */
  const pendingCommits = React.useRef(
    new Map<
      string,
      {
        timer: ReturnType<typeof setTimeout>;
        commit: () => Promise<void>;
        undone: boolean;
      }
    >(),
  );

  React.useEffect(() => {
    const inFlight = pendingCommits.current;
    return () => {
      // BUG THIS FIXES: this used to clearTimeout() and walk away, which
      // silently DISCARDED the decision. The admin saw "moved to Later", the
      // row left the queue, and nothing was ever written — so the request
      // reappeared in Pending on the next load. Any unmount inside the 4.5s
      // window did it, and with the live-events feed refreshing this page all
      // day, that happened often enough for staff to report Later as flaky.
      //
      // Leaving the page ends the chance to undo, so the honest behaviour is
      // to commit immediately. Fire-and-forget: each commit already reports
      // its own failure via a toast.
      for (const entry of inFlight.values()) {
        clearTimeout(entry.timer);
        if (!entry.undone) void entry.commit();
      }
      inFlight.clear();
    };
  }, []);

  const removeFromQueue = React.useCallback((id: string) => {
    setQueue((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const restoreToQueue = React.useCallback(
    (request: PendingRequest) => {
      const entry = pendingCommits.current.get(request.id);
      if (entry) {
        // Mark it undone BEFORE deleting: the unmount flush and the timer
        // both consult this flag, so an undo can never be re-committed.
        entry.undone = true;
        clearTimeout(entry.timer);
        pendingCommits.current.delete(request.id);
      }
      setQueue((prev) =>
        prev.some((r) => r.id === request.id)
          ? prev
          : [request, ...prev].sort(
              (a, b) => b.createdAt.localeCompare(a.createdAt), // newest first
            ),
      );
    },
    [],
  );

  /** Commit an approval to the server once the Undo window has elapsed. */
  const commitApprove = React.useCallback(
    async (
      request: PendingRequest,
      expiry: ExpiryValue,
      override: { reason: string } | undefined,
    ) => {
      const result = await approveAccessAction({
        customerId: request.customerId,
        expiry: expiryValueToInput(expiry),
        override,
      });
      if (!result.ok) {
        toast.error(`Couldn't approve ${request.businessName}`, {
          description: result.error,
        });
        restoreToQueue(request);
      }
    },
    [restoreToQueue],
  );

  const commitReject = React.useCallback(
    async (request: PendingRequest, reason: string | undefined) => {
      const result = await rejectAccessAction({
        customerId: request.customerId,
        reason,
      });
      if (!result.ok) {
        toast.error(`Couldn't reject ${request.businessName}`, {
          description: result.error,
        });
        restoreToQueue(request);
      }
    },
    [restoreToQueue],
  );

  const commitSnooze = React.useCallback(
    async (request: PendingRequest) => {
      const result = await snoozeAccessAction({ requestId: request.id });
      if (!result.ok) {
        toast.error(`Couldn't move ${request.businessName} to Later`, {
          description: result.error,
        });
        restoreToQueue(request);
      }
    },
    [restoreToQueue],
  );

  /** Schedule the actual mutation and show the Undo toast. */
  const scheduleDecision = React.useCallback(
    (request: PendingRequest, decision: Decision, commit: () => Promise<void>) => {
      removeFromQueue(request.id);

      const entry = {
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
        commit,
        undone: false,
      };
      entry.timer = setTimeout(() => {
        pendingCommits.current.delete(request.id);
        if (!entry.undone) void entry.commit();
      }, 4500);
      pendingCommits.current.set(request.id, entry);

      toast(
        decision === "approve"
          ? `Approved ${request.businessName}`
          : decision === "later"
            ? `${request.businessName} moved to Later`
            : `Rejected ${request.businessName}`,
        {
          icon:
            decision === "approve" ? (
              <CheckIcon className="size-4 text-success" aria-hidden />
            ) : decision === "later" ? (
              <ClockIcon className="size-4 text-muted-foreground" aria-hidden />
            ) : (
              <XIcon className="size-4 text-destructive" aria-hidden />
            ),
          action: {
            label: "Undo",
            onClick: () => {
              // restoreToQueue marks the entry undone and cancels its timer.
              restoreToQueue(request);
            },
          },
          duration: 4200,
        },
      );
    },
    [removeFromQueue, restoreToQueue],
  );

  const handleApproveConfirmed = React.useCallback(
    (
      request: PendingRequest,
      expiry: ExpiryValue,
      override: { reason: string } | undefined,
    ) => {
      setApproving(null);
      scheduleDecision(request, "approve", () =>
        commitApprove(request, expiry, override),
      );
    },
    [commitApprove, scheduleDecision],
  );

  const handleReject = React.useCallback(
    (request: PendingRequest, reason?: string) => {
      scheduleDecision(request, "reject", () => commitReject(request, reason));
    },
    [commitReject, scheduleDecision],
  );

  /** Skip for now (T: review later) — parks the request in the Later tab. */
  const handleSnooze = React.useCallback(
    (request: PendingRequest) => {
      scheduleDecision(request, "later", () => commitSnooze(request));
    },
    [commitSnooze, scheduleDecision],
  );

  const visibleQueue = React.useMemo(
    () => queue.filter((r) => matchesReviewFilter(r.review?.level, filter)),
    [queue, filter],
  );
  const filterCounts = React.useMemo(() => {
    const counts = {} as Record<ReviewFilterKey, number>;
    for (const f of REVIEW_FILTERS) {
      counts[f.key] = queue.filter((r) => matchesReviewFilter(r.review?.level, f.key)).length;
    }
    return counts;
  }, [queue]);
  // Reviews only exist when the server sent them; no chips without data.
  const hasReviews = queue.some((r) => r.review);

  /* ------------------------------ select mode --------------------------- */
  const router = useRouter();
  const [selectMode, setSelectMode] = React.useState(false);
  // Selection tracks customerIds (bulk approve/reject are customer-keyed).
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = React.useState(false);
  const [bulkRejecting, setBulkRejecting] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const toggleSelect = React.useCallback((customerId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }, []);

  const allSelected =
    visibleQueue.length > 0 && visibleQueue.every((r) => selected.has(r.customerId));

  const toggleSelectAll = React.useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all =
        visibleQueue.length > 0 && visibleQueue.every((r) => next.has(r.customerId));
      for (const r of visibleQueue) {
        if (all) next.delete(r.customerId);
        else next.add(r.customerId);
      }
      return next;
    });
  }, [visibleQueue]);

  const exitSelectMode = React.useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  /** Commit a bulk decision, then reconcile the optimistic queue with a refresh. */
  const runBulk = React.useCallback(
    async (
      verb: "approve" | "reject",
      call: (ids: string[]) => Promise<
        | { ok: true; count: number; failed: { id: string; error: string }[] }
        | { ok: false; error: string }
      >,
    ) => {
      const ids = queue
        .filter((r) => selected.has(r.customerId))
        .map((r) => r.customerId);
      if (ids.length === 0) return;
      setBulkBusy(true);
      const res = await call(ids);
      setBulkBusy(false);
      setBulkApproving(false);
      setBulkRejecting(false);
      if (!res.ok) {
        toast.error(`Couldn't ${verb} the selected requests`, { description: res.error });
        return;
      }
      const failedIds = new Set(res.failed.map((f) => f.id));
      const doneIds = new Set(ids.filter((id) => !failedIds.has(id)));
      setQueue((prev) => prev.filter((r) => !doneIds.has(r.customerId)));
      setSelected(new Set());
      setSelectMode(false);
      const past = verb === "approve" ? "Approved" : "Rejected";
      const held = res.failed.filter((f) => f.error.startsWith("Held"));
      const otherFailed = res.failed.length - held.length;
      const summary =
        `${past} ${res.count} request${res.count === 1 ? "" : "s"}` +
        (held.length ? ` · ${held.length} on hold` : "") +
        (otherFailed ? ` · ${otherFailed} failed` : "");
      const description = held.length
        ? `${held.length === 1 ? "1 shop was" : `${held.length} shops were`} approved before and never ordered, so ${held.length === 1 ? "it was" : "they were"} skipped. Open ${held.length === 1 ? "it" : "each one"} to approve anyway.`
        : undefined;
      if (held.length || otherFailed) toast.warning(summary, { description, duration: 8000 });
      else toast.success(summary);
      router.refresh();
    },
    [queue, selected, router],
  );

  const doBulkApprove = React.useCallback(
    (expiry: ExpiryValue) =>
      runBulk("approve", (ids) =>
        bulkApproveAccessAction({ customerIds: ids, expiry: expiryValueToInput(expiry) }),
      ),
    [runBulk],
  );

  const doBulkReject = React.useCallback(
    (reason: string | undefined) =>
      runBulk("reject", (ids) => bulkRejectAccessAction({ customerIds: ids, reason })),
    [runBulk],
  );

  if (queue.length === 0) {
    return (
      <EmptyState
        illustration="empty-box"
        title={searching ? "No matches" : "All caught up"}
        description={
          searching
            ? "No pending requests match your search."
            : "There are no pending access requests to review right now."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: history filter + multi-select toggle (search lives at the
          page level). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {hasReviews ? (
          <div
            role="group"
            aria-label="Filter by order history"
            className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {REVIEW_FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? f.key === "risky"
                        ? "border-destructive/40 bg-destructive text-white"
                        : "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-accent",
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] tabular-nums",
                      active ? "bg-white/20" : "bg-muted",
                    )}
                  >
                    {filterCounts[f.key]}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <span />
        )}
        {selectMode ? (
          <Button variant="outline" size="sm" onClick={exitSelectMode}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectMode(true)}
            aria-label="Select multiple requests to approve or reject at once"
          >
            <ListChecksIcon aria-hidden /> Select
          </Button>
        )}
      </div>

      {visibleQueue.length === 0 ? (
        <EmptyState
          illustration="empty-box"
          title="Nothing here"
          description="No pending requests match this filter."
          action={
            <Button variant="outline" size="sm" onClick={() => setFilter("all")}>
              Show all requests
            </Button>
          }
        />
      ) : selectMode ? (
        <SelectableList
          requests={visibleQueue}
          selected={selected}
          onToggle={toggleSelect}
          allSelected={allSelected}
          onToggleAll={toggleSelectAll}
        />
      ) : isMobile ? (
        <SwipeDeck
          requests={visibleQueue}
          onApprove={(request) => setApproving(request)}
          onAskReject={askReject}
          onSnooze={handleSnooze}
          onViewCustomer={viewCustomer}
        />
      ) : (
        <RequestList
          requests={visibleQueue}
          onApprove={(request) => setApproving(request)}
          onAskReject={askReject}
          onSnooze={handleSnooze}
          onViewCustomer={viewCustomer}
        />
      )}

      {/* One profile modal for the whole deck, driven by the selected seed. */}
      <CustomerDetailModal
        key={detailFor?.id ?? "closed"}
        customer={detailFor}
        open={detailFor !== null}
        onOpenChange={(open) => {
          if (!open) setDetailFor(null);
        }}
      />

      <ApproveDialog
        request={approving}
        onOpenChange={(open) => {
          if (!open) setApproving(null);
        }}
        onConfirm={handleApproveConfirmed}
        onRejectInstead={(request, reason) => {
          setApproving(null);
          askReject(request, reason);
        }}
      />

      <RejectDialog
        request={rejecting?.request ?? null}
        initialReason={rejecting?.reason ?? ""}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
        onConfirm={(request, reason) => {
          setRejecting(null);
          handleReject(request, reason);
        }}
      />

      {/* Bulk action bar + its confirm dialogs (select mode only). */}
      {selectMode && (
        <BulkActionBar
          count={selected.size}
          busy={bulkBusy}
          onApprove={() => setBulkApproving(true)}
          onReject={() => setBulkRejecting(true)}
          onClear={() => setSelected(new Set())}
        />
      )}
      <BulkApproveDialog
        open={bulkApproving}
        count={selected.size}
        heldCount={
          queue.filter((r) => selected.has(r.customerId) && r.review?.level === "hold").length
        }
        busy={bulkBusy}
        onOpenChange={(open) => {
          if (!open) setBulkApproving(false);
        }}
        onConfirm={doBulkApprove}
      />
      <BulkRejectDialog
        open={bulkRejecting}
        count={selected.size}
        busy={bulkBusy}
        onOpenChange={(open) => {
          if (!open) setBulkRejecting(false);
        }}
        onConfirm={doBulkReject}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Swipe deck (mobile)                                                 */
/* ------------------------------------------------------------------ */

function SwipeDeck({
  requests,
  onApprove,
  onAskReject,
  onSnooze,
  onViewCustomer,
}: {
  requests: PendingRequest[];
  onApprove: (request: PendingRequest) => void;
  onAskReject: (request: PendingRequest, reason?: string) => void;
  onSnooze: (request: PendingRequest) => void;
  onViewCustomer: (request: PendingRequest) => void;
}) {
  // Top card is the last element so later cards stack visually beneath it.
  const visible = requests.slice(0, 3);

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative h-[31rem] w-full max-w-sm">
        <AnimatePresence initial={false}>
          {visible
            .map((request, index) => ({ request, index }))
            .reverse()
            .map(({ request, index }) => (
              <SwipeCard
                key={request.id}
                request={request}
                depth={index}
                interactive={index === 0}
                onApprove={() => onApprove(request)}
                onReject={() =>
                  onAskReject(request, request.review?.suggestedRejectReason ?? undefined)
                }
                onSnooze={() => onSnooze(request)}
                onViewCustomer={() => onViewCustomer(request)}
              />
            ))}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-6" aria-hidden>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <XIcon className="size-3.5 text-destructive" /> Swipe left to reject
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Swipe right to approve <CheckIcon className="size-3.5 text-success" />
        </span>
      </div>
    </div>
  );
}

function SwipeCard({
  request,
  depth,
  interactive,
  onApprove,
  onReject,
  onSnooze,
  onViewCustomer,
}: {
  request: PendingRequest;
  depth: number;
  interactive: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSnooze: () => void;
  onViewCustomer: () => void;
}) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = React.useState(false);
  const held = request.review?.level === "hold";
  const act = suggestedActions(request.review?.level);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const approveOpacity = useTransform(x, [20, SWIPE_THRESHOLD], [0, 1]);
  const rejectOpacity = useTransform(x, [-SWIPE_THRESHOLD, -20], [1, 0]);
  const [exitX, setExitX] = React.useState(0);

  const handleDragEnd = React.useCallback(
    (_event: unknown, info: PanInfo) => {
      const offset = info.offset.x;
      const velocity = info.velocity.x;
      if (offset > SWIPE_THRESHOLD || velocity > 500) {
        setExitX(320);
        onApprove();
      } else if (offset < -SWIPE_THRESHOLD || velocity < -500) {
        setExitX(-320);
        onReject();
      }
    },
    [onApprove, onReject],
  );

  return (
    <motion.div
      className={cn(
        "absolute inset-x-0 top-0 mx-auto w-full",
        interactive ? "cursor-grab active:cursor-grabbing" : "pointer-events-none",
      )}
      style={interactive ? { x, rotate } : undefined}
      drag={interactive && !reduced ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDragEnd={interactive ? handleDragEnd : undefined}
      initial={{ scale: 1 - depth * 0.05, y: depth * 12, opacity: depth > 1 ? 0 : 1 }}
      animate={{ scale: 1 - depth * 0.05, y: depth * 12, opacity: 1 }}
      exit={{ x: exitX, opacity: 0, transition: { duration: 0.2 } }}
      transition={reduced ? { duration: 0 } : springs.snappy}
    >
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-lg">
        {request.review ? <ReviewAccentBar level={request.review.level} /> : null}
        {/* Swipe affordance overlays */}
        {interactive && (
          <>
            <motion.div
              style={{ opacity: approveOpacity }}
              className={cn(
                "pointer-events-none absolute top-4 left-4 rounded-lg border-2 px-2 py-0.5 text-sm font-bold tracking-wide uppercase",
                held ? "border-destructive text-destructive" : "border-success text-success",
              )}
            >
              {held ? "Needs a reason" : "Approve"}
            </motion.div>
            <motion.div
              style={{ opacity: rejectOpacity }}
              className="pointer-events-none absolute top-4 right-4 rounded-lg border-2 border-destructive px-2 py-0.5 text-sm font-bold tracking-wide text-destructive uppercase"
            >
              Reject
            </motion.div>
          </>
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full flex-col items-start gap-3 text-left outline-none"
          aria-expanded={expanded}
        >
          <div className="flex w-full items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-heading text-lg font-semibold text-foreground">
                {request.businessName}
              </h3>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <UserIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{request.contactName}</span>
              </p>
            </div>
            <StatusChip variant="pending" />
                {request.linkGoogleEmail ? (
                  <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    Connect Google
                  </span>
                ) : request.renewal ? (
                  <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Renewal
                  </span>
                ) : null}
          </div>

          <dl className="grid w-full grid-cols-1 gap-2 text-sm">
            <DetailRow icon={PhoneIcon} label="Phone" value={request.phone} />
            {request.linkGoogleEmail ? (
              <DetailRow
                icon={MailIcon}
                label="Connect Google"
                value={request.linkGoogleEmail}
              />
            ) : null}
            {request.city && (
              <DetailRow icon={MapPinIcon} label="City" value={request.city} />
            )}
            {(expanded || !request.city) && request.gstNumber && (
              <DetailRow
                icon={ReceiptIcon}
                label="GSTIN"
                value={request.gstNumber}
              />
            )}
          </dl>

          {request.review ? (
            <AccessReviewLine review={request.review} className="w-full" maxFacts={2} />
          ) : null}

          <p className="text-xs text-muted-foreground">
            Requested {dateFormatter.format(new Date(request.createdAt))}
            {!expanded && " · tap for details"}
          </p>
        </button>

        {/* OUTSIDE the expand toggle above: that whole card body is a <button>,
            and a button inside a button is invalid HTML and swallows keyboard
            activation. This is a sibling, never a child. */}
        {interactive && (
          <div className="mt-3 flex border-t border-border pt-2">
            <ViewCustomerButton
              businessName={request.businessName}
              onClick={onViewCustomer}
              className="-ml-2"
            />
          </div>
        )}

        {interactive && (
          <div className="mt-3 flex gap-2">
            <Button
              variant="destructive"
              className={cn("flex-1", act.rejectClassName)}
              onClick={onReject}
            >
              <XIcon aria-hidden /> Reject
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={onSnooze}
              aria-label="Skip for now — review later"
            >
              <ClockIcon aria-hidden /> Later
            </Button>
            <Button className="flex-1" variant={act.approveVariant} onClick={onApprove}>
              {act.ApproveIcon ? <act.ApproveIcon aria-hidden /> : <CheckIcon aria-hidden />}
              {act.approveLabel}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* List (desktop / a11y fallback)                                      */
/* ------------------------------------------------------------------ */

function RequestList({
  requests,
  onApprove,
  onAskReject,
  onSnooze,
  onViewCustomer,
}: {
  requests: PendingRequest[];
  onApprove: (request: PendingRequest) => void;
  onAskReject: (request: PendingRequest, reason?: string) => void;
  onSnooze: (request: PendingRequest) => void;
  onViewCustomer: (request: PendingRequest) => void;
}) {

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <ul className="divide-y divide-border">
        <AnimatePresence initial={false}>
          {requests.map((request) => (
            <motion.li
              key={request.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="relative flex flex-wrap items-center gap-x-4 gap-y-3 p-4 pl-5"
            >
              {request.review ? <ReviewAccentBar level={request.review.level} side="left" /> : null}
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-medium text-foreground">
                    {request.businessName}
                  </h3>
                  <StatusChip variant="pending" />
                {request.renewal ? (
                  <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Renewal
                  </span>
                ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <UserIcon className="size-3.5" aria-hidden />
                    {request.contactName}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <PhoneIcon className="size-3.5" aria-hidden />
                    {request.phone}
                  </span>
                  {request.city && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPinIcon className="size-3.5" aria-hidden />
                      {request.city}
                    </span>
                  )}
                  {request.gstNumber && (
                    <span className="inline-flex items-center gap-1.5">
                      <ReceiptIcon className="size-3.5" aria-hidden />
                      {request.gstNumber}
                    </span>
                  )}
                </div>
                {request.review ? (
                  <AccessReviewLine review={request.review} className="mt-2" maxFacts={6} />
                ) : null}
              </div>
              {/* Plain <li> content — nothing here wraps the row in a button,
                  so this control nests inside nothing. */}
              {/* max-w-full, not shrink-0: on a narrow screen (and in the
                  server-rendered first paint, before the phone deck takes
                  over) the buttons wrap instead of running off the card. */}
              <div className="flex max-w-full flex-wrap items-center gap-2">
                <ViewCustomerButton
                  businessName={request.businessName}
                  onClick={() => onViewCustomer(request)}
                  className="mr-1"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  className={suggestedActions(request.review?.level).rejectClassName}
                  onClick={() =>
                    onAskReject(request, request.review?.suggestedRejectReason ?? undefined)
                  }
                >
                  <XIcon aria-hidden /> Reject
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSnooze(request)}
                  aria-label={`Skip ${request.businessName} for now`}
                >
                  <ClockIcon aria-hidden /> Later
                </Button>
                {(() => {
                  const act = suggestedActions(request.review?.level);
                  return (
                    <Button size="sm" variant={act.approveVariant} onClick={() => onApprove(request)}>
                      {act.ApproveIcon ? <act.ApproveIcon aria-hidden /> : <CheckIcon aria-hidden />}
                      {act.approveLabel}
                    </Button>
                  );
                })()}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Approve dialog (pick expiry)                                        */
/* ------------------------------------------------------------------ */

function ApproveDialog({
  request,
  onOpenChange,
  onConfirm,
  onRejectInstead,
}: {
  request: PendingRequest | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (
    request: PendingRequest,
    expiry: ExpiryValue,
    override: { reason: string } | undefined,
  ) => void;
  onRejectInstead: (request: PendingRequest, reason?: string) => void;
}) {
  const [expiry, setExpiry] = React.useState<ExpiryValue>(defaultExpiry);
  const review = request?.review ?? null;
  const guard = useApprovalGuard(review, request?.id ?? null);

  // Reset the dial to the default whenever a new request opens the dialog —
  // done during render (tracking the request identity) to avoid an effect.
  const [dialogFor, setDialogFor] = React.useState<string | null>(
    request?.id ?? null,
  );
  if ((request?.id ?? null) !== dialogFor) {
    setDialogFor(request?.id ?? null);
    if (request) setExpiry(defaultExpiry());
  }

  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Approve access</DialogTitle>
          <DialogDescription>
            {request
              ? `Choose how long ${request.businessName} can see prices.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {review ? <AccessReviewNotice review={review} /> : null}

        {/* Right under the warning: on a phone the dial below runs past the
            fold, and the reason is what unlocks the button. */}
        {guard.held ? (
          <OverrideReasonField
            id="approve-override-reason"
            value={guard.reason}
            onChange={guard.setReason}
          />
        ) : null}

        <div className="py-2">
          <ExpiryDial value={expiry} onChange={setExpiry} />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {review && (review.level === "hold" || review.level === "watch") ? (
            <Button
              variant="destructive"
              onClick={() => {
                if (request) {
                  onRejectInstead(request, review.suggestedRejectReason ?? undefined);
                }
              }}
            >
              <XIcon aria-hidden /> Reject instead
            </Button>
          ) : null}
          <Button
            variant={guard.held ? "outline" : "default"}
            disabled={!guard.canConfirm}
            onClick={() => {
              if (request && guard.canConfirm) onConfirm(request, expiry, guard.override);
            }}
          >
            <CheckIcon aria-hidden /> {guard.confirmLabel("Approve access")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Reject dialog (optional reason)                                     */
/* ------------------------------------------------------------------ */

/** One-tap reasons — the ones staff type again and again. */
const QUICK_REJECT_REASONS = [
  NO_ORDER_REJECT_REASON,
  "Could not verify GSTIN",
  "Not a shop / not a reseller",
  "Duplicate account",
] as const;

function RejectDialog({
  request,
  initialReason = "",
  onOpenChange,
  onConfirm,
}: {
  request: PendingRequest | null;
  /** Prefilled reason (e.g. the review's suggestion, or "Reject instead"). */
  initialReason?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (request: PendingRequest, reason?: string) => void;
}) {
  const [reason, setReason] = React.useState(initialReason);

  // Reset the reason when a new request opens the dialog (render-phase
  // reset keyed on request identity — no effect, no cascading render).
  const [dialogFor, setDialogFor] = React.useState<string | null>(
    request?.id ?? null,
  );
  if ((request?.id ?? null) !== dialogFor) {
    setDialogFor(request?.id ?? null);
    setReason(initialReason);
  }

  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reject request</DialogTitle>
          <DialogDescription>
            {request
              ? `Optionally tell ${request.businessName} why. This is saved with the decision.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {request?.review ? <AccessReviewNotice review={request.review} /> : null}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick reasons">
          {QUICK_REJECT_REASONS.map((quick) => (
            <button
              key={quick}
              type="button"
              aria-pressed={reason === quick}
              onClick={() => setReason(quick)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                reason === quick
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {quick}
            </button>
          ))}
        </div>

        <div className="py-1">
          <label
            htmlFor="reject-reason"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Reason <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. Could not verify GSTIN"
            className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (request) onConfirm(request, reason.trim() || undefined);
            }}
          >
            <XIcon aria-hidden /> Reject request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Selectable list (bulk mode — mobile AND desktop)                    */
/* ------------------------------------------------------------------ */

function SelectableList({
  requests,
  selected,
  onToggle,
  allSelected,
  onToggleAll,
}: {
  requests: PendingRequest[];
  selected: Set<string>;
  onToggle: (customerId: string) => void;
  allSelected: boolean;
  onToggleAll: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          aria-label="Select all pending requests"
          className="size-4 accent-primary"
        />
        <span className="text-sm font-medium text-muted-foreground">
          Select all ({requests.length})
        </span>
      </div>
      <ul className="divide-y divide-border">
        {requests.map((request) => {
          const checked = selected.has(request.customerId);
          return (
            <li key={request.id}>
              <button
                type="button"
                onClick={() => onToggle(request.customerId)}
                aria-pressed={checked}
                className={cn(
                  "flex w-full items-center gap-3 p-4 text-left outline-none transition-colors focus-visible:bg-accent/60",
                  checked ? "bg-primary/5" : "hover:bg-accent/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  tabIndex={-1}
                  aria-hidden
                  className="pointer-events-none size-4 shrink-0 accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-medium text-foreground">
                      {request.businessName}
                    </h3>
                    <StatusChip variant="pending" />
                {request.renewal ? (
                  <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Renewal
                  </span>
                ) : null}
                {request.review ? <ReviewLevelPill level={request.review.level} /> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <UserIcon className="size-3.5" aria-hidden />
                      {request.contactName}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <PhoneIcon className="size-3.5" aria-hidden />
                      {request.phone}
                    </span>
                    {request.city && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPinIcon className="size-3.5" aria-hidden />
                        {request.city}
                      </span>
                    )}
                  </div>
                  {request.review &&
                  (request.review.level === "hold" || request.review.level === "watch") ? (
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        request.review.level === "hold"
                          ? "font-medium text-destructive"
                          : "text-amber-800 dark:text-amber-300",
                      )}
                    >
                      {request.review.headline}
                    </p>
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk action bar + confirm dialogs                                   */
/* ------------------------------------------------------------------ */

function BulkActionBar({
  count,
  busy,
  onApprove,
  onReject,
  onClear,
}: {
  count: number;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClear: () => void;
}) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={springs.snappy}
          // Sits ABOVE the mobile admin tab bar (which is in normal flow at the
          // very bottom); drops to the screen edge on md+ where there is no tab bar.
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 mx-auto flex w-[calc(100%-2rem)] max-w-xl items-center gap-2 rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur md:bottom-4"
        >
          <span className="pl-1 text-sm font-medium text-foreground">
            {count} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
              Clear
            </Button>
            <Button variant="destructive" size="sm" onClick={onReject} disabled={busy}>
              <XIcon aria-hidden /> Reject
            </Button>
            <Button size="sm" onClick={onApprove} disabled={busy}>
              <CheckCheckIcon aria-hidden /> Approve
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BulkApproveDialog({
  open,
  count,
  heldCount,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  count: number;
  /** Selected shops the review holds — the server will skip them. */
  heldCount: number;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (expiry: ExpiryValue) => void;
}) {
  const [expiry, setExpiry] = React.useState<ExpiryValue>(defaultExpiry);

  // Reset the dial to the default each time the dialog opens (render-phase).
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setExpiry(defaultExpiry());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Approve {count} request{count === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            Choose how long the selected customers can see prices. The same
            validity applies to all of them.
          </DialogDescription>
        </DialogHeader>

        {heldCount > 0 ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {heldCount === 1
              ? "1 selected shop is on Hold (approved before, never ordered). It will be skipped — open it to approve anyway."
              : `${heldCount} selected shops are on Hold (approved before, never ordered). They will be skipped — open each one to approve anyway.`}
          </p>
        ) : null}

        <div className="py-2">
          <ExpiryDial value={expiry} onChange={setExpiry} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(expiry)} disabled={busy || count - heldCount <= 0}>
            <CheckCheckIcon aria-hidden />
            {busy
              ? "Approving…"
              : `Approve ${Math.max(0, count - heldCount)}${heldCount > 0 ? ` · skip ${heldCount}` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkRejectDialog({
  open,
  count,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = React.useState("");

  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reject {count} request{count === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            Optionally add a reason saved with every rejection. The same reason
            applies to all selected customers.
          </DialogDescription>
        </DialogHeader>

        <div className="py-1">
          <label
            htmlFor="bulk-reject-reason"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Reason <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="bulk-reject-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. Could not verify GSTIN"
            className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(reason.trim() || undefined)}
            disabled={busy}
          >
            <XIcon aria-hidden />
            {busy ? "Rejecting…" : `Reject ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{label}: </span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}
