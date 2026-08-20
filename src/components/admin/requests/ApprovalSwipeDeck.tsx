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
  MapPinIcon,
  PhoneIcon,
  ReceiptIcon,
  Search as SearchIcon,
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
import {
  ExpiryDial,
  expiryValueToInput,
  type ExpiryValue,
} from "@/components/admin/ExpiryDial";
import { DEFAULT_ACCESS_EXPIRY_DAYS } from "@/lib/constants";
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
  businessName: string;
  contactName: string;
  /** Canonical +91… phone. */
  phone: string;
  gstNumber: string | null;
  city: string | null;
  /** ISO timestamp the request was submitted. */
  createdAt: string;
}

export interface ApprovalSwipeDeckProps {
  requests: PendingRequest[];
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
export function ApprovalSwipeDeck({ requests }: ApprovalSwipeDeckProps) {
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

  /** Timers that commit a decision after the Undo window closes. */
  const pendingCommits = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  React.useEffect(() => {
    const timers = pendingCommits.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const removeFromQueue = React.useCallback((id: string) => {
    setQueue((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const restoreToQueue = React.useCallback(
    (request: PendingRequest) => {
      const timer = pendingCommits.current.get(request.id);
      if (timer) {
        clearTimeout(timer);
        pendingCommits.current.delete(request.id);
      }
      setQueue((prev) =>
        prev.some((r) => r.id === request.id)
          ? prev
          : [request, ...prev].sort(
              (a, b) => a.createdAt.localeCompare(b.createdAt),
            ),
      );
    },
    [],
  );

  /** Commit an approval to the server once the Undo window has elapsed. */
  const commitApprove = React.useCallback(
    async (request: PendingRequest, expiry: ExpiryValue) => {
      const result = await approveAccessAction({
        customerId: request.customerId,
        expiry: expiryValueToInput(expiry),
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

      let undone = false;
      const timer = setTimeout(() => {
        pendingCommits.current.delete(request.id);
        if (!undone) void commit();
      }, 4500);
      pendingCommits.current.set(request.id, timer);

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
              undone = true;
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
    (request: PendingRequest, expiry: ExpiryValue) => {
      setApproving(null);
      scheduleDecision(request, "approve", () => commitApprove(request, expiry));
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

  /* --------------------------- search + select -------------------------- */
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [selectMode, setSelectMode] = React.useState(false);
  // Selection tracks customerIds (bulk approve/reject are customer-keyed).
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = React.useState(false);
  const [bulkRejecting, setBulkRejecting] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const query = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!query) return queue;
    return queue.filter((r) =>
      [r.businessName, r.contactName, r.phone, r.city ?? "", r.gstNumber ?? ""].some(
        (field) => field.toLowerCase().includes(query),
      ),
    );
  }, [queue, query]);

  const toggleSelect = React.useCallback((customerId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }, []);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.customerId));

  const toggleSelectAll = React.useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = filtered.length > 0 && filtered.every((r) => next.has(r.customerId));
      for (const r of filtered) {
        if (all) next.delete(r.customerId);
        else next.add(r.customerId);
      }
      return next;
    });
  }, [filtered]);

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
      const ids = filtered
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
      toast.success(
        `${past} ${res.count} request${res.count === 1 ? "" : "s"}` +
          (res.failed.length ? ` · ${res.failed.length} failed` : ""),
      );
      router.refresh();
    },
    [filtered, selected, router],
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
        title="All caught up"
        description="There are no pending access requests to review right now."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: filter + multi-select toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search business, contact, phone, city or GSTIN"
            aria-label="Search pending requests"
            className="h-9 w-full rounded-lg border border-input bg-transparent pr-3 pl-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
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

      {filtered.length === 0 ? (
        <EmptyState
          illustration="empty-box"
          title="No matches"
          description="No pending requests match your search."
        />
      ) : selectMode ? (
        <SelectableList
          requests={filtered}
          selected={selected}
          onToggle={toggleSelect}
          allSelected={allFilteredSelected}
          onToggleAll={toggleSelectAll}
        />
      ) : isMobile ? (
        <SwipeDeck
          requests={filtered}
          onApprove={(request) => setApproving(request)}
          onReject={handleReject}
          onSnooze={handleSnooze}
        />
      ) : (
        <RequestList
          requests={filtered}
          onApprove={(request) => setApproving(request)}
          onReject={handleReject}
          onSnooze={handleSnooze}
        />
      )}

      <ApproveDialog
        request={approving}
        onOpenChange={(open) => {
          if (!open) setApproving(null);
        }}
        onConfirm={handleApproveConfirmed}
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
  onReject,
  onSnooze,
}: {
  requests: PendingRequest[];
  onApprove: (request: PendingRequest) => void;
  onReject: (request: PendingRequest, reason?: string) => void;
  onSnooze: (request: PendingRequest) => void;
}) {
  // Top card is the last element so later cards stack visually beneath it.
  const visible = requests.slice(0, 3);
  const [rejecting, setRejecting] = React.useState<PendingRequest | null>(null);

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative h-[26rem] w-full max-w-sm">
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
                onReject={() => setRejecting(request)}
                onSnooze={() => onSnooze(request)}
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

      <RejectDialog
        request={rejecting}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
        onConfirm={(request, reason) => {
          setRejecting(null);
          onReject(request, reason);
        }}
      />
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
}: {
  request: PendingRequest;
  depth: number;
  interactive: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSnooze: () => void;
}) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = React.useState(false);
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
        {/* Swipe affordance overlays */}
        {interactive && (
          <>
            <motion.div
              style={{ opacity: approveOpacity }}
              className="pointer-events-none absolute top-4 left-4 rounded-lg border-2 border-success px-2 py-0.5 text-sm font-bold tracking-wide text-success uppercase"
            >
              Approve
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
          </div>

          <dl className="grid w-full grid-cols-1 gap-2 text-sm">
            <DetailRow icon={PhoneIcon} label="Phone" value={request.phone} />
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

          <p className="text-xs text-muted-foreground">
            Requested {dateFormatter.format(new Date(request.createdAt))}
            {!expanded && " · tap for details"}
          </p>
        </button>

        {interactive && (
          <div className="mt-4 flex gap-2">
            <Button
              variant="destructive"
              className="flex-1"
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
            <Button className="flex-1" onClick={onApprove}>
              <CheckIcon aria-hidden /> Approve
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
  onReject,
  onSnooze,
}: {
  requests: PendingRequest[];
  onApprove: (request: PendingRequest) => void;
  onReject: (request: PendingRequest, reason?: string) => void;
  onSnooze: (request: PendingRequest) => void;
}) {
  const [rejecting, setRejecting] = React.useState<PendingRequest | null>(null);

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
              className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4"
            >
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-medium text-foreground">
                    {request.businessName}
                  </h3>
                  <StatusChip variant="pending" />
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
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setRejecting(request)}
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
                <Button size="sm" onClick={() => onApprove(request)}>
                  <CheckIcon aria-hidden /> Approve
                </Button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <RejectDialog
        request={rejecting}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
        onConfirm={(request, reason) => {
          setRejecting(null);
          onReject(request, reason);
        }}
      />
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
}: {
  request: PendingRequest | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (request: PendingRequest, expiry: ExpiryValue) => void;
}) {
  const [expiry, setExpiry] = React.useState<ExpiryValue>(defaultExpiry);

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

        <div className="py-2">
          <ExpiryDial value={expiry} onChange={setExpiry} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (request) onConfirm(request, expiry);
            }}
          >
            <CheckIcon aria-hidden /> Approve access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Reject dialog (optional reason)                                     */
/* ------------------------------------------------------------------ */

function RejectDialog({
  request,
  onOpenChange,
  onConfirm,
}: {
  request: PendingRequest | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (request: PendingRequest, reason?: string) => void;
}) {
  const [reason, setReason] = React.useState("");

  // Clear the reason field when a new request opens the dialog (render-phase
  // reset keyed on request identity — no effect, no cascading render).
  const [dialogFor, setDialogFor] = React.useState<string | null>(
    request?.id ?? null,
  );
  if ((request?.id ?? null) !== dialogFor) {
    setDialogFor(request?.id ?? null);
    setReason("");
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
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  count: number;
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

        <div className="py-2">
          <ExpiryDial value={expiry} onChange={setExpiry} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(expiry)} disabled={busy}>
            <CheckCheckIcon aria-hidden />
            {busy ? "Approving…" : `Approve ${count}`}
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
