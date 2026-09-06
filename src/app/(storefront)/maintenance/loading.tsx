/**
 * Bare loading state for the maintenance segment — same reasoning as the
 * gate's: the (storefront) group's skeleton carries the full shell (header
 * nav, bottom tabs, footer), and the streamed HTML would show a visitor the
 * shop's navigation while the shop is supposed to be closed.
 */
export default function MaintenanceLoading() {
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
