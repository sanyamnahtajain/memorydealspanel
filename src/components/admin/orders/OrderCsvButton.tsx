"use client";

/**
 * OrderCsvButton — export a single order's snapshot as a CSV, generated
 * entirely client-side from the already-loaded (admin-gated) detail. No new
 * endpoint is introduced, so there's no additional surface to authorise: the
 * data was already delivered to this authenticated admin view.
 */

import * as React from "react";
import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OrderDetailDTO } from "@/server/actions/admin-orders";

/** RFC-4180-ish escaping: wrap in quotes and double any embedded quote. */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(order: OrderDetailDTO): string {
  const rupees = (paise: number) => (paise / 100).toFixed(2);
  const header = [
    "Order",
    "Status",
    "Placed",
    "Customer",
    "Phone",
    "Product",
    "Variant",
    "SKU",
    "Qty",
    "Unit (INR)",
    "Line total (INR)",
  ];
  const rows = order.items.map((line) =>
    [
      order.orderNumber,
      order.status,
      new Date(order.placedAt).toISOString(),
      order.customer?.businessName ?? "",
      order.customer?.phone ?? "",
      line.name,
      line.variantLabel ?? "",
      line.sku,
      line.quantity,
      rupees(line.unitPricePaise),
      rupees(line.lineTotalPaise),
    ].map(csvCell).join(","),
  );
  const totalRow = [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    order.itemCount,
    "",
    rupees(order.subtotalPaise),
  ]
    .map(csvCell)
    .join(",");
  return [header.map(csvCell).join(","), ...rows, totalRow].join("\r\n");
}

export function OrderCsvButton({ order }: { order: OrderDetailDTO }) {
  const download = React.useCallback(() => {
    const csv = buildCsv(order);
    const blob = new Blob([`﻿${csv}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `order-${order.orderNumber}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [order]);

  return (
    <Button variant="outline" size="sm" onClick={download}>
      <DownloadIcon aria-hidden />
      Export CSV
    </Button>
  );
}
