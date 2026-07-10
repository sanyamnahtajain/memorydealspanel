"use client";

/**
 * CameraTrigger — the "Add photos" entry point for the product image workflow.
 *
 * On a touch/mobile device with camera support it opens {@link BatchCameraCapture}
 * as a full-screen overlay so the operator can rapid-fire many shots. On desktop
 * (or where the media APIs / secure context are missing) it degrades cleanly to a
 * plain multi-file picker.
 *
 * Either path forwards the chosen `File[]` to `onFiles` — typically the
 * ImageManager's `onAddFiles`, which runs them through the standard
 * compress + upload pipeline. This component performs no upload itself.
 */

import * as React from "react";
import { Camera, ImagePlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScaleTap } from "@/components/motion/primitives";
import { useIsMobile } from "@/components/common/use-is-mobile";
import { BatchCameraCapture } from "./BatchCameraCapture";

export interface CameraTriggerProps {
  /**
   * Receives every File the operator captured/selected. Wire this to the
   * ImageManager's `onAddFiles` so images flow through compress + upload.
   */
  onFiles: (files: File[]) => void;
  /** Disable the trigger (e.g. while at the image-count limit). */
  disabled?: boolean;
  /** Button label. Defaults to "Add photos". */
  label?: string;
  /** JPEG quality forwarded to the camera capture, 0–1. */
  quality?: number;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}

/**
 * Feature-detect a usable live camera. We require the media API AND a secure
 * context (getUserMedia is gated to https / localhost). Coarse pointer /
 * mobile viewport is used as the heuristic for *preferring* the batch overlay.
 */
/** No-op subscription — the client snapshot never changes after hydration. */
function subscribeNoop(): () => void {
  return () => {};
}

function canUseLiveCamera(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    window.isSecureContext === true
  );
}

export function CameraTrigger({
  onFiles,
  disabled = false,
  label = "Add photos",
  quality,
  variant = "outline",
  size = "default",
  className,
}: CameraTriggerProps) {
  const isMobile = useIsMobile();
  const desktopInputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);

  // getUserMedia / isSecureContext are only meaningful on the client. Resolve
  // via useSyncExternalStore so the server renders the neutral (false) branch
  // and the client corrects on hydration — no setState-in-effect.
  const mounted = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const preferCamera = mounted && isMobile && canUseLiveCamera();

  const handleClick = React.useCallback(() => {
    if (disabled) return;
    if (preferCamera) {
      setOpen(true);
    } else {
      desktopInputRef.current?.click();
    }
  }, [disabled, preferCamera]);

  const handleDesktopFiles = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  const handleCapture = React.useCallback(
    (files: File[]) => {
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  return (
    <>
      <ScaleTap>
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled}
          onClick={handleClick}
          className={cn("gap-1.5", className)}
        >
          {preferCamera ? (
            <Camera className="size-4" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {label}
        </Button>
      </ScaleTap>

      {/* Desktop / fallback multi-file picker. */}
      <input
        ref={desktopInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={handleDesktopFiles}
      />

      {/* Full-screen batch camera overlay (mobile). */}
      {open && (
        <BatchCameraCapture
          quality={quality}
          onCapture={handleCapture}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
