import * as React from "react";
import { formatFull } from "./chart-utils";

/**
 * Visually-hidden data table rendered alongside every chart. Screen-reader and
 * keyboard users get the exact numbers even though the SVG is decorative
 * (`role="img"` + `aria-label`). Kept in the accessibility tree only — hidden
 * from sighted users via `sr-only`.
 */
export function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  /** Each row: first cell is the label, the rest are numeric values. */
  rows: { label: string; values: number[] }[];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            {row.values.map((v, i) => (
              <td key={i}>{formatFull(v)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
