import * as React from "react";

/**
 * Split `text` around every case-insensitive occurrence of `query`, wrapping
 * matched runs in a subtle `<mark>` so type-ahead results visibly echo what
 * the user typed. Purely presentational — no pricing, no side effects.
 */
export function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark
        key={key++}
        className="rounded-sm bg-primary/15 text-primary [font-weight:inherit]"
      >
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    i = idx + needle.length;
  }
  return out;
}
