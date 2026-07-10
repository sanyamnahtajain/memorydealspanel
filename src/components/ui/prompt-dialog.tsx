"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/components/common/use-is-mobile"

/** The kind of input the prompt collects. */
type PromptKind = "text" | "password" | "number" | "select"

interface PromptSelectOption {
  value: string
  label: React.ReactNode
}

interface PromptDialogContentProps {
  title: string
  description?: React.ReactNode
  /** Which control to render. @default "text" */
  kind?: PromptKind
  /** Options for `kind="select"` (ignored otherwise). */
  options?: readonly PromptSelectOption[]
  /** Label rendered above the control (for `select`). @default the title */
  label?: string
  /** Placeholder for text-like inputs / the select trigger. */
  placeholder?: string
  /** Pre-filled value. */
  initialValue?: string
  confirmLabel?: string
  cancelLabel?: string
  /**
   * Return an error string to block submission, or `null`/`undefined` when
   * the value is acceptable. Runs on submit and clears live as the user edits.
   */
  validate?: (value: string) => string | null | undefined
}

interface PromptDialogProps extends PromptDialogContentProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Called with the collected value on confirm. May return a promise — the
   * confirm button shows a spinner and the surface is locked while it settles.
   * On resolve the surface closes; on reject it stays open for a retry.
   */
  onSubmit: (value: string) => void | Promise<void>
}

/* ------------------------------------------------------------------ */
/* Shared form body                                                   */
/* ------------------------------------------------------------------ */

function useResolvedInitial(kind: PromptKind, options: readonly PromptSelectOption[] | undefined, initialValue?: string) {
  return React.useMemo(() => {
    if (initialValue != null && initialValue !== "") return initialValue
    if (kind === "select") return options?.[0]?.value ?? ""
    return ""
  }, [initialValue, kind, options])
}

interface PromptFormProps extends PromptDialogContentProps {
  onSubmit: (value: string) => void | Promise<void>
  onCancel: () => void
  /** Renders the footer with the surface-appropriate button ordering. */
  footerWrapper: (buttons: {
    confirm: React.ReactNode
    cancel: React.ReactNode
  }) => React.ReactNode
  autoFocus?: boolean
}

function PromptForm({
  kind = "text",
  options,
  label,
  placeholder,
  initialValue,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  validate,
  title,
  onSubmit,
  onCancel,
  footerWrapper,
  autoFocus = true,
}: PromptFormProps) {
  const resolvedInitial = useResolvedInitial(kind, options, initialValue)
  const [value, setValue] = React.useState(resolvedInitial)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const fieldId = React.useId()
  const errorId = React.useId()

  const applyValue = React.useCallback((next: string) => {
    setValue(next)
    setError((prev) => (prev ? null : prev)) // clear stale error while editing
  }, [])

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (loading) return
      const validationError = validate?.(value)
      if (validationError) {
        setError(validationError)
        return
      }
      setLoading(true)
      try {
        await onSubmit(value)
      } catch {
        // Keep the surface open for a retry; surfacing the failure is the
        // caller's responsibility (e.g. a toast inside onSubmit).
      } finally {
        setLoading(false)
      }
    },
    [loading, onSubmit, validate, value]
  )

  const control =
    kind === "select" ? (
      <Select
        value={value}
        onValueChange={(next) => applyValue((next as string | null) ?? "")}
        items={(options ?? []).map((o) => ({ value: o.value, label: o.label }))}
        disabled={loading}
      >
        <SelectTrigger
          id={fieldId}
          className="w-full"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        >
          <SelectValue placeholder={placeholder ?? "Select…"} />
        </SelectTrigger>
        <SelectContent>
          {(options ?? []).map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <Input
        id={fieldId}
        type={kind === "password" ? "password" : kind === "number" ? "number" : "text"}
        inputMode={kind === "number" ? "decimal" : undefined}
        autoComplete={kind === "password" ? "off" : undefined}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        disabled={loading}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => applyValue(e.target.value)}
      />
    )

  const confirm = (
    <Button type="submit" disabled={loading} data-loading={loading || undefined}>
      {loading ? <Spinner size="xs" label="" aria-hidden /> : null}
      {confirmLabel}
    </Button>
  )

  const cancel = (
    <Button type="button" variant="outline" disabled={loading} onClick={onCancel}>
      {cancelLabel}
    </Button>
  )

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId}>{label ?? title}</Label>
        {control}
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {footerWrapper({ confirm, cancel })}
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Controlled PromptDialog                                            */
/* ------------------------------------------------------------------ */

