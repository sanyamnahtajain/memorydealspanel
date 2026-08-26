import type { Metadata } from "next";
import { BuildingIcon, MailIcon, MapPinIcon, PhoneIcon } from "lucide-react";

import { requireAdminPage } from "@/server/auth/require-admin-page";
import { listContactMessages } from "@/server/services/contact-messages";
import { relativeTime } from "@/lib/audit-format";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader, EmptyState, StatusChip } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Pager } from "@/components/common/Pager";
import { MarkDoneButton } from "./MarkDoneButton";
import { ReasonText } from "./ReasonText";

export const metadata: Metadata = {
  title: "Contact messages — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function parsePage(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/**
 * Admin › Contact messages — everything sent through the public contact form.
 * Writers are NOT customers (Google-verified strangers, or signed-in buyers
 * who used the form), so this queue is separate from access requests: staff
 * call the number back, then mark the message done.
 *
 * Guarded by `requireAdminPage` (like the notification settings page): reading
 * and answering the shop's messages is every staff member's job.
 */
export default async function AdminContactPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;

  const { messages, total, newCount, page, pageCount, pageSize } =
    await listContactMessages(parsePage(sp.page));

  return (
    <AdminShell title="Contact messages">
      <div className="space-y-6">
        <PageHeader
          title="Contact messages"
          description="Messages from the contact form. Call the number back, then mark the message done."
        />

        {newCount > 0 ? (
          <Badge variant="secondary" className="text-sm">
            {newCount} new {newCount === 1 ? "message" : "messages"}
          </Badge>
        ) : null}

        {messages.length === 0 ? (
          <EmptyState
            illustration="empty-box"
            title="No messages yet"
            description="When someone writes to the shop through the contact form, it shows up here."
          />
        ) : (
          <>
            <ul className="space-y-3">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className="rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {m.name || m.phone}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {relativeTime(m.createdAt)}
                        {m.status === "DONE" && m.handledAt
                          ? ` · done ${relativeTime(m.handledAt)}`
                          : null}
                      </p>
                    </div>
                    {m.status === "NEW" ? (
                      <StatusChip variant="pending" label="New" />
                    ) : (
                      <StatusChip variant="approved" label="Done" />
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                    <a
                      href={`tel:${m.phone}`}
                      className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <PhoneIcon className="size-3.5" aria-hidden />
                      {m.phone}
                    </a>
                    {m.email ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <MailIcon className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{m.email}</span>
                      </span>
                    ) : null}
                    {m.businessName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <BuildingIcon className="size-3.5" aria-hidden />
                        {m.businessName}
                      </span>
                    ) : null}
                    {m.city ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPinIcon className="size-3.5" aria-hidden />
                        {m.city}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    <ReasonText text={m.reason} />
                  </div>

                  {m.status === "NEW" ? (
                    <div className="mt-3 flex justify-end">
                      <MarkDoneButton id={m.id} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <Pager
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              total={total}
            />
          </>
        )}
      </div>
    </AdminShell>
  );
}
