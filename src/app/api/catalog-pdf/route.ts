import { NextResponse } from "next/server";

import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { buildCatalogPdf } from "@/server/services/catalog-pdf";

/**
 * GET /api/catalog-pdf — download the product catalogue as a PDF.
 *
 * THE PRICE GATE IS RESOLVED HERE, SERVER-SIDE, from the session — never from
 * a query param: an admin or an APPROVED buyer with a live grant gets the
 * priced PRICE LIST; everyone else gets the public catalogue whose query never
 * even selects a money column. Anonymous access is allowed (the public PDF is
 * exactly what the public storefront already shows).
 */

export const dynamic = "force-dynamic";

/** Today's date as `YYYY-MM-DD` for the download filename. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(): Promise<NextResponse> {
  const viewer = await resolveViewer();
  const priced = isAdmin(viewer) || canSeePrices(viewer);

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
