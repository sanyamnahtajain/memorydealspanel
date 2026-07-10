"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { InfinityIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { ACCESS_EXPIRY_PRESETS_DAYS } from "@/lib/constants";
import { springs } from "@/components/motion/tokens";

/* ------------------------------------------------------------------ */
/* Value model                                                         */
/* ------------------------------------------------------------------ */

/**
 * The value produced by the dial.
 *
 * - `{ kind: "days", days }` — grant is valid for `days` from approval.
 * - `{ kind: "never" }`      — open-ended grant (no expiry).
 *
 * Convert to the `expiry` argument expected by `approveAccessAction` /
 * `extendAccessAction` with {@link expiryValueToInput}: a `days` value maps
 * to `{ presetDays }` when it matches a preset, otherwise to a concrete
 * `{ expiresAt }` ISO timestamp; `never` maps to `{ expiresAt: null }`.
 */
export type ExpiryValue =
  | { kind: "days"; days: number }
  | { kind: "never" };

/** Shape accepted by the access server actions' `expiry` field. */
export interface ExpiryActionInput {
  presetDays?: number;
  expiresAt?: string | null;
}

const PRESETS = ACCESS_EXPIRY_PRESETS_DAYS;
/** Slider domain: 1 day … 2 years. The dial arc maps onto this range. */
const MIN_DAYS = 1;
const MAX_DAYS = 730;

/** Returns `true` when `days` is one of the quick-pick presets. */
function isPreset(days: number): boolean {
  return (PRESETS as readonly number[]).includes(days);
}

/**
 * Maps an {@link ExpiryValue} to the `expiry` payload for the access actions.
 * Computes `expiresAt` from `from` (defaults to now) for non-preset day counts
 * so the server stores the exact date the admin previewed.
 */
export function expiryValueToInput(
  value: ExpiryValue,
  from: Date = new Date(),
): ExpiryActionInput {
  if (value.kind === "never") return { expiresAt: null };
  if (isPreset(value.days)) return { presetDays: value.days };
  const expiresAt = new Date(from);
  expiresAt.setDate(expiresAt.getDate() + value.days);
  return { expiresAt: expiresAt.toISOString() };
}

