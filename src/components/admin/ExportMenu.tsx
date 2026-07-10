"use client"

import * as React from "react"
import { Download, FileSpreadsheet, FileText } from "lucide-react"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"

const EXPORTS = [
  {
    format: "xlsx",
    label: "Excel",
    tooltip: "Download the full catalog as an .xlsx workbook",
    icon: FileSpreadsheet,
  },
  {
    format: "csv",
    label: "CSV",
    tooltip: "Download the full catalog as a .csv file",
    icon: FileText,
  },
] as const

export interface ExportMenuProps {
  /**
   * Optional heading rendered above the download buttons. Omit to render the
   * buttons bare (e.g. inside a `PageHeader` actions slot).
   */
  label?: string
  className?: string
}

/**
 * Catalog export control — a token-styled pair of download links pointing at
 * the `/api/export` route (which streams an `.xlsx` workbook by default and a
 * CSV with `?format=csv`). These are real `<a download>` anchors so the browser
 * handles the file save; the route enforces the admin guard server-side.
 *
 * Each button carries a `<Tooltip>` (no native `title=`) and a `Download`
 * affordance so the action reads clearly at icon size.
 */
export function ExportMenu({ label, className }: ExportMenuProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Download className="size-4 text-muted-foreground" aria-hidden />
          {label}
        </span>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {EXPORTS.map(({ format, label: fmtLabel, tooltip, icon: Icon }) => (
          <Tooltip key={format} content={tooltip}>
            <a
              href={`/api/export?format=${format}`}
              download
              className={cn(
                buttonVariants({ variant: "outline", size: "default" }),
              )}
            >
              <Icon aria-hidden />
              <span>{fmtLabel}</span>
            </a>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
