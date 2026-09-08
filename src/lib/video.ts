/**
 * Product demo videos.
 *
 * WHY THE LIMITS ARE TIGHT: unlike images, which are resized and compressed in
 * the browser before upload (src/lib/image.ts), a video is uploaded exactly as
 * the phone recorded it — there is no client-side transcode. A single minute of
 * 4K phone video is ~150MB. Object storage is cheap but not free, and every
 * byte is also a byte the buyer downloads on mobile data, so the ceilings here
 * are deliberately low and enforced on BOTH sides (browser + server).
 *
 * Short clips are also simply better for the job: a wholesale buyer wants ten
 * seconds showing the product turning, not a two-minute unboxing.
 */

/** What a phone or laptop actually produces. */
export const ACCEPTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  // iPhones record .mov; Safari reports this type.
  "video/quicktime",
] as const;

export type AcceptedVideoMime = (typeof ACCEPTED_VIDEO_MIME_TYPES)[number];

/** Per-file ceiling. Enforced client-side for a good error, server-side for real. */
export const MAX_VIDEO_MB = 30;
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;

/** Per-product ceiling. A catalogue, not a channel. */
export const MAX_VIDEOS_PER_PRODUCT = 2;

/** The `accept` attribute for the file picker. */
export const VIDEO_ACCEPT_ATTR = ACCEPTED_VIDEO_MIME_TYPES.join(",");

export function isAcceptedVideoType(type: string): type is AcceptedVideoMime {
  return (ACCEPTED_VIDEO_MIME_TYPES as readonly string[]).includes(type);
}

/** File extension for a storage key. Quicktime keeps .mov so Safari is happy. */
export function videoExtensionForType(type: string): string {
  switch (type) {
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    default:
      return "mp4";
  }
}

export interface VideoRejection {
  reason: "type" | "size" | "count";
  message: string;
}

/**
 * Validate one picked file against the type, size and count ceilings. Returns
 * null when it is fine. Pure, so the same rules run in the browser (for a
 * useful message) and on the server (for the actual guarantee).
 */
export function rejectVideo(
  file: { name: string; type: string; size: number },
  existingCount: number,
): VideoRejection | null {
  if (existingCount >= MAX_VIDEOS_PER_PRODUCT) {
    return {
      reason: "count",
      message: `A product can have at most ${MAX_VIDEOS_PER_PRODUCT} videos.`,
    };
  }
  if (!isAcceptedVideoType(file.type)) {
    return {
      reason: "type",
      message: `"${file.name}" is not a supported video (use MP4, WebM or MOV).`,
    };
  }
  if (file.size > MAX_VIDEO_BYTES) {
    const mb = Math.ceil(file.size / (1024 * 1024));
    return {
      reason: "size",
      message: `"${file.name}" is ${mb}MB — the limit is ${MAX_VIDEO_MB}MB. Trim the clip and try again.`,
    };
  }
  return null;
}

/**
 * Whether the clip at `videoIndex` is the slide currently on screen.
 *
 * The gallery lays photos out first and clips after them, so slide indices
 * `videoStart..videoStart+n-1` map to clips `0..n-1`. The gallery uses this to
 * pause every clip that is NOT on screen — otherwise swiping away from a
 * playing video leaves its audio running over the next photo, which reads as
 * a bug rather than a feature.
 *
 * Extracted as a pure function because the browser's autoplay and
 * background-tab policies make this behaviour unreliable to assert in an
 * automated page; the arithmetic is worth pinning on its own.
 */
export function isVideoSlideActive(
  videoIndex: number,
  selected: number,
  videoStart: number,
): boolean {
  return selected - videoStart === videoIndex;
}
