"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Clock,
  KeyRound,
  Loader2Icon,
  LockKeyhole,
  ShieldBan,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { isValidGstin } from "@/lib/gstin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CityField } from "@/components/storefront/CityField";
import { usePromptDialog } from "@/components/ui/prompt-dialog";
import {
  ConfirmSheet,
  StatusChip,
  useIsMobile,
  type StatusChipVariant,
} from "@/components/common";
import {
  ExpiryDial,
  expiryValueToInput,
  previewExpiryDate,
  type ExpiryValue,
} from "@/components/admin/ExpiryDial";
import { EntityAuditList } from "@/components/admin/audit/EntityAuditList";
import {
  getCustomerProfileAction,
  resetCustomerPasswordAction,
  setCustomerStatusAction,
  updateCustomerAction,
  updateCustomerNotesAction,
  type CustomerProfile,
  type UpdateCustomerInput,
} from "@/server/actions/customers";
import {
  approveAccessAction,
  extendAccessAction,
  rejectAccessAction,
  revokeAccessAction,
} from "@/server/actions/access";
import type { CustomerRowData } from "@/app/admin/customers/page";
import type { CustomerStatus } from "@/lib/schemas/shared";

/**
 * CustomerDetailModal — the one place an admin views and edits a customer.
 * A centered Dialog on desktop, a full-height bottom Sheet on mobile (the house
 * pattern; see ConfirmSheet / BrandFormDialog).
 *
 * Two kinds of change live here and are deliberately styled apart:
 *
 *  - Detail fields + private notes are edited freely and committed by the ONE
 *    Save button in the sticky footer. Closing with unsaved edits asks first.
 *  - Access actions (approve / update expiry / revoke / block / reset password)
 *    apply the moment they are tapped, so they sit in their own
 *    "applies right away" card.
 *
 * All state lives in this single component (rather than a child body) so that
 * switching between the sheet and the dialog — e.g. a phone rotating across the
 * breakpoint — never throws away half-typed edits.
 *
 * After every action the profile is re-read from the server: `router.refresh()`
 * alone only refreshes the page's SERVER props, while the grant history here is
 * client state, and a stale list made admins think an expiry change had failed.
 */

const STATUS_VARIANT: Record<CustomerStatus, StatusChipVariant> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  BLOCKED: "blocked",
};

/* ------------------------------------------------------------------ */
/* form model + validation (mirrors updateCustomerSchema)              */
/* ------------------------------------------------------------------ */

const DETAIL_KEYS = [
  "businessName",
  "contactName",
  "city",
  "gstNumber",
  "email",
] as const;

type DetailKey = (typeof DETAIL_KEYS)[number];

interface FormValues {
  businessName: string;
  contactName: string;
  city: string;
  gstNumber: string;
  email: string;
  notes: string;
}

const FIELD_LABEL: Record<DetailKey, string> = {
  businessName: "Business name",
  contactName: "Contact person",
  city: "City",
  gstNumber: "GST number",
  email: "Email",
};

/** Fields that may be left empty — an empty value CLEARS the stored one. */
const CLEARABLE: ReadonlySet<DetailKey> = new Set<DetailKey>([
  "city",
  "gstNumber",
  "email",
]);

/** Max notes length accepted by `updateCustomerNotesAction`. */
const NOTES_MAX = 2000;

/** Server-side GSTIN shape (see `gstinSchema`), checked before the checksum. */
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** Pragmatic email shape — the server's zod check stays authoritative. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toForm(source: CustomerProfile | CustomerDetailSeed): FormValues {
  return {
    businessName: source.businessName ?? "",
    contactName: source.contactName ?? "",
    city: source.city ?? "",
    gstNumber: source.gstNumber ?? "",
    email: source.email ?? "",
    notes: source.notes ?? "",
  };
}

