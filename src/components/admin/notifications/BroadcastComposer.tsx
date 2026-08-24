"use client";

import * as React from "react";
import { toast } from "sonner";
import { Megaphone, RotateCcw, Send, Store, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  BROADCAST_BODY_MAX,
  BROADCAST_SEGMENT_INFO,
  BROADCAST_TITLE_MAX,
  isAppRelativeUrl,
  type BroadcastSegment,
} from "@/lib/broadcast";
import type { CustomerRow } from "@/server/actions/customers";
import {
  previewBroadcastAudienceAction,
  sendBroadcastAction,
} from "@/server/actions/broadcast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmSheet } from "@/components/common";
import { BroadcastCustomerPicker } from "./BroadcastCustomerPicker";
import { NotificationPreviewCard } from "./NotificationPreviewCard";

/**
 * The custom-notification composer.
 *
 * Everything the owner needs to decide is on ONE screen and in this order:
 * who it goes to → how many people that is → what it says → what it will look
 * like on their phone → send.
 *
 * The recipient count is not decoration. It is fetched from the server for the
 * exact audience selected (`previewBroadcastAudienceAction`), refreshed
 * whenever the audience changes, and repeated inside the confirmation — the
 * owner should never press send without knowing how many phones will ring.
 *
 * No native <select> and no window.confirm anywhere: the audience is a row of
 * real buttons, and sending goes through `ConfirmSheet` (a bottom sheet on a
 * phone, a dialog on desktop).
 */

type Audience = "customer" | "admin";

const AUDIENCES: { key: Audience; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    key: "customer",
    label: "Customers",
    hint: "The shops that buy from you.",
    icon: <Users aria-hidden />,
  },
  {
    key: "admin",
    label: "Staff",
    hint: "Everyone working in the shop.",
    icon: <Store aria-hidden />,
  },
];

