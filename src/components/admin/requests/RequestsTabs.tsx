"use client";

import * as React from "react";
import { MapPinIcon, PhoneIcon, ReceiptIcon, UserIcon } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, StatusChip } from "@/components/common";
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
  decided: DecidedRequest[];
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
export function RequestsTabs({ pending, decided }: RequestsTabsProps) {
  return (
    <Tabs defaultValue="pending" className="w-full">
      <TabsList>
        <TabsTrigger value="pending">
          Pending
          {pending.length > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] leading-none font-semibold tabular-nums text-primary-foreground">
              {pending.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="decided">Decided</TabsTrigger>
      </TabsList>

      <TabsContent value="pending" className="mt-6">
        <ApprovalSwipeDeck requests={pending} />
      </TabsContent>

      <TabsContent value="decided" className="mt-6">
        <DecidedList requests={decided} />
      </TabsContent>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ */
/* Decided history                                                     */
/* ------------------------------------------------------------------ */

function DecidedList({ requests }: { requests: DecidedRequest[] }) {
  if (requests.length === 0) {
    return (
      <EmptyState
        illustration="empty-box"
        title="No decisions yet"
        description="Approved and rejected requests will appear here."
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
