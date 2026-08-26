/**
 * Bare loading state for the gate segment.
 *
 * Without this, the (storefront) group's loading.tsx flushes first — and that
 * skeleton includes the full shell: header nav, bottom tabs, footer link
 * lists. The rendered page replaces it, but the streamed HTML (what
 * view-source shows a stranger) would still carry the shop's navigation
 * structure. The wall promises a stranger sees NOTHING but the two gate
 * screens, so its loading state is as bare as the screens themselves.
 */
export default function GateLoading() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background">
      <span
        className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}
