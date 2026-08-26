import { formatPaise } from "@/lib/money";

/**
 * Pure copy helpers for the cart Summary's disclosure rows — tiny, testable
 * strings kept out of the component so the collapsed faces of the folded
 * sections stay honest (they must summarise what is inside without opening).
 * DISPLAY ONLY: nothing here touches money math or any server check.
 */

/**
 * The collapsed face of the GST disclosure row: "Incl. ₹X GST". Always
 * "incl." — the grand total beneath it already carries the tax, whether the
 * catalog prices are tax-inclusive or tax-exclusive.
 */
export function gstDisclosureLabel(totalTaxPaise: number): string {
  return `Incl. ${formatPaise(totalTaxPaise)} GST`;
}

/**
 * The collapsed face of the order-note disclosure: invites a note when there
 * is none, confirms one is attached when there is (so a buyer who folded the
 * row away never wonders whether their note survived).
 */
export function noteDisclosureLabel(note: string): string {
  return note.trim() === ""
    ? "Add a note for the seller"
    : "Note for the seller — added";
}

/**
 * The ONE minimum-order-value sentence (desktop sidebar; the sticky mobile
 * bar renders its own short form). The server still blocks a below-minimum
 * placement — this only explains the disabled button.
 */
export function movLineText(
  shortfallPaise: number,
  minOrderValuePaise: number,
): string {
  return `Add ${formatPaise(shortfallPaise)} more to place your order (minimum ${formatPaise(minOrderValuePaise)}).`;
}
