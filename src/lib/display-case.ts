/**
 * Display-only casing for catalog names.
 *
 * The brand and category masters were typed by hand over years, so the data
 * mixes "MOBILE COVERS", "Mobile Covers" and "mobile covers". The storefront
 * renders every one of them the same way — Title Case — WITHOUT touching the
 * stored value (search, slugs and admin keep the owner's spelling).
 *
 * The rules are tuned for a mobile-accessories catalog, where short all-caps
 * tokens are almost always acronyms (USB, OTG, TWS, LED, PD) and must not be
 * flattened to "Usb":
 *  - tokens with a digit keep their casing ("20W", "3D", "5G");
 *  - a known acronym keeps its casing (USB, OTG, TWS, HDMI, AMOLED…);
 *  - in a MIXED-case string a short all-caps token was typed that way on
 *    purpose and is kept ("USB Cables", "ZTE Routers"); in an all-caps
 *    string ("CAR CHARGERS") short tokens are ordinary words and are cased
 *    like everything else — only 1–2 letter tokens stay upper ("MI");
 *  - tokens that are already mixed case are the author's intent (iPhone,
 *    boAt, JioFi) and are left alone;
 *  - small joining words (and, of, for, with, the…) are lower-cased unless
 *    they start the string;
 *  - everything else becomes Capitalised-lowercase.
 * Hyphens, slashes, ampersands and plus signs split tokens ("TYPE-C" →
 * "Type-C", "CASES & COVERS" → "Cases & Covers"); runs of whitespace collapse
 * to one space and the result is trimmed.
 */

const KEEP_UPPER = new Set([
  "HDMI",
  "OLED",
  "AMOLED",
  "OTG",
  "USB",
  "TWS",
  "LED",
  "LCD",
  "MFI",
  "WIFI",
  "GPS",
  "NFC",
  "AUX",
  "TPU",
  "GST",
  "PWA",
  "IPS",
  "ANC",
  "PD",
  "QC",
  "JBL",
  "TCL",
  "LG",
  "HP",
]);

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "with",
]);

/** Separators that split tokens but are preserved in the output. */
const SEPARATOR = /([\s/&+-]+)/;

function hasLetter(token: string): boolean {
  return /\p{L}/u.test(token);
}

function isAllUpper(token: string): boolean {
  return token === token.toUpperCase() && token !== token.toLowerCase();
}

function isAllLower(token: string): boolean {
  return token === token.toLowerCase() && token !== token.toUpperCase();
}

function caseToken(token: string, first: boolean, shouted: boolean): string {
  if (!hasLetter(token)) return token;
  if (/\d/.test(token)) return token;
  const upper = token.toUpperCase();
  const lower = token.toLowerCase();
  // Joining words first: "AND" / "THE" / "FOR" are three letters too, and are
  // words, not acronyms.
  if (SMALL_WORDS.has(lower)) {
    return first ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  }
  if (KEEP_UPPER.has(upper)) return upper;
  if (isAllUpper(token) && (token.length <= 2 || (!shouted && token.length <= 3))) {
    return token;
  }
  // Mixed case already (iPhone, boAt, JioFi) — the author meant it.
  if (!isAllUpper(token) && !isAllLower(token)) return token;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Title-case a catalog name for display. Pure, allocation-light, safe to call
 * in server components on every render. Returns "" for empty/whitespace input.
 */
export function titleCase(input: string | null | undefined): string {
  if (!input) return "";
  const collapsed = input.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const parts = collapsed.split(SEPARATOR);
  const shouted = isAllUpper(collapsed);
  let first = true;
  let out = "";
  for (const part of parts) {
    if (part === "") continue;
    if (SEPARATOR.test(part) && !hasLetter(part)) {
      out += part;
      continue;
    }
    out += caseToken(part, first, shouted);
    if (hasLetter(part)) first = false;
  }
  return out;
}