export function BroadcastComposer() {
  const [audience, setAudience] = React.useState<Audience>("customer");
  const [segment, setSegment] = React.useState<BroadcastSegment>("all");
  const [customer, setCustomer] = React.useState<CustomerRow | null>(null);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [url, setUrl] = React.useState("");

  const [recipients, setRecipients] = React.useState<number | null>(null);
  const [countLoading, setCountLoading] = React.useState(false);
  const [countError, setCountError] = React.useState<string | null>(null);
  const [countAttempt, setCountAttempt] = React.useState(0);

  const [sending, setSending] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const customerId = customer?.id ?? null;
  const needsCustomer = audience === "customer" && segment === "one";
  const audienceReady = !needsCustomer || customerId !== null;

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const trimmedUrl = url.trim();
  const urlInvalid = trimmedUrl !== "" && !isAppRelativeUrl(trimmedUrl);

  const canSend =
    audienceReady &&
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= BROADCAST_TITLE_MAX &&
    trimmedBody.length > 0 &&
    trimmedBody.length <= BROADCAST_BODY_MAX &&
    !urlInvalid &&
    !sending;

  /* --- recipient count, refreshed whenever the audience changes -------- */
  // The count is fetched from a scheduled task rather than straight from the
  // effect body, so a rapid audience change cancels the previous request
  // instead of stacking renders. While `audienceReady` is false the render
  // below never reads `recipients`, so there is nothing to reset here.
  React.useEffect(() => {
    if (!audienceReady) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      setCountLoading(true);
      void (async () => {
        try {
          const res = await previewBroadcastAudienceAction({
            audience,
            segment: audience === "admin" ? "all" : segment,
            customerId,
          });
          if (cancelled) return;
          if (res.ok) {
            setRecipients(res.recipients);
            setCountError(null);
          } else {
            setRecipients(null);
            setCountError(res.error);
          }
        } catch {
          if (!cancelled) {
            setRecipients(null);
            setCountError("Could not count the people this reaches.");
          }
        } finally {
          if (!cancelled) setCountLoading(false);
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audience, segment, customerId, audienceReady, countAttempt]);

  const noun = audience === "admin" ? "staff device" : "customer";
  const recipientLine =
    recipients === null
      ? null
      : recipients === 1
        ? `This will reach 1 ${noun}.`
        : `This will reach ${recipients} ${noun}s.`;

  /**
   * Awaited by the ConfirmSheet, so its confirm button shows a real spinner
   * and the surface cannot be dismissed mid-send. THROWING keeps the sheet
   * open (the sheet's contract) — on a failure the owner still has the message
   * in front of them and can simply press send again.
   */
  async function send(): Promise<void> {
    setSending(true);
    try {
      const res = await sendBroadcastAction({
        audience,
        segment: audience === "admin" ? "all" : segment,
        customerId,
        title: trimmedTitle,
        body: trimmedBody,
        url: trimmedUrl === "" ? null : trimmedUrl,
      }).catch(() => {
        // The action itself never throws; this is the network dying under it.
        return { ok: false as const, error: "No connection. Please try again." };
      });
      if (!res.ok) {
        toast.error(res.error);
        throw new Error(res.error);
      }
      toast.success(
        res.sent === 0
          ? "Message saved, but no device was reachable right now."
          : `Message sent to ${res.sent} device${res.sent === 1 ? "" : "s"}.`,
      );
      setTitle("");
      setBody("");
      setUrl("");
      setCountAttempt((n) => n + 1);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      {/* ------------------------------------------------ compose ------ */}
      <div className="space-y-6">
        {/* Audience */}
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-foreground">
            1. Who gets this?
          </h2>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {AUDIENCES.map((option) => (
              <ChoiceButton
                key={option.key}
                active={audience === option.key}
                disabled={sending}
                onClick={() => {
                  setAudience(option.key);
                  if (option.key === "admin") setCustomer(null);
                }}
                icon={option.icon}
                label={option.label}
                hint={option.hint}
              />
            ))}
          </div>

          {audience === "customer" ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium text-foreground">
                Which customers?
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {BROADCAST_SEGMENT_INFO.map((option) => (
                  <ChoiceButton
                    key={option.key}
                    active={segment === option.key}
                    disabled={sending}
                    onClick={() => {
                      setSegment(option.key);
                      if (option.key !== "one") setCustomer(null);
                    }}
                    label={option.label}
                    hint={option.hint}
                  />
                ))}
              </div>

              {needsCustomer ? (
                <BroadcastCustomerPicker
                  selected={customer}
                  onSelect={setCustomer}
                  disabled={sending}
                />
              ) : null}
            </div>
          ) : null}

          {/* Recipient count — loading / error+retry / result / blocked. */}
          <div
            aria-live="polite"
            className="mt-4 flex min-h-9 flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
          >
            {!audienceReady ? (
              <span className="text-muted-foreground">
                Pick a customer to see how many people this reaches.
              </span>
            ) : countLoading ? (
              <>
                <Spinner size="xs" label="" />
                <span className="text-muted-foreground">Counting…</span>
              </>
            ) : countError ? (
              <>
                <span className="text-destructive">{countError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCountAttempt((n) => n + 1)}
                >
                  <RotateCcw aria-hidden />
                  Try again
                </Button>
              </>
            ) : recipients === 0 ? (
              <span className="text-warning-foreground dark:text-warning">
                Nobody is in this group right now.
              </span>
            ) : (
              <span className="font-medium text-foreground">
                {recipientLine}
              </span>
            )}
          </div>

          {audience === "customer" && recipients !== null && recipients > 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Customers who turned off shop news will not get it. Blocked shops
              never get it.
            </p>
          ) : null}
        </section>

        {/* Message */}
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-foreground">
            2. What does it say?
          </h2>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="broadcast-title">Title</Label>
              <Counter value={trimmedTitle.length} max={BROADCAST_TITLE_MAX} />
            </div>
            <Input
              id="broadcast-title"
              value={title}
              disabled={sending}
              maxLength={BROADCAST_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="New stock just arrived"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="broadcast-body">Message</Label>
              <Counter value={trimmedBody.length} max={BROADCAST_BODY_MAX} />
            </div>
            <textarea
              id="broadcast-body"
              value={body}
              disabled={sending}
              rows={4}
              maxLength={BROADCAST_BODY_MAX}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Fresh stock of batteries and screens. Open the app to see prices."
              className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">
              Keep it short and simple. Phones only show the first two lines.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="broadcast-url">Page to open (optional)</Label>
            <Input
              id="broadcast-url"
              value={url}
              disabled={sending}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="/products"
              aria-invalid={urlInvalid}
              aria-describedby="broadcast-url-hint"
            />
            <p
              id="broadcast-url-hint"
              className={cn(
                "text-xs",
                urlInvalid ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {urlInvalid
                ? "Only pages inside this app. Start with “/”, for example /products."
                : "Leave it empty to open the home page."}
            </p>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------ preview ------ */}
      <aside className="space-y-4 lg:sticky lg:top-4">
        <NotificationPreviewCard title={title} body={body} url={url} />

        <ConfirmSheet
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Send this message?"
          description={
            recipients === null
              ? "We could not count the people this reaches. It will still be sent to everyone in the group you picked."
              : recipients === 1
                ? `It goes to 1 ${noun}. This cannot be taken back.`
                : `It goes to ${recipients} ${noun}s. This cannot be taken back.`
          }
          confirmLabel="Yes, send it"
          cancelLabel="Not yet"
          onConfirm={send}
        >
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="line-clamp-1 text-sm font-semibold text-foreground">
              {trimmedTitle || "—"}
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
              {trimmedBody || "—"}
            </p>
          </div>
        </ConfirmSheet>

        <Button
          type="button"
          className="w-full"
          disabled={!canSend}
          onClick={() => setConfirmOpen(true)}
        >
          {sending ? <Spinner size="xs" label="" /> : <Send aria-hidden />}
          {sending ? "Sending…" : "Send message"}
        </Button>

        {!canSend && !sending ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Megaphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {!audienceReady
              ? "Pick the customer first."
              : urlInvalid
                ? "Fix the page link first."
                : "Write a title and a message first."}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* small pieces                                                        */
/* ------------------------------------------------------------------ */

function ChoiceButton({
  active,
  disabled,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-primary bg-primary/10"
          : "border-border bg-background hover:bg-muted",
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  const near = value > max * 0.9;
  return (
    <span
      className={cn(
        "font-tabular text-xs",
        near ? "text-warning-foreground dark:text-warning" : "text-muted-foreground",
      )}
    >
      {value}/{max}
    </span>
  );
}
