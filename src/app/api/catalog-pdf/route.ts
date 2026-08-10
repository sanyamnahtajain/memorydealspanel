import { NextResponse } from "next/server";

import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { buildCatalogPdf } from "@/server/services/catalog-pdf";

/**
 * GET /api/catalog-pdf — download the product catalogue as a PDF.
 *
 * ADMIN-ONLY (owner request): storefront users no longer get a catalogue
 * download; non-admin requests 404. Admins always receive the priced
 * PRICE LIST (the gate is resolved server-side from the session).
 */

export const dynamic = "force-dynamic";

/** Today's date as `YYYY-MM-DD` for the download filename. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(): Promise<NextResponse> {
  const viewer = await resolveViewer();
  // Owner request: the catalogue download is an ADMIN tool only — storefront
  // users (even approved buyers) no longer get a download endpoint.
  if (!isAdmin(viewer)) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }
  const priced = true;

  try {
    const bytes = await buildCatalogPdf(priced);
    const filename = `memorydeals-${priced ? "price-list" : "catalogue"}-${todayStamp()}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("catalog-pdf failed", err);
    return NextResponse.json(
      { ok: false, error: "Could not generate the PDF. Please try again." },
      { status: 500 },
    );
  }
}
