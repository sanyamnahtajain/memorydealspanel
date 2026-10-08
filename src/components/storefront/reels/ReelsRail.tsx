/**
 * ReelsRail — the home page's "Reels" shelf (9:16 thumbnails that open the
 * full-screen /reels feed). SERVER component: reads via listHomeReels (ISR
 * safe, price-free) and renders NOTHING when no reel is live, so the home
 * page is byte-identical until the owner uploads the first clip.
 *
 * Scaffold — the storefront-reels unit replaces this body.
 */
import { listHomeReels } from "@/server/services/reels";

export async function ReelsRail() {
  const reels = await listHomeReels();
  if (reels.length === 0) return null;
  return null;
}