/**
 * Per-field rules, matching `updateCustomerSchema`. An empty optional field is
 * valid and CLEARS the stored value — that meaning is preserved here. Returns a
 * plain-English message naming the problem, or null when the value is fine.
 */
function validateDetail(key: DetailKey, raw: string): string | null {
  const value = raw.trim();
  switch (key) {
    case "businessName":
      if (value.length === 0) return "Business name is required.";
      if (value.length < 2) return "Business name needs at least 2 characters.";
      if (value.length > 120)
        return "Business name can be at most 120 characters.";
      return null;
    case "contactName":
      if (value.length === 0) return "Contact person is required.";
      if (value.length < 2) return "Contact person needs at least 2 characters.";
      if (value.length > 80)
        return "Contact person can be at most 80 characters.";
      return null;
    case "city":
      if (value.length === 0) return null; // empty clears the city
      if (value.length < 2)
        return "City needs at least 2 characters, or leave it empty.";
      if (value.length > 80) return "City can be at most 80 characters.";
      return null;
    case "gstNumber": {
      if (value.length === 0) return null; // empty clears the GST number
      const gstin = value.toUpperCase();
      if (!GSTIN_SHAPE.test(gstin)) {
        return "A GST number is 15 characters, like 27AAAAA0000A1Z5.";
      }
      if (!isValidGstin(gstin)) {
        return "The last (check) character of this GST number doesn't match. Please re-check it.";
      }
      return null;
    }
    case "email":
      if (value.length === 0) return null; // empty clears the email
      if (!EMAIL_SHAPE.test(value)) {
        return "Enter a valid email address, or leave it empty.";
      }
      return null;
  }
}

function validateNotes(raw: string): string | null {
  return raw.trim().length > NOTES_MAX
    ? `Notes can be at most ${NOTES_MAX} characters.`
    : null;
}

/* ------------------------------------------------------------------ */
/* formatting                                                          */
/* ------------------------------------------------------------------ */

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", DATE_FORMAT);
}

