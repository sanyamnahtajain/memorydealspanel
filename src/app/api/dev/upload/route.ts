import { NextResponse, type NextRequest } from "next/server";

import { resolveViewer } from "@/server/auth/viewer";
import { isR2Configured, localDiskFallback } from "@/server/storage/r2";

/**
 * PUT /api/dev/upload?key=… — the local-disk half of `createUploadTarget()`.
 *
 * When R2 is not configured (a laptop running `next dev`), upload flows get a
 * target pointing here instead of a presigned R2 URL; this writes the body to
 * public/uploads/<key> so the file is served statically.
 *
 * It exists ONLY in development without R2: in production, or whenever R2 is
 * configured, it answers 404 as if it were not there. Even then it requires a
 * signed-in viewer (the same people who can mint an upload target) and caps
 * the body size, and `save()` refuses any path outside public/uploads.
 */

export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPE = /^(image|video)\//;

function available(): boolean {
  return process.env.NODE_ENV !== "production" && !isR2Configured();
}

export async function PUT(request: NextRequest) {
  if (!available()) {
    return new NextResponse(null, { status: 404 });
  }

  const viewer = await resolveViewer();
  if (viewer.kind === "anon") {
    return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!ALLOWED_TYPE.test(contentType)) {
    return NextResponse.json({ error: "Only images and videos." }, { status: 415 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "File too large." }, { status: 413 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Empty or too large." }, { status: 413 });
  }

  try {
    const url = await localDiskFallback.save(key, body);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }
}
