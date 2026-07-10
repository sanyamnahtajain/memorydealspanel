"use client";

/**
 * BatchCameraCapture — full-screen mobile capture overlay (PRD F-A10a).
 *
 * Opens a live `getUserMedia` viewfinder (rear camera by default), lets the
 * operator fire off many shots in a row via a big shutter button, and grows a
 * thumbnail strip along the bottom without ever leaving the camera. Thumbs can
 * be reviewed full-screen or deleted (retake). "Done (N)" returns the captured
 * `File[]` through `onCapture`.
 *
 * This component ONLY captures and returns Files — it never uploads. Wire the
 * returned files into the standard compress+upload pipeline upstream.
 *
 * Graceful degradation:
 *  - permission denied / no camera / insecure context  → file-input fallback
 *    (`<input type=file accept=image/* capture=environment multiple>`).
 *  - front/back toggle only shown when >1 video input exists.
 *  - torch button only shown when the active track advertises the capability.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Camera,
  Check,
  RotateCcw,
  SwitchCamera,
  Trash2,
  X,
  Zap,
  ZapOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScaleTap } from "@/components/motion/primitives";
import { springs } from "@/components/motion/tokens";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface BatchCameraCaptureProps {
  /**
   * Called once, with every captured File, when the operator taps "Done".
   * The overlay closes immediately after (the parent should unmount it via
   * `onClose`). Never called with an empty array.
   */
  onCapture: (files: File[]) => void;
  /** Called when the overlay should close (Done, cancel, or backdrop escape). */
  onClose: () => void;
  /** JPEG quality for captured frames, 0–1. Defaults to 0.9. */
  quality?: number;
  className?: string;
}

/** A single pending shot held in the strip before Done. */
interface Shot {
  id: string;
  file: File;
  /** Object URL for the thumbnail preview; revoked on delete/unmount. */
  url: string;
}

type CameraState = "idle" | "starting" | "live" | "denied" | "unsupported";

type FacingMode = "environment" | "user";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

let shotCounter = 0;
function nextShotId(): string {
  shotCounter += 1;
  return `shot-${Date.now()}-${shotCounter}`;
}

function isMediaSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

/**
 * Torch is a non-standard MediaTrackConstraint / capability. Model it loosely
 * so we can feature-detect without fighting the DOM lib types (which don't
 * declare `torch`).
 */
type TorchCapableTrack = MediaStreamTrack;
interface TorchConstraintSet {
  torch?: boolean;
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function BatchCameraCapture({
  onCapture,
  onClose,
  quality = 0.9,
  className,
}: BatchCameraCaptureProps) {
  const reduced = useReducedMotion();

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const fallbackInputRef = React.useRef<HTMLInputElement>(null);

  const [state, setState] = React.useState<CameraState>("idle");
  const [facing, setFacing] = React.useState<FacingMode>("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = React.useState(false);
  const [torchSupported, setTorchSupported] = React.useState(false);
  const [torchOn, setTorchOn] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const [flash, setFlash] = React.useState(false);

  const [shots, setShots] = React.useState<Shot[]>([]);
  const [reviewId, setReviewId] = React.useState<string | null>(null);

  // Keep a ref of shots so cleanup can revoke URLs without stale closures.
  const shotsRef = React.useRef<Shot[]>([]);
  React.useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  /* ----- stream lifecycle ----------------------------------------- */

  const stopStream = React.useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    setTorchOn(false);
  }, []);

