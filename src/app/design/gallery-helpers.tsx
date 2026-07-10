import * as React from "react";
import { cn } from "@/lib/utils";

/** A titled gallery section with an anchor id. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 space-y-4">
      <div className="space-y-1">
        <h2
          id={`${id}-heading`}
          className="font-heading text-lg font-semibold tracking-tight text-foreground"
        >
          {title}
        </h2>
        {description ? (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ThemePanel({
  theme,
  children,
}: {
  theme: "light" | "dark";
  children: React.ReactNode;
}) {
  return (
    <div
      data-theme={theme}
      className={cn(
        "space-y-6 rounded-xl border border-border bg-background p-5 text-foreground",
        theme === "dark" && "dark"
      )}
    >
      <p className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
        {theme}
      </p>
      {children}
    </div>
  );
}

/**
 * Renders the same children twice, side by side: once on the light theme
 * and once inside a `.dark` scope, so every state is reviewed on both.
 */
export function ThemeDuo({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ThemePanel theme="light">{children}</ThemePanel>
      <ThemePanel theme="dark">{children}</ThemePanel>
    </div>
  );
}

/** A labeled variant block inside a theme panel. */
export function Demo({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
    </div>
  );
}

/** Color token swatch. */
export function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-8 shrink-0 rounded-lg border border-border", className)} />
      <span className="font-mono text-xs text-muted-foreground">{name}</span>
    </div>
  );
}
