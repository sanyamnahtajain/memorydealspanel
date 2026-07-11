"use client"

import * as React from "react"
import {
  Columns3,
  LayoutGrid,
  Rows3,
  Rows4,
  Sparkles,
  Table as TableIcon,
} from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import {
  PAGE_SIZES,
  usePreferences,
  type Density,
  type PageSize,
  type ViewMode,
} from "./PreferencesProvider"

const SNAPPY_SPRING: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.7,
}

/* ------------------------------------------------------------------ *
 * Custom segmented control (never a native <select>).
 * A single spring-driven pill slides between options via layoutId.
 * ------------------------------------------------------------------ */

interface SegmentOption<T> {
  value: T
  label: string
  tooltip?: string
  icon?: typeof LayoutGrid
}

interface SegmentedProps<T extends string | number> {
  ariaLabel: string
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
}

function Segmented<T extends string | number>({
  ariaLabel,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  const reduced = useReducedMotion()
  const spring: Transition = reduced ? { duration: 0 } : SNAPPY_SPRING
  const groupId = React.useId()

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex w-full items-center gap-0.5 rounded-full border border-border bg-muted/50 p-0.5"
    >
      {options.map((option) => {
        const Icon = option.icon
        const selected = value === option.value
        const button = (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95",
              selected
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {selected && (
              <motion.span
                layoutId={`segmented-active-${groupId}`}
                transition={spring}
                className="absolute inset-0 rounded-full bg-background shadow-xs ring-1 ring-border"
                aria-hidden
              />
            )}
            {Icon && (
              <Icon
                className="relative size-4 shrink-0"
                strokeWidth={selected ? 2.4 : 2}
                aria-hidden
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        )
        return option.tooltip ? (
          <Tooltip key={String(option.value)} content={option.tooltip}>
            {button}
          </Tooltip>
        ) : (
          button
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Custom token-styled switch (no native checkbox chrome).
 * ------------------------------------------------------------------ */

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

function Switch({ checked, onChange, label }: SwitchProps) {
  const reduced = useReducedMotion()
  const spring: Transition = reduced
    ? { duration: 0 }
    : { type: "spring", stiffness: 700, damping: 40, mass: 0.6 }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent p-0.5 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <motion.span
        layout
        transition={spring}
        className={cn(
          "block size-4.5 rounded-full bg-background shadow-sm",
          checked ? "ml-auto" : "ml-0"
        )}
        aria-hidden
      />
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Section wrapper for consistent labelling.
 * ------------------------------------------------------------------ */

function Field({
  title,
  description,
  control,
}: {
  title: string
  description?: string
  control: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
      {control}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

/* ------------------------------------------------------------------ *
 * Option catalogues.
 * ------------------------------------------------------------------ */

const DENSITY_OPTIONS: ReadonlyArray<SegmentOption<Density>> = [
  {
    value: "comfortable",
    label: "Comfortable",
    icon: Rows3,
    tooltip: "Roomier spacing",
  },
  {
    value: "compact",
    label: "Compact",
    icon: Rows4,
    tooltip: "Tighter rows, more on screen",
  },
]

const VIEW_OPTIONS: ReadonlyArray<SegmentOption<ViewMode>> = [
  { value: "grid", label: "Grid", icon: LayoutGrid, tooltip: "Card grid" },
  {
    value: "compact",
    label: "Compact",
    icon: Columns3,
    tooltip: "Dense cards",
  },
  { value: "table", label: "Table", icon: TableIcon, tooltip: "Data table" },
]

const PAGE_SIZE_OPTIONS: ReadonlyArray<SegmentOption<PageSize>> = PAGE_SIZES.map(
  (size) => ({ value: size, label: String(size) })
)

/* ------------------------------------------------------------------ *
 * Panel.
 * ------------------------------------------------------------------ */

export interface PreferencesPanelProps {
  className?: string
}

/**
 * Custom UI-preferences panel. Every control applies instantly (no Save) and
 * persists via {@link usePreferences}. Uses only custom, token-styled
 * segmented controls and a switch — never native form chrome.
 */
export function PreferencesPanel({ className }: PreferencesPanelProps) {
  const {
    density,
    setDensity,
    defaultViewMode,
    setDefaultViewMode,
    reduceMotion,
    setReduceMotion,
    pageSize,
    setPageSize,
  } = usePreferences()

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <section className="flex flex-col gap-4">
        <SectionHeading>Layout</SectionHeading>

        <Field
          title="Density"
          description="How much breathing room lists and tables use."
          control={
            <Segmented
              ariaLabel="Density"
              options={DENSITY_OPTIONS}
              value={density}
              onChange={setDensity}
            />
          }
        />

        <Field
          title="Default view"
          description="The layout the catalogue opens to."
          control={
            <Segmented
              ariaLabel="Default view"
              options={VIEW_OPTIONS}
              value={defaultViewMode}
              onChange={setDefaultViewMode}
            />
          }
        />

        <Field
          title="Results per page"
          description="How many items load before paginating."
          control={
            <Segmented
              ariaLabel="Results per page"
              options={PAGE_SIZE_OPTIONS}
              value={pageSize}
              onChange={setPageSize}
            />
          }
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Appearance</SectionHeading>

        <Field
          title="Theme"
          description="Choose light or dark."
          control={<ThemeToggle />}
        />

        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Sparkles className="size-4 text-muted-foreground" aria-hidden />
              Reduce motion
            </span>
            <span className="text-xs text-muted-foreground">
              Minimise animations and transitions across the app.
            </span>
          </div>
          <Tooltip content={reduceMotion ? "Motion off" : "Motion on"}>
            <div className="pt-0.5">
              <Switch
                checked={reduceMotion}
                onChange={setReduceMotion}
                label="Reduce motion"
              />
            </div>
          </Tooltip>
        </div>
      </section>
    </div>
  )
}