  const startStream = React.useCallback(
    async (mode: FacingMode) => {
      if (!isMediaSupported() || !window.isSecureContext) {
        setState("unsupported");
        return;
      }
      setState("starting");
      stopStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode } },
          audio: false,
        });
        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // iOS Safari needs an explicit play() after srcObject assignment.
          try {
            await video.play();
          } catch {
            /* autoplay race — the muted+playsInline attrs cover the rest */
          }
        }

        // Detect torch capability on the active video track.
        const [track] = stream.getVideoTracks() as TorchCapableTrack[];
        const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorchSupported(Boolean(caps?.torch));

        // Detect whether a front/back toggle is meaningful.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const cams = devices.filter((d) => d.kind === "videoinput");
          setHasMultipleCameras(cams.length > 1);
        } catch {
          setHasMultipleCameras(false);
        }

        setState("live");
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setState("denied");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setState("unsupported");
        } else {
          setState("denied");
        }
      }
    },
    [stopStream],
  );

  // Mount: kick off the camera. Unmount: stop everything and revoke URLs.
  // startStream synchronises React with an external system (the MediaStream),
  // which is exactly what an effect is for; its internal setState calls report
  // acquisition progress and are intentional here.
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  React.useEffect(() => {
    void startStream("environment");
    return () => {
      stopStream();
      for (const shot of shotsRef.current) URL.revokeObjectURL(shot.url);
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

  /* ----- torch ----------------------------------------------------- */

  const toggleTorch = React.useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const [track] = stream.getVideoTracks() as TorchCapableTrack[];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as TorchConstraintSet],
      } as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      // Torch failed to apply — hide the control so it can't mislead.
      setTorchSupported(false);
      setTorchOn(false);
    }
  }, [torchOn]);

  /* ----- facing toggle -------------------------------------------- */

  const flipCamera = React.useCallback(() => {
    const next: FacingMode = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void startStream(next);
  }, [facing, startStream]);

  /* ----- capture --------------------------------------------------- */

  const captureFrame = React.useCallback(async () => {
    const video = videoRef.current;
    if (!video || state !== "live" || capturing) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    setCapturing(true);
    // Quick shutter flash for tactile feedback.
    if (!reduced) {
      setFlash(true);
      window.setTimeout(() => setFlash(false), 120);
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Mirror the front camera so the saved image matches what the operator saw.
      if (facing === "user") {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, w, h);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
      );
      if (!blob) return;

      const file = new File([blob], `capture-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      const shot: Shot = { id: nextShotId(), file, url: URL.createObjectURL(blob) };
      setShots((prev) => [...prev, shot]);
    } finally {
      setCapturing(false);
    }
  }, [state, capturing, reduced, facing, quality]);

  /* ----- strip management ----------------------------------------- */

  const deleteShot = React.useCallback((id: string) => {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
    setReviewId((cur) => (cur === id ? null : cur));
  }, []);

  /* ----- done / cancel -------------------------------------------- */

  const handleDone = React.useCallback(() => {
    if (shots.length === 0) {
      onClose();
      return;
    }
    // Hand over files first, then release the camera and close.
    onCapture(shots.map((s) => s.file));
    stopStream();
    onClose();
  }, [shots, onCapture, stopStream, onClose]);

  const handleCancel = React.useCallback(() => {
    stopStream();
    onClose();
  }, [stopStream, onClose]);

  /* ----- fallback file input -------------------------------------- */

  const onFallbackFiles = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length === 0) return;
      onCapture(files);
      onClose();
    },
    [onCapture, onClose],
  );

  const reviewShot = reviewId ? shots.find((s) => s.id === reviewId) ?? null : null;

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex flex-col overflow-hidden bg-black text-white",
        className,
      )}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Camera capture"
    >
      {/* Hidden fallback input — always mounted so any state can invoke it. */}
      <input
        ref={fallbackInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={onFallbackFiles}
      />

      {/* Top bar */}
      <div className="relative z-20 flex items-center justify-between px-3 py-2">
        <ScaleTap>
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={handleCancel}
            aria-label="Close camera"
            className="rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
          >
            <X className="size-5" />
          </Button>
        </ScaleTap>

        <div className="flex items-center gap-2">
          {state === "live" && torchSupported && (
            <ScaleTap>
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={toggleTorch}
                aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
                aria-pressed={torchOn}
                className={cn(
                  "rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white",
                  torchOn && "bg-white/90 text-black hover:bg-white hover:text-black",
                )}
              >
                {torchOn ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
              </Button>
            </ScaleTap>
          )}
          {state === "live" && hasMultipleCameras && (
            <ScaleTap>
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={flipCamera}
                aria-label="Switch camera"
                className="rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
              >
                <SwitchCamera className="size-5" />
              </Button>
            </ScaleTap>
          )}
        </div>
      </div>

      {/* Viewfinder / states */}
      <div className="relative flex-1 overflow-hidden">
        {/* Live video (kept mounted whenever supported so the ref is stable) */}
        {state !== "denied" && state !== "unsupported" && (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={cn(
              "absolute inset-0 h-full w-full object-cover",
              facing === "user" && "-scale-x-100",
            )}
          />
        )}

        {(state === "idle" || state === "starting") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
            <Camera className="size-8 animate-pulse text-white/70" />
            <p className="text-sm text-white/70">Starting camera…</p>
          </div>
        )}

        {(state === "denied" || state === "unsupported") && (
          <CameraFallback
            reason={state}
            onPickFiles={() => fallbackInputRef.current?.click()}
            onRetry={() => void startStream(facing)}
          />
        )}

        {/* Shutter flash */}
        <AnimatePresence>
          {flash && (
            <motion.div
              className="pointer-events-none absolute inset-0 bg-white"
              initial={{ opacity: 0.85 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Bottom controls: thumbnail strip + shutter + done */}
      {state === "live" && (
        <div className="relative z-20 flex flex-col gap-3 px-3 pt-3 pb-4">
          {/* Growing thumbnail strip */}
          {shots.length > 0 && (
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              style={{ scrollbarWidth: "none" }}
            >
              <AnimatePresence initial={false}>
                {shots.map((shot, i) => (
                  <motion.button
                    key={shot.id}
                    type="button"
                    layout={!reduced}
                    initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    transition={springs.snappy}
                    onClick={() => setReviewId(shot.id)}
                    aria-label={`Review photo ${i + 1}`}
                    className="relative size-16 shrink-0 overflow-hidden rounded-lg border-2 border-white/25 outline-none focus-visible:border-white"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={shot.url}
                      alt={`Captured photo ${i + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            {/* Left spacer keeps the shutter optically centered */}
            <div className="w-24 shrink-0" />

            {/* Shutter */}
            <ScaleTap scale={0.9}>
              <button
                type="button"
                onClick={captureFrame}
                disabled={capturing}
                aria-label="Capture photo"
                className={cn(
                  "flex size-[72px] items-center justify-center rounded-full border-4 border-white outline-none transition-opacity focus-visible:ring-4 focus-visible:ring-white/50 disabled:opacity-60",
                )}
              >
                <span className="size-14 rounded-full bg-white transition-transform active:scale-90" />
              </button>
            </ScaleTap>

            {/* Done */}
            <div className="flex w-24 shrink-0 justify-end">
              <ScaleTap>
                <Button
                  onClick={handleDone}
                  disabled={shots.length === 0}
                  size="lg"
                  aria-label={`Done, use ${shots.length} photos`}
                  className="h-11 min-w-[88px] gap-1.5 rounded-full bg-white text-black hover:bg-white/90"
                >
                  <Check className="size-4" />
                  Done ({shots.length})
                </Button>
              </ScaleTap>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen review overlay for a single shot */}
      <AnimatePresence>
        {reviewShot && (
          <motion.div
            className="absolute inset-0 z-30 flex flex-col bg-black/95"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <ScaleTap>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  onClick={() => setReviewId(null)}
                  aria-label="Back to camera"
                  className="rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
                >
                  <RotateCcw className="size-5" />
                </Button>
              </ScaleTap>
              <ScaleTap>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => deleteShot(reviewShot.id)}
                  aria-label="Delete this photo"
                  className="h-11 gap-1.5 rounded-full bg-black/40 text-white hover:bg-destructive/30 hover:text-white"
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </ScaleTap>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-hidden p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={reviewShot.url}
                alt="Captured photo preview"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fallback panel                                                     */
/* ------------------------------------------------------------------ */

function CameraFallback({
  reason,
  onPickFiles,
  onRetry,
}: {
  reason: "denied" | "unsupported";
  onPickFiles: () => void;
  onRetry: () => void;
}) {
  const denied = reason === "denied";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-white/10">
        <Camera className="size-7 text-white/70" />
      </div>
      <div className="space-y-1">
        <p className="font-heading text-base font-medium">
          {denied ? "Camera access blocked" : "Camera unavailable"}
        </p>
        <p className="mx-auto max-w-xs text-sm text-white/60">
          {denied
            ? "We couldn't reach the camera. Allow access in your browser settings, or pick photos from your device instead."
            : "No usable camera was found on this device. You can still pick photos from your files."}
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ScaleTap>
          <Button
            onClick={onPickFiles}
            size="lg"
            className="h-11 rounded-full bg-white text-black hover:bg-white/90"
          >
            Choose photos
          </Button>
        </ScaleTap>
        {denied && (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm text-white/60 underline-offset-4 hover:underline"
          >
            Try camera again
          </button>
        )}
      </div>
    </div>
  );
}