/** Concrete expiry date for a value, or `null` for a never-expiring grant. */
export function previewExpiryDate(
  value: ExpiryValue,
  from: Date = new Date(),
): Date | null {
  if (value.kind === "never") return null;
  const date = new Date(from);
  date.setDate(date.getDate() + value.days);
  return date;
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const SIZE = 176;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CENTER = SIZE / 2;
// A 270° arc (gap at the bottom) reads as a dial rather than a full ring.
const ARC_DEGREES = 270;
const START_ANGLE = 135; // bottom-left, sweeping clockwise
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_LENGTH = CIRCUMFERENCE * (ARC_DEGREES / 360);

/** 0..1 progress along the log-scaled day range (min→max). */
function daysToProgress(days: number): number {
  const clamped = Math.min(Math.max(days, MIN_DAYS), MAX_DAYS);
  return Math.log(clamped / MIN_DAYS) / Math.log(MAX_DAYS / MIN_DAYS);
}

function progressToDays(progress: number): number {
  const clamped = Math.min(Math.max(progress, 0), 1);
  const raw = MIN_DAYS * Math.pow(MAX_DAYS / MIN_DAYS, clamped);
  return Math.round(raw);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface ExpiryDialProps {
  /** Controlled value. */
  value: ExpiryValue;
  /** Called with the next value on any interaction. */
  onChange: (value: ExpiryValue) => void;
  /** Reference date the "expires on" preview counts from. Defaults to now. */
  from?: Date;
  /** Disables all interaction. */
  disabled?: boolean;
  /** Hides the large radial dial, leaving chips + slider (compact/cell use). */
  compact?: boolean;
  className?: string;
  /** id for the slider, so an external <label> can point at it. */
  id?: string;
}

/**
 * Radial validity picker for access grants (F-A25 / F-U16).
 *
 * Quick-pick chips (7 / 30 / 90 days, Custom, Never), a fine-grained slider,
 * and a live "expires on <date>" preview. Fully controlled: it holds no
 * value of its own, so the same instance drives both the approval flow and
 * the CustomerSheet expiry cell editor.
 */
export function ExpiryDial({
  value,
  onChange,
  from,
  disabled = false,
  compact = false,
  className,
  id,
}: ExpiryDialProps) {
  const reduced = useReducedMotion();
  const sliderId = React.useId();
  const resolvedId = id ?? sliderId;

  const isNever = value.kind === "never";
  const days = value.kind === "days" ? value.days : MAX_DAYS;
  const progress = isNever ? 1 : daysToProgress(days);
  const expiryDate = previewExpiryDate(value, from);

  const dashOffset = ARC_LENGTH * (1 - (isNever ? 1 : progress));

  const selectDays = React.useCallback(
    (next: number) => {
      if (disabled) return;
      onChange({ kind: "days", days: Math.min(Math.max(next, MIN_DAYS), MAX_DAYS) });
    },
    [disabled, onChange],
  );

  const selectNever = React.useCallback(() => {
    if (disabled) return;
    onChange({ kind: "never" });
  }, [disabled, onChange]);

  const handleSlider = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      selectDays(progressToDays(Number(event.target.value) / 1000));
    },
    [selectDays],
  );

  const arcTransition = reduced ? { duration: 0 } : springs.gentle;

  return (
    <div
      data-slot="expiry-dial"
      className={cn("flex flex-col items-center gap-4", className)}
    >
      {!compact && (
        <div
          className="relative"
          style={{ width: SIZE, height: SIZE }}
          role="img"
          aria-label={
            isNever
              ? "Access never expires"
              : `Access valid for ${days} ${days === 1 ? "day" : "days"}`
          }
        >
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="-rotate-90"
            aria-hidden
          >
            {/* Track */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke="var(--muted)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
              transform={`rotate(${START_ANGLE} ${CENTER} ${CENTER})`}
            />
            {/* Progress */}
            <motion.circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={isNever ? "var(--success)" : "var(--primary)"}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
              transform={`rotate(${START_ANGLE} ${CENTER} ${CENTER})`}
              initial={false}
              animate={{ strokeDashoffset: dashOffset }}
              transition={arcTransition}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            {isNever ? (
              <>
                <InfinityIcon
                  className="size-8 text-success"
                  strokeWidth={2.2}
                  aria-hidden
                />
                <span className="text-xs font-medium text-muted-foreground">
                  Never expires
                </span>
              </>
            ) : (
              <>
                <span className="font-heading text-4xl font-semibold tabular-nums tracking-tight text-foreground">
                  {days}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {days === 1 ? "day" : "days"}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Quick-pick chips */}
      <div
        className="flex flex-wrap items-center justify-center gap-2"
        role="group"
        aria-label="Access validity presets"
      >
        {PRESETS.map((preset) => {
          const active = !isNever && days === preset;
          return (
            <PresetChip
              key={preset}
              active={active}
              disabled={disabled}
              onClick={() => selectDays(preset)}
            >
              {preset}d
            </PresetChip>
          );
        })}
        <PresetChip
          active={!isNever && !isPreset(days)}
          disabled={disabled}
          onClick={() => selectDays(isPreset(days) ? 45 : days)}
        >
          Custom
        </PresetChip>
        <PresetChip active={isNever} disabled={disabled} onClick={selectNever}>
          Never
        </PresetChip>
      </div>

      {/* Fine-grained slider (drives Custom) */}
      <div className="w-full max-w-xs px-1">
        <input
          id={resolvedId}
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(progress * 1000)}
          onChange={handleSlider}
          disabled={disabled || isNever}
          aria-label="Access validity in days"
          aria-valuetext={
            isNever ? "Never expires" : `${days} ${days === 1 ? "day" : "days"}`
          }
          className={cn(
            "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted outline-none transition-opacity",
            "focus-visible:ring-3 focus-visible:ring-ring/50",
            "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:active:scale-110",
            "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary",
            (disabled || isNever) && "cursor-not-allowed opacity-40",
          )}
        />
      </div>

      {/* Live preview */}
      <p
        className="text-center text-sm text-muted-foreground"
        aria-live="polite"
      >
        {isNever ? (
          <span className="font-medium text-foreground">
            Access will not expire
          </span>
        ) : (
          <>
            Expires on{" "}
            <span className="font-medium text-foreground">
              {expiryDate ? dateFormatter.format(expiryDate) : "—"}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preset chip                                                         */
/* ------------------------------------------------------------------ */

function PresetChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 min-w-11 items-center justify-center rounded-full border px-3 text-sm font-medium outline-none transition-[background-color,color,border-color,transform] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:pointer-events-none disabled:opacity-40",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-transparent text-foreground/80 hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
