import { NextResponse } from "next/server";

import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { buildOrderPdf } from "@/server/services/order-pdf";

/**
 * GET /api/order-pdf/[id] — download a received order as an estimate-format
 * PDF. ADMIN-ONLY: order snapshots carry wholesale prices, so a non-admin is
 * refused before any data is read.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  try {
    const result = await buildOrderPdf(id);
    if (!result) {
      return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
    }
    return new NextResponse(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="order-${result.orderNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("order-pdf failed", err);
    return NextResponse.json(
      { ok: false, error: "Could not generate the PDF. Please try again." },
      { status: 500 },
    );
  }
}
