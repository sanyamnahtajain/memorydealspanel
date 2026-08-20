"use client";

import * as React from "react";
import {
  MapPinIcon,
  PhoneIcon,
  ReceiptIcon,
  UserIcon,
  Search as SearchIcon,
  X as XIcon,
} from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { unsnoozeAccessAction } from "@/server/actions/access";
import { EmptyState, StatusChip, Pager } from "@/components/common";
import {
  ApprovalSwipeDeck,
  type PendingRequest,
} from "@/components/admin/requests/ApprovalSwipeDeck";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface DecidedRequest {
  id: string;
  businessName: string;
  contactName: string;
  phone: string;
  gstNumber: string | null;
  city: string | null;
  status: "APPROVED" | "REJECTED";
  reason: string | null;
  /** ISO timestamp of the decision. */
  decidedAt: string | null;
  createdAt: string;
}

export interface RequestsTabsProps {
  pending: PendingRequest[];
  /** Skipped requests parked for later review (T: snooze). */
  snoozed: PendingRequest[];
  decided: DecidedRequest[];
  /** 1-based current page of the decided history. */
  decidedPage: number;
  /** Total pages of decided history. */
  decidedPageCount: number;
  /** Total decided requests. */
  decidedTotal: number;
  /** Page size used for the decided range summary. */
  decidedPageSize: number;
  /** URL param name that drives the decided-tab pagination. */
  decidedPageParam: string;
  /** Current server-side search query (drives all three tabs). */
  query: string;
  /** Approved/Rejected sub-filter for the decided history. */
  decidedStatus: "all" | "approved" | "rejected";
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Client tab switcher for the Requests queue: the live review surface
 * (swipe deck / list) under "Pending", and a read-only history under
 * "Decided". Kept client-side so switching tabs is instant and the deck's
 * optimistic state survives tab changes.
 */
export function RequestsTabs({
  pending,
  snoozed,
  decided,
  decidedPage,
  decidedPageCount,
  decidedTotal,
  decidedPageSize,
  decidedPageParam,
  query,
  decidedStatus,
}: RequestsTabsProps) {
  // When the URL carries a decided-tab page (>1), the admin was browsing the
  // history — open that tab so navigation lands where they expect.
  const initialTab = decidedPage > 1 ? "decided" : "pending";
  const searching = query.trim().length > 0;
  return (
    <div className="space-y-5">
      <RequestsSearch initial={query} decidedPageParam={decidedPageParam} />
      <Tabs defaultValue={initialTab} className="w-full">
      <TabsList>
        <TabsTrigger value="pending">
          Pending
          {pending.length > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] leading-none font-semibold tabular-nums text-primary-foreground">
              {pending.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="later">
          Later
          {snoozed.length > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] leading-none font-semibold tabular-nums text-muted-foreground">
              {snoozed.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="decided">Decided</TabsTrigger>
      </TabsList>

      <TabsContent value="pending" className="mt-6">
        <ApprovalSwipeDeck requests={pending} searching={searching} />
      </TabsContent>

      <TabsContent value="later" className="mt-6">
        <SnoozedList requests={snoozed} searching={searching} />
      </TabsContent>

      <TabsContent value="decided" className="mt-6 space-y-4">
        <DecidedStatusFilter
          value={decidedStatus}
          decidedPageParam={decidedPageParam}
        />
        <DecidedList requests={decided} searching={searching} />
        {decidedTotal > 0 ? (
          <Pager
            page={decidedPage}
            pageCount={decidedPageCount}
            total={decidedTotal}
            pageSize={decidedPageSize}
            paramName={decidedPageParam}
          />
        ) : null}
      </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search + decided filter (URL-driven, server-side)                   */
/* ------------------------------------------------------------------ */

/**
 * Free-text search that drives the whole page. Debounced so a fast typist
 * doesn't fire a request per keystroke; writes `?q=` (and clears the decided
 * page) via a REPLACE so it doesn't spam the history stack. Because this is a
 * soft navigation, the client `Tabs` keep their active tab across searches.
 */
function RequestsSearch({
  initial,
  decidedPageParam,
}: {
  initial: string;
  decidedPageParam: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(initial);
  const focusedRef = React.useRef(false);

  // Re-sync when the URL query changes from ELSEWHERE (back button, cleared
  // filter) — but never while the field is focused, or the debounced round-trip
  // would clobber characters the user is still typing. Done in an effect so the
  // focus ref is read outside render.
  React.useEffect(() => {
    if (!focusedRef.current) setValue(initial);
  }, [initial]);

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = React.useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = next.trim();
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      params.delete(decidedPageParam); // a new search resets decided paging
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, decidedPageParam],
  );

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), 300);
  }

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    setValue("");
    commit("");
  }

