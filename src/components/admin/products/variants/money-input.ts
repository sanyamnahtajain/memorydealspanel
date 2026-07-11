/**
 * Rupee-input helpers shared across the variants editor.
 *
 * Mirrors the private `paiseToInput` in ProductEditorForm — kept as its own
 * module so the variant matrix and section can reuse it without importing the
 * form. Parsing the other direction is `parseRupees` from src/lib/money.
 */

/** paise -> editable rupee string ("49950" -> "499.50", "49900" -> "499"). */
export function paiseToInput(paise: number | null | undefined): string {
  if (paise == null) return "";
  const rupees = Math.trunc(paise / 100);
  const fraction = paise % 100;
  return fraction === 0
    ? String(rupees)
    : `${rupees}.${String(fraction).padStart(2, "0")}`;
}
