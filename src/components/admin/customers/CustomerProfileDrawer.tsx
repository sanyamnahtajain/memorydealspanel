"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, ShieldBan, ShieldCheck, Clock, XCircle } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip, type StatusChipVariant } from "@/components/common";
import { ConfirmSheet } from "@/components/common";
import {
  ExpiryDial,
  expiryValueToInput,
  type ExpiryValue,
} from "@/components/admin/ExpiryDial";
import {
  updateCustomerAction,
  updateCustomerNotesAction,
  setCustomerStatusAction,
  resetCustomerPasswordAction,
  getCustomerProfileAction,
  type CustomerProfile,
} from "@/server/actions/customers";
import {
  approveAccessAction,
  extendAccessAction,
  rejectAccessAction,
  revokeAccessAction,
} from "@/server/actions/access";
import type { CustomerRowData } from "@/app/admin/customers/page";

const STATUS_VARIANT: Record<CustomerRowData["status"], StatusChipVariant> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  BLOCKED: "blocked",
};

const EDITABLE_FIELDS = [
  { key: "businessName", label: "Business name" },
  { key: "contactName", label: "Contact person" },
  { key: "city", label: "City" },
  { key: "gstNumber", label: "GST number" },
  { key: "email", label: "Email" },
] as const;

type EditableKey = (typeof EDITABLE_FIELDS)[number]["key"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CustomerProfileDrawer({
  customer,
  open,
  onOpenChange,
}: {
  customer: CustomerRowData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  // Initialised directly from props: the parent keys this component by
  // customer id, so a different customer remounts it with fresh state (no
  // effect-driven state sync, which would cause cascading renders).
  const [fields, setFields] = React.useState<Record<EditableKey, string>>(() => ({
    businessName: customer?.businessName ?? "",
    contactName: customer?.contactName ?? "",
    city: customer?.city ?? "",
    gstNumber: customer?.gstNumber ?? "",
    email: customer?.email ?? "",
  }));
  const [notes, setNotes] = React.useState(() => customer?.notes ?? "");
  const [expiry, setExpiry] = React.useState<ExpiryValue>({ kind: "days", days: 30 });
  const [profile, setProfile] = React.useState<CustomerProfile | null>(null);

  const customerId = customer?.id;
  // Async history fetch only — the async setState in `.then` is allowed and
  // does not trigger the synchronous cascading-render lint.
  React.useEffect(() => {
    if (!customerId) return;
    let active = true;
    getCustomerProfileAction(customerId).then((res) => {
      if (active && res.ok) setProfile(res.profile);
    });
    return () => {
      active = false;
    };
  }, [customerId]);

  if (!customer) return null;

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        toast.success(label);
        router.refresh();
      } else {
        toast.error(res.error ?? "Something went wrong.");
      }
      return res.ok;
    } finally {
      setBusy(false);
    }
  }

  const c = customer;

  const saveFields = () =>
    run("Details saved", () =>
      updateCustomerAction(c.id, {
        businessName: fields.businessName,
        contactName: fields.contactName,
        city: fields.city,
        gstNumber: fields.gstNumber,
        email: fields.email,
      }),
    );

  const saveNotes = () =>
    run("Notes saved", () =>
      updateCustomerNotesAction({ customerId: c.id, notes }),
    );

  const approve = () =>
    run("Access approved", () =>
      approveAccessAction({ customerId: c.id, expiry: expiryValueToInput(expiry) }),
    );

  const extend = () =>
    run("Access extended", () =>
      extendAccessAction({ customerId: c.id, expiry: expiryValueToInput(expiry) }),
    );

  const revoke = () => run("Access revoked", () => revokeAccessAction({ customerId: c.id }));
  const reject = () =>
    run("Request rejected", () => rejectAccessAction({ customerId: c.id, reason: undefined }));
  const block = () =>
    run("Customer blocked", () => setCustomerStatusAction(c.id, "BLOCKED"));
  const unblock = () =>
    run("Customer unblocked", () => setCustomerStatusAction(c.id, "REJECTED"));

  async function resetPassword() {
    const pw = window.prompt("Set a new password (min 8 chars):");
    if (!pw) return;
    await run("Password reset", () =>
      resetCustomerPasswordAction({ customerId: c.id, password: pw }),
    );
  }

  const isBlocked = c.status === "BLOCKED";
  const canApprove = c.status === "PENDING" || c.status === "REJECTED" || c.status === "EXPIRED";
  const isLive = c.priceAccess;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="text-left">{c.businessName}</SheetTitle>
            <StatusChip variant={STATUS_VARIANT[c.status]} />
          </div>
          <SheetDescription className="text-left">
            {c.phone}
            {c.priceAccess ? " · price access live" : " · no price access"}
            {c.expiresAt ? ` · expires ${formatDate(c.expiresAt)}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8">
          {/* Access lifecycle */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Access</h3>
            {(canApprove || isLive) && (
              <div className="rounded-lg border border-border p-3">
                <ExpiryDial value={expiry} onChange={setExpiry} compact />
                <div className="mt-3 flex flex-wrap gap-2">
                  {canApprove && (
                    <Button size="sm" onClick={approve} disabled={busy}>
                      <ShieldCheck className="mr-1 size-4" />
                      Approve
                    </Button>
                  )}
                  {isLive && (
                    <Button size="sm" variant="secondary" onClick={extend} disabled={busy}>
                      <Clock className="mr-1 size-4" />
                      Extend
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {isLive && (
                <ConfirmSheet
                  title="Revoke access?"
                  description="The customer will immediately lose price access and be signed out."
                  confirmLabel="Revoke"
                  destructive
                  onConfirm={async () => {
                    await revoke();
                  }}
                  trigger={
                    <Button size="sm" variant="outline" disabled={busy}>
                      <XCircle className="mr-1 size-4" />
                      Revoke
                    </Button>
                  }
                />
              )}
              {c.status === "PENDING" && (
                <Button size="sm" variant="outline" onClick={reject} disabled={busy}>
                  Reject
                </Button>
              )}
              {isBlocked ? (
                <Button size="sm" variant="outline" onClick={unblock} disabled={busy}>
                  Unblock
                </Button>
              ) : (
                <ConfirmSheet
                  title="Block customer?"
                  description="Blocks sign-in and revokes any live access."
                  confirmLabel="Block"
                  destructive
                  onConfirm={async () => {
                    await block();
                  }}
                  trigger={
                    <Button size="sm" variant="outline" disabled={busy}>
                      <ShieldBan className="mr-1 size-4" />
                      Block
                    </Button>
                  }
                />
              )}
              <Button size="sm" variant="ghost" onClick={resetPassword} disabled={busy}>
                <KeyRound className="mr-1 size-4" />
                Reset password
              </Button>
            </div>
          </section>

          {/* Editable details */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Details</h3>
            {EDITABLE_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`cust-${f.key}`}>{f.label}</Label>
                <Input
                  id={`cust-${f.key}`}
                  value={fields[f.key]}
                  onChange={(e) =>
                    setFields((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                />
              </div>
            ))}
            <Button size="sm" onClick={saveFields} disabled={busy}>
              Save details
            </Button>
          </section>

          {/* Private notes */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Private notes</h3>
            <textarea
              className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Only you can see this."
            />
            <Button size="sm" variant="secondary" onClick={saveNotes} disabled={busy}>
              Save notes
            </Button>
          </section>

          {/* Access history */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">History</h3>
            <p className="text-xs text-muted-foreground">
              Last login: {formatDate(c.lastLoginAt)} · Joined {formatDate(c.createdAt)}
            </p>
            {profile ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {profile.requests.slice(0, 6).map((r, i) => (
                  <li key={`req-${i}`}>
                    Request {r.status.toLowerCase()} · {formatDate(r.createdAt)}
                  </li>
                ))}
                {profile.grants.slice(0, 6).map((g, i) => (
                  <li key={`grant-${i}`}>
                    Grant {formatDate(g.approvedAt)}
                    {g.expiresAt ? ` → ${formatDate(g.expiresAt)}` : " (no expiry)"}
                    {g.revokedAt ? " · revoked" : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Loading history…</p>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
