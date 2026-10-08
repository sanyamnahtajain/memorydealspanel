/**
 * Browser-side helpers for the reel form: a direct PUT with progress, and
 * reading a clip's duration before it is uploaded.
 *
 * Kept free of React so they can be reasoned about (and swapped) on their
 * own; the components only wire them to state.
 */

export interface PutTarget {
  uploadUrl: string;
  headers: Record<string, string>;
}

/** PUT a blob straight to the presigned URL, reporting 0..1 progress. */
export function putWithProgress(
  target: PutTarget,
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.uploadUrl, true);
    for (const [key, value] of Object.entries(target.headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(blob);
  });
}

/**
 * Read a local clip's duration in whole seconds via a detached <video>.
 * Resolves null when the browser can't decode it (unsupported codec, a
 * .mov Chrome won't open) or takes longer than `timeoutMs` — the duration
 * is a nice-to-have for the storefront's progress bar, never a blocker.
 */
export function probeVideoDuration(
  file: Blob,
  timeoutMs = 8_000,
): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const d = video.duration;
      finish(Number.isFinite(d) && d > 0 ? Math.max(1, Math.round(d)) : null);
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** "0:42" / "1:05" for a seconds count. */
export function formatDuration(sec: number | null | undefined): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
