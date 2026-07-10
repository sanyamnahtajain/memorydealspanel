import { notFound } from "next/navigation";
import { GridDemo } from "./GridDemo";

/**
 * DealSheet dev playground — a self-contained demo generating 5,000 fake
 * product rows with an in-memory `onSave` (simulated latency + occasional
 * failure so retry/rollback are visible) and localStorage persistence.
 *
 * This route is a DEV-ONLY tool: it 404s in production builds.
 */
export default function GridDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GridDemo />;
}
