import { NextResponse, type NextRequest } from "next/server";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import {
  buildCatalogWorkbook,
  workbookToCsv,
  workbookToXlsx,
} from "@/server/actions/export";

/**
 * GET /api/export — download the full catalog.
 *
 * Admin-only: the viewer is resolved from the session and a non-admin gets a
 * 403 before any data is read. The default response is an `.xlsx` workbook;
 * `?format=csv` returns the same rows as a CSV. The filename embeds today's
 * date: `memorydeals-catalog-YYYY-MM-DD.{xlsx|csv}`.
 */

export const dynamic = "force-dynamic";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

/** Today's date as `YYYY-MM-DD` for the download filename. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return NextResponse.json(
      { ok: false, error: "Admin access required." },
      { status: 403 },
    );
  }

  const format = request.nextUrl.searchParams.get("format") === "csv"
    ? "csv"
    : "xlsx";

  try {
    const { workbook } = await buildCatalogWorkbook();
    const filename = `memorydeals-catalog-${todayStamp()}.${format}`;

    const body =
      format === "csv"
        ? workbookToCsv(workbook)
        : new Uint8Array(workbookToXlsx(workbook));

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": format === "csv" ? CSV_CONTENT_TYPE : XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/export] failed to build catalog export:", error);
    return NextResponse.json(
      { ok: false, error: "Could not generate the export. Please try again." },
      { status: 500 },
    );
  }
}