/**
 * A themed replacement for `window.prompt`. Renders a centered Dialog on
 * desktop and a bottom Sheet on mobile (via `useIsMobile`). Collects a
 * single value through an Input (text/password/number) or a Select
 * (`kind="select"`, fed by `options`), with inline validation, a loading
 * state on submit, and confirm/cancel actions.
 *
 * For imperative, promise-based usage prefer {@link usePromptDialog}.
 */
function PromptDialog({
  open,
  onOpenChange,
  onSubmit,
  ...content
}: PromptDialogProps) {
  const isMobile = useIsMobile()
  const [busy, setBusy] = React.useState(false)

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (busy && !next) return // block dismissal mid-submit
      onOpenChange(next)
    },
    [busy, onOpenChange]
  )

  const handleSubmit = React.useCallback(
    async (value: string) => {
      setBusy(true)
      try {
        await onSubmit(value)
        onOpenChange(false)
      } finally {
        setBusy(false)
      }
    },
    [onOpenChange, onSubmit]
  )

  const body = (
    <PromptForm
      // Remount on each fresh prompt (and on close) so internal state —
      // value, validation error, loading — resets without a setState effect.
      key={`${open}:${content.kind ?? "text"}:${content.initialValue ?? ""}:${content.title}`}
      {...content}
      onSubmit={handleSubmit}
      onCancel={() => handleOpenChange(false)}
      autoFocus={!isMobile}
      footerWrapper={({ confirm, cancel }) =>
        isMobile ? (
          <SheetFooter className="px-0 pt-1">
            {confirm}
            {cancel}
          </SheetFooter>
        ) : (
          <DialogFooter>
            {cancel}
            {confirm}
          </DialogFooter>
        )
      }
    />
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl pb-safe">
          <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
          <SheetHeader className="pb-0">
            <SheetTitle>{content.title}</SheetTitle>
            {content.description ? (
              <SheetDescription>{content.description}</SheetDescription>
            ) : null}
          </SheetHeader>
          <div className="px-4 pb-2">{body}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          {content.description ? (
            <DialogDescription>{content.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Imperative helper                                                  */
/* ------------------------------------------------------------------ */

type PromptOptions = PromptDialogContentProps

interface UsePromptDialogReturn {
  /**
   * Opens the prompt and resolves with the entered value, or `null` if the
   * user cancels/dismisses. Awaitable — perfect for replacing `window.prompt`:
   *
   *   const name = await prompt({ title: "Rename list", initialValue: current })
   *   if (name === null) return
   */
  prompt: (options: PromptOptions) => Promise<string | null>
  /** Render this once (e.g. at the end of your component tree). */
  element: React.ReactNode
}

/**
 * Imperative, promise-based prompt. Returns a `prompt(opts)` function that
 * resolves to the entered string or `null` on cancel, plus an `element` you
 * must render. Only one prompt is shown at a time; opening a new one while
 * another is pending resolves the previous with `null`.
 */
function usePromptDialog(): UsePromptDialogReturn {
  const [state, setState] = React.useState<{
    open: boolean
    options: PromptOptions | null
  }>({ open: false, options: null })

  const resolverRef = React.useRef<((value: string | null) => void) | null>(null)

  const settle = React.useCallback((value: string | null) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    resolve?.(value)
  }, [])

  const prompt = React.useCallback(
    (options: PromptOptions) => {
      // Abandon any in-flight prompt.
      settle(null)
      return new Promise<string | null>((resolve) => {
        resolverRef.current = resolve
        setState({ open: true, options })
      })
    },
    [settle]
  )

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        settle(null)
        setState((s) => ({ ...s, open: false }))
      }
    },
    [settle]
  )

  const handleSubmit = React.useCallback(
    (value: string) => {
      settle(value)
      setState((s) => ({ ...s, open: false }))
    },
    [settle]
  )

  // Resolve any pending promise if the host unmounts.
  React.useEffect(() => () => settle(null), [settle])

  const element = state.options ? (
    <PromptDialog
      {...state.options}
      open={state.open}
      onOpenChange={handleOpenChange}
      onSubmit={handleSubmit}
    />
  ) : null

  return { prompt, element }
}

export {
  PromptDialog,
  usePromptDialog,
  type PromptDialogProps,
  type PromptKind,
  type PromptSelectOption,
  type PromptOptions,
  type UsePromptDialogReturn,
}