function formatDateObject(date: Date): string {
  return date.toLocaleDateString("en-IN", DATE_FORMAT);
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

/**
 * What the caller already knows about the customer.
 *
 * Only the id is required. Everything else is a HINT used to paint the modal
 * before the profile finishes loading — the server profile is the truth and
 * overwrites all of it. That is what lets a surface which holds only part of
 * a customer open this modal: the access-requests queue, for instance, knows
 * the customerId, business name and phone but nothing about notes, email or
 * price access.
 *
 * `CustomerRowData` from the customers table satisfies this shape as-is.
 */
export interface CustomerDetailSeed {
  id: string;
  businessName?: string;
  contactName?: string;
  phone?: string;
  email?: string | null;
  gstNumber?: string | null;
  city?: string | null;
  status?: CustomerStatus;
  notes?: string | null;
  priceAccess?: boolean;
  expiresAt?: string | null;
}

export interface CustomerDetailModalProps {
  /** The customer to show. `null` renders nothing. */
  customer: CustomerDetailSeed | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CustomerDetailModal({
  customer,
  open,
  onOpenChange,
}: CustomerDetailModalProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { prompt, element: promptElement } = usePromptDialog();

  const customerId = customer?.id ?? "";

  const [profile, setProfile] = React.useState<CustomerProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  /** Server truth for the editable fields — what "changed" is measured against. */
  const [baseline, setBaseline] = React.useState<FormValues | null>(null);
  const [form, setForm] = React.useState<FormValues | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [saveReport, setSaveReport] = React.useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [expiry, setExpiry] = React.useState<ExpiryValue>({
    kind: "days",
    days: 30,
  });

  // Reset for a fresh open, adjusted during render (no reset effect).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setProfile(null);
      setBaseline(null);
      setForm(null);
      setLoading(true);
      setLoadError(null);
      setSaveReport(null);
      setDiscardOpen(false);
      setExpiry({ kind: "days", days: 30 });
      setReloadKey((k) => k + 1);
    }
  }

  /**
   * Re-read the profile. Called on open AND after every action: the grant and
   * request history below is client state, so without this an admin who just
   * changed the expiry keeps reading the old date and concludes it didn't work.
   */
  const loadProfile = React.useCallback(async (): Promise<CustomerProfile | null> => {
    if (!customerId) return null;
    const res = await getCustomerProfileAction(customerId);
    if (!res.ok) {
      setLoadError(res.error);
      return null;
    }
    setLoadError(null);
    setProfile(res.profile);
    return res.profile;
  }, [customerId]);

  /** First load (and Retry): also seeds the form + its baseline. */
  React.useEffect(() => {
    if (!open || !customerId) return;
    let active = true;
    // setState happens only in the async continuation — never synchronously in
    // the effect body (react-hooks/set-state-in-effect).
    getCustomerProfileAction(customerId).then(
      (res) => {
        if (!active) return;
        if (res.ok) {
          setProfile(res.profile);
          setBaseline(toForm(res.profile));
          setForm(toForm(res.profile));
          setLoadError(null);
        } else {
          setLoadError(res.error);
        }
        setLoading(false);
      },
      () => {
        if (!active) return;
        setLoadError("Could not load this customer. Please try again.");
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [customerId, open, reloadKey]);

  const retryLoad = React.useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }, []);

  /* ---------------- dirty + validation ---------------- */

  const dirtyDetailKeys = React.useMemo<DetailKey[]>(() => {
    if (!form || !baseline) return [];
    return DETAIL_KEYS.filter((k) => form[k] !== baseline[k]);
  }, [form, baseline]);

  const notesDirty = Boolean(form && baseline && form.notes !== baseline.notes);
  const dirty = dirtyDetailKeys.length > 0 || notesDirty;

  /**
   * Errors are shown for the fields the admin actually CHANGED — only those are
   * sent to the server, so an existing record with (say) an odd GST number can
   * never block an unrelated edit.
   */
  const fieldErrors = React.useMemo<Partial<Record<DetailKey, string>>>(() => {
    if (!form) return {};
    const errors: Partial<Record<DetailKey, string>> = {};
    for (const key of dirtyDetailKeys) {
      const message = validateDetail(key, form[key]);
      if (message) errors[key] = message;
    }
    return errors;
  }, [form, dirtyDetailKeys]);

  const notesError = form && notesDirty ? validateNotes(form.notes) : null;
  const hasErrors = Object.keys(fieldErrors).length > 0 || notesError !== null;

  const setField = React.useCallback((key: keyof FormValues, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  /* ---------------- close guard ---------------- */

  /** Returns true when it is safe to close; otherwise asks to discard first. */
  const requestClose = React.useCallback(() => {
    if (dirty && !saving) {
      setDiscardOpen(true);
      return false;
    }
    return true;
  }, [dirty, saving]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next && !requestClose()) return;
      onOpenChange(next);
    },
    [onOpenChange, requestClose],
  );

  /* ---------------- immediate access actions ---------------- */

  const run = React.useCallback(
    async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy(true);
      try {
        const res = await fn();
        if (res.ok) {
          toast.success(label);
          router.refresh();
          // The page behind us re-renders from the server; the history in this
          // modal is client state and needs its own re-read.
          const fresh = await loadProfile();
          if (fresh) setBaseline(toForm(fresh));
        } else {
          toast.error(res.error ?? "Something went wrong. Please try again.");
        }
        return res.ok;
      } finally {
        setBusy(false);
      }
    },
    [loadProfile, router],
  );

  const approve = React.useCallback(
    () =>
      run("Access approved", () =>
        approveAccessAction({ customerId, expiry: expiryValueToInput(expiry) }),
      ),
    [customerId, expiry, run],
  );
  const updateExpiry = React.useCallback(
    () =>
      run("Expiry updated", () =>
        extendAccessAction({ customerId, expiry: expiryValueToInput(expiry) }),
      ),
    [customerId, expiry, run],
  );
  const revoke = React.useCallback(
    () => run("Access revoked", () => revokeAccessAction({ customerId })),
    [customerId, run],
  );
  const reject = React.useCallback(
    () =>
      run("Request rejected", () =>
        rejectAccessAction({ customerId, reason: undefined }),
      ),
    [customerId, run],
  );
  const block = React.useCallback(
    () =>
      run("Customer blocked", () =>
        setCustomerStatusAction(customerId, "BLOCKED"),
      ),
    [customerId, run],
  );
  const unblock = React.useCallback(
    () =>
      run("Customer unblocked", () =>
        setCustomerStatusAction(customerId, "REJECTED"),
      ),
    [customerId, run],
  );

  const businessName = profile?.businessName ?? customer?.businessName ?? "";

  const resetPassword = React.useCallback(async () => {
    const pw = await prompt({
      title: "Reset password",
      description: `Set a new password for ${businessName}.`,
      kind: "password",
      placeholder: "New password",
      confirmLabel: "Reset password",
      validate: (value) =>
        value.trim().length < 8 ? "Use at least 8 characters." : null,
    });
    if (pw === null) return;
    await run("Password reset", () =>
      resetCustomerPasswordAction({ customerId, password: pw }),
    );
  }, [businessName, customerId, prompt, run]);

  /* ---------------- the one Save ---------------- */

  const handleSave = React.useCallback(async () => {
    if (!form || !baseline || saving || !dirty || hasErrors || !customerId) {
      return;
    }

    const detailsDirty = dirtyDetailKeys.length > 0;
    const savingNotes = form.notes !== baseline.notes;

    setSaving(true);
    setSaveReport(null);
    try {
      let detailsFailure: string | null = null;
      let notesFailure: string | null = null;

      if (detailsDirty) {
        // Only the changed fields are sent, so the audit diff is accurate and
        // untouched fields are never re-validated by the server.
        const patch: UpdateCustomerInput = {};
        if (dirtyDetailKeys.includes("businessName")) {
          patch.businessName = form.businessName.trim();
        }
        if (dirtyDetailKeys.includes("contactName")) {
          patch.contactName = form.contactName.trim();
        }
        if (dirtyDetailKeys.includes("city")) {
          patch.city = form.city.trim(); // "" clears it
        }
        if (dirtyDetailKeys.includes("gstNumber")) {
          patch.gstNumber = form.gstNumber.trim().toUpperCase(); // "" clears it
        }
        if (dirtyDetailKeys.includes("email")) {
          patch.email = form.email.trim(); // "" clears it
        }
        const res = await updateCustomerAction(customerId, patch);
        if (!res.ok) detailsFailure = res.error;
      }

      if (savingNotes) {
        const trimmed = form.notes.trim();
        const res = await updateCustomerNotesAction({
          customerId,
          notes: trimmed === "" ? null : trimmed,
        });
        if (!res.ok) notesFailure = res.error;
      }

      const detailsSaved = detailsDirty && detailsFailure === null;
      const notesSaved = savingNotes && notesFailure === null;

      // Say exactly what saved and what did not — never a bare "went wrong"
      // that leaves the admin guessing which half landed.
      if (detailsFailure === null && notesFailure === null) {
        toast.success(
          detailsSaved && notesSaved
            ? "Details and notes saved"
            : detailsSaved
              ? "Details saved"
              : "Notes saved",
        );
      } else {
        let message: string;
        if (detailsFailure !== null && notesFailure !== null) {
          message = `Nothing was saved. Details: ${detailsFailure} Notes: ${notesFailure}`;
        } else if (detailsFailure !== null) {
          message = notesSaved
            ? `Notes saved. The details did NOT save: ${detailsFailure}`
            : `The details did not save: ${detailsFailure}`;
        } else {
          message = detailsSaved
            ? `Details saved. The notes did NOT save: ${notesFailure}`
            : `The notes did not save: ${notesFailure}`;
        }
        setSaveReport(message);
        toast.error(message);
      }

      // Re-read so the baseline is the server's truth again. Only the parts
      // that saved are reset — a failed part keeps the admin's text (and stays
      // marked unsaved) so Save doubles as retry.
      const fresh = await loadProfile();
      if (fresh) {
        const server = toForm(fresh);
        setBaseline(server);
        setForm((prev) => {
          if (!prev) return server;
          const next = { ...prev };
          if (detailsSaved) {
            for (const key of DETAIL_KEYS) next[key] = server[key];
          }
          if (notesSaved) next.notes = server.notes;
          return next;
        });
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }, [
    baseline,
    customerId,
    dirty,
    dirtyDetailKeys,
    form,
    hasErrors,
    loadProfile,
    router,
    saving,
  ]);

  if (!customer) return null;

  /* ---------------- derived view state ---------------- */

  const view = profile ?? customer;
  // A seed need not carry these — the requests queue knows a customerId and a
  // name, not a status or a join date. They render as soon as the profile
  // lands; until then we show a safe placeholder rather than crash.
  const status: CustomerStatus = profile?.status ?? customer.status ?? "PENDING";
  const lastLoginAt = profile?.lastLoginAt ?? null;
  const createdAt = profile?.createdAt ?? null;
  // The seed may not carry it (a request row does not know), so default to
  // the safe answer until the profile arrives.
  const priceAccess = profile ? profile.priceAccess : (customer.priceAccess ?? false);
  const isBlocked = status === "BLOCKED";
  const canApprove =
    status === "PENDING" || status === "REJECTED" || status === "EXPIRED";
  const anyBusy = busy || saving;
  const previewDate = previewExpiryDate(expiry);

  /* ---------------- pieces ---------------- */

  const header = (
    <span className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 truncate">{view.businessName}</span>
      <StatusChip variant={STATUS_VARIANT[status]} />
    </span>
  );

  const headerDescription = (
    <>
      {view.phone}
      {priceAccess ? " · price access live" : " · no price access"}
      {view.expiresAt ? ` · expires ${formatDate(view.expiresAt)}` : ""}
    </>
  );

  const content = loading ? (
    <LoadingSkeleton />
  ) : loadError && !profile ? (
    <div className="rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
      <p role="alert">{loadError}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={retryLoad}>
        Try again
      </Button>
    </div>
  ) : (
    <div className="space-y-6">
      {/* ---- Access: applies the moment you tap ---- */}
      <section className="rounded-xl border border-primary/25 bg-primary/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Access</h3>
          <Badge variant="outline" className="gap-1 bg-background">
            <Zap aria-hidden />
            Applies right away
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {priceAccess
            ? view.expiresAt
              ? `Price access is live until ${formatDate(view.expiresAt)}.`
              : "Price access is live and does not expire."
            : "This customer cannot see prices right now."}
        </p>

        {(canApprove || priceAccess) && (
          <div className="mt-3 rounded-lg border border-border bg-background p-3">
            <ExpiryDial
              value={expiry}
              onChange={setExpiry}
              disabled={anyBusy}
              compact
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {canApprove && (
                <Button size="sm" onClick={approve} disabled={anyBusy}>
                  {busy ? (
                    <Loader2Icon className="animate-spin" aria-hidden />
                  ) : (
                    <ShieldCheck className="size-4" aria-hidden />
                  )}
                  Approve access
                </Button>
              )}
              {priceAccess && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={updateExpiry}
                  disabled={anyBusy}
                >
                  {busy ? (
                    <Loader2Icon className="animate-spin" aria-hidden />
                  ) : (
                    <Clock className="size-4" aria-hidden />
                  )}
                  Update expiry
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {previewDate
                ? `Sets the expiry to ${formatDateObject(previewDate)} — this can shorten it as well as extend it.`
                : "Sets access to never expire."}
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {priceAccess && (
            <ConfirmSheet
              title="Revoke access?"
              description="The customer will immediately lose price access and be signed out."
              confirmLabel="Revoke"
              destructive
              onConfirm={async () => {
                await revoke();
              }}
              trigger={
                <Button size="sm" variant="outline" disabled={anyBusy}>
                  <XCircle className="size-4" aria-hidden />
                  Revoke
                </Button>
              }
            />
          )}
          {status === "PENDING" && (
            <ConfirmSheet
              title="Reject this request?"
              description="The customer stays on file but does not get price access."
              confirmLabel="Reject"
              destructive
              onConfirm={async () => {
                await reject();
              }}
              trigger={
                <Button size="sm" variant="outline" disabled={anyBusy}>
                  Reject
                </Button>
              }
            />
          )}
          {isBlocked ? (
            <Button
              size="sm"
              variant="outline"
              onClick={unblock}
              disabled={anyBusy}
            >
              <ShieldCheck className="size-4" aria-hidden />
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
                <Button size="sm" variant="outline" disabled={anyBusy}>
                  <ShieldBan className="size-4" aria-hidden />
                  Block
                </Button>
              }
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={resetPassword}
            disabled={anyBusy}
          >
            <KeyRound className="size-4" aria-hidden />
            Reset password
          </Button>
        </div>
      </section>

      {/* ---- Details + notes: saved by the footer button ---- */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Details</h3>
          <p className="text-xs text-muted-foreground">
            Edit freely — nothing changes until you tap Save changes.
          </p>
        </div>

        {form ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="cust-phone">Phone</Label>
              <Input
                id="cust-phone"
                value={view.phone}
                readOnly
                disabled
                className="tabular-nums"
              />
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <LockKeyhole className="size-3 shrink-0" aria-hidden />
                This is the customer&apos;s login, so it can&apos;t be changed
                here.
              </p>
            </div>

            {DETAIL_KEYS.map((key) => {
              const error = fieldErrors[key];
              const errorId = `cust-${key}-error`;
              return (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`cust-${key}`}>{FIELD_LABEL[key]}</Label>
                  {key === "city" ? (
                    <CityField
                      id={`cust-${key}`}
                      source="customers"
                      disabled={anyBusy}
                      value={form.city}
                      onValueChange={(v) => setField("city", v)}
                    />
                  ) : (
                    <Input
                      id={`cust-${key}`}
                      value={form[key]}
                      disabled={anyBusy}
                      inputMode={key === "email" ? "email" : undefined}
                      autoCapitalize={key === "email" ? "none" : undefined}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      onChange={(e) => setField(key, e.target.value)}
                    />
                  )}
                  {error ? (
                    <p
                      id={errorId}
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {error}
                    </p>
                  ) : CLEARABLE.has(key) ? (
                    <p className="text-xs text-muted-foreground">
                      Leave empty to clear it.
                    </p>
                  ) : null}
                </div>
              );
            })}

            <div className="space-y-1 pt-2">
              <Label htmlFor="cust-notes">Private notes</Label>
              <textarea
                id="cust-notes"
                value={form.notes}
                rows={4}
                maxLength={NOTES_MAX}
                disabled={anyBusy}
                onChange={(e) => setField("notes", e.target.value)}
                placeholder="Only your team can see this."
                aria-invalid={notesError ? true : undefined}
                aria-describedby={notesError ? "cust-notes-error" : undefined}
                className={cn(
                  "w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
                  notesError && "border-destructive",
                )}
              />
              {notesError ? (
                <p
                  id="cust-notes-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {notesError}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      {/* ---- History ---- */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">History</h3>
        <p className="text-xs text-muted-foreground">
          Last login {formatDate(lastLoginAt)} · joined {formatDate(createdAt)}
        </p>
        {profile ? (
          <>
            <div className="space-y-1">
              <p className="text-xs font-medium">Access grants</p>
              {profile.grants.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No access has been granted yet.
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {profile.grants.slice(0, 6).map((g) => (
                    <li key={g.id}>
                      Granted {formatDate(g.approvedAt)}
                      {g.expiresAt
                        ? ` → expires ${formatDate(g.expiresAt)}`
                        : " → no expiry"}
                      {g.revokedAt
                        ? ` · revoked ${formatDate(g.revokedAt)}`
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">Requests</p>
              {profile.requests.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No access requests on file.
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {profile.requests.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      Request {r.status.toLowerCase()} ·{" "}
                      {formatDate(r.createdAt)}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Loading history…</p>
        )}
      </section>

      {/* ---- Recent changes (audit trail) ---- */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Recent changes</h3>
        <EntityAuditList entity="Customer" entityId={customer.id} />
      </section>
    </div>
  );

  // Sits between the scrolling body and the footer, so the outcome of a save
  // stays visible right where the Save button is.
  const saveBanner = saveReport ? (
    <p
      role="alert"
      className="mx-4 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive md:mx-0"
    >
      {saveReport}
    </p>
  ) : null;

  const footerStatus = dirty ? (
    hasErrors ? (
      <span className="text-xs text-destructive">
        Fix the highlighted fields to save.
      </span>
    ) : (
      <Badge variant="secondary" className="shrink-0">
        Unsaved changes
      </Badge>
    )
  ) : (
    <span className="text-xs text-muted-foreground">
      {loading ? "Loading…" : "Everything is saved."}
    </span>
  );

  const saveButton = (
    <Button
      onClick={handleSave}
      disabled={!dirty || hasErrors || saving || busy || loading}
      data-loading={saving || undefined}
    >
      {saving ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
      {saving ? "Saving…" : "Save changes"}
    </Button>
  );

  const closeButton = (
    <Button
      variant="outline"
      disabled={saving}
      onClick={() => {
        if (requestClose()) onOpenChange(false);
      }}
    >
      Close
    </Button>
  );

  const discardConfirm = (
    <ConfirmSheet
      title="Discard changes?"
      description="Your edits to this customer have not been saved yet."
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      destructive
      open={discardOpen}
      onOpenChange={setDiscardOpen}
      onConfirm={() => {
        setDiscardOpen(false);
        onOpenChange(false);
      }}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // min-h + max-h rather than a plain height: SheetContent's own
          // `data-[side=bottom]:h-auto` out-specifies an unprefixed height
          // utility and would collapse the sheet to its content.
          className="max-h-[92dvh] min-h-[92dvh] gap-0 rounded-t-2xl"
        >
          <div
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted"
          />
          <SheetHeader className="shrink-0 pb-2">
            <SheetTitle className="text-left">{header}</SheetTitle>
            <SheetDescription className="text-left">
              {headerDescription}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {content}
          </div>
          {saveBanner}
          <SheetFooter className="shrink-0 gap-2 border-t bg-muted/50 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-center">
              {footerStatus}
            </div>
            {saveButton}
            {closeButton}
          </SheetFooter>
        </SheetContent>
        {discardConfirm}
        {promptElement}
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-4 sm:max-w-lg">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{header}</DialogTitle>
          <DialogDescription>{headerDescription}</DialogDescription>
        </DialogHeader>
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          {content}
        </div>
        {saveBanner}
        <DialogFooter className="shrink-0 sm:items-center sm:justify-between">
          {footerStatus}
          <div className="flex gap-2 sm:justify-end">
            {closeButton}
            {saveButton}
          </div>
        </DialogFooter>
      </DialogContent>
      {discardConfirm}
      {promptElement}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* loading skeleton                                                    */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading customer…</span>
      <div className="space-y-3 rounded-xl border border-border p-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-16 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-16" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
