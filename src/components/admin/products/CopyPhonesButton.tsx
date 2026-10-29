"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Copies the buyers' phone numbers, one per line — the fastest way into a
 * WhatsApp broadcast list or a spreadsheet. Clipboard access can be refused
 * (http, permissions), so a failure says so instead of pretending.
 */
export function CopyPhonesButton({ phones }: { phones: string[] }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  if (phones.length === 0) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(phones.join("\n"));
          setCopied(true);
          toast.success(`${phones.length} number${phones.length === 1 ? "" : "s"} copied.`);
        } catch {
          toast.error("Couldn't copy — select the numbers and copy them by hand.");
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : `Copy ${phones.length} number${phones.length === 1 ? "" : "s"}`}
    </Button>
  );
}