  return (
    <div className="relative">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
        }}
        placeholder="Search all requests — business, contact, phone, city or GSTIN"
        aria-label="Search all access requests"
        className="h-10 w-full rounded-lg border border-input bg-transparent pr-9 pl-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Approved / Rejected sub-filter chips for the decided history. */
function DecidedStatusFilter({
  value,
  decidedPageParam,
}: {
  value: "all" | "approved" | "rejected";
  decidedPageParam: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setStatus(next: "all" | "approved" | "rejected") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("ds");
    else params.set("ds", next);
    params.delete(decidedPageParam); // changing the filter resets paging
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const options = [
    { key: "all", label: "All" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ] as const;

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Filter by decision">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => setStatus(option.key)}
          aria-pressed={value === option.key}
          className={cn(
            "rounded-full border px-3 py-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
            value === option.key
              ? "border-primary bg-primary/10 font-medium text-primary"
              : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Decided history                                                     */
/* ------------------------------------------------------------------ */

function DecidedList({
  requests,
  searching,
}: {
  requests: DecidedRequest[];
  searching: boolean;
}) {
  if (requests.length === 0) {
    return (
      <EmptyState
        illustration="empty-box"
        title={searching ? "No matches" : "No decisions yet"}
        description={
          searching
            ? "No decided requests match your search."
            : "Approved and rejected requests will appear here."
        }
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <ul className="divide-y divide-border">
        {requests.map((request) => (
          <li
            key={request.id}
            className="flex flex-wrap items-start gap-x-4 gap-y-2 p-4"
          >
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-medium text-foreground">
                  {request.businessName}
                </h3>
                <StatusChip
                  variant={
                    request.status === "APPROVED" ? "approved" : "rejected"
                  }
                />
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
              {request.reason && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Reason:</span>{" "}
                  {request.reason}
                </p>
              )}
            </div>
            <p className="shrink-0 text-xs text-muted-foreground">
              {request.status === "APPROVED" ? "Approved" : "Rejected"}{" "}
              {request.decidedAt
                ? dateFormatter.format(new Date(request.decidedAt))
                : dateFormatter.format(new Date(request.createdAt))}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Later (snoozed) list                                                */
/* ------------------------------------------------------------------ */

function SnoozedList({
  requests,
  searching,
}: {
  requests: PendingRequest[];
  searching: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  if (requests.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
        {searching
          ? "No parked requests match your search."
          : "Nothing parked for later — skip a request from the queue and it lands here to review whenever you're ready."}
      </p>
    );
  }

  async function moveBack(request: PendingRequest) {
    setPendingId(request.id);
    try {
      const res = await unsnoozeAccessAction({ requestId: request.id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${request.businessName} is back in the queue.`);
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <ul className="flex flex-col gap-2">
      {requests.map((request) => (
        <li
          key={request.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {request.businessName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {request.contactName} · {request.phone}
              {request.city ? ` · ${request.city}` : ""}
              {request.gstNumber ? ` · GST ${request.gstNumber}` : ""}
            </p>
            <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
              Requested {dateFormatter.format(new Date(request.createdAt))}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={pendingId === request.id}
            onClick={() => void moveBack(request)}
            className="shrink-0"
          >
            <Undo2 aria-hidden className="size-3.5" />
            Move back to queue
          </Button>
        </li>
      ))}
    </ul>
  );
}
