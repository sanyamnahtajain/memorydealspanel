"use client";

import * as React from "react";

/**
 * Reason preview: long messages are clamped to a few lines with a
 * "Show more" toggle so the list stays scannable on a phone.
 */
const PREVIEW_LIMIT = 180;

export function ReasonText({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const needsClamp = text.length > PREVIEW_LIMIT;
  const shown =
    !needsClamp || expanded ? text : `${text.slice(0, PREVIEW_LIMIT).trimEnd()}…`;

  return (
    <p className="text-sm whitespace-pre-wrap text-foreground/85">
      {shown}
      {needsClamp ? (
        <>
          {" "}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </>
      ) : null}
    </p>
  );
}
