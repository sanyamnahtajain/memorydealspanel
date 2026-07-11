/**
 * GSTIN (Goods & Services Tax Identification Number) utilities — pure, no I/O.
 *
 * A GSTIN is 15 characters:
 *   [0..1]  2-digit state code
 *   [2..11] 10-char PAN (5 letters, 4 digits, 1 letter)
 *   [12]    entity number (alphanumeric)
 *   [13]    'Z' by default
 *   [14]    checksum character (official mod-36 algorithm)
 */

/** Map of 2-digit GST state/UT code → name (as per the GST state-code list). */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Before Division)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

// Alphabet used by the official GSTIN checksum: 0-9 then A-Z (base 36).
const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_STRUCTURE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;

/**
 * Computes the official GSTIN checksum character for the first 14 characters.
 * Algorithm: for each of the 14 chars, take its base-36 code point, multiply by
 * a weight that alternates 1,2,1,2,… ; for each product, `quotient + remainder`
 * of division by 36; sum those; the check digit code is `(36 − (sum mod 36)) mod 36`.
 */
function gstinCheckDigit(first14: string): string {
  const factorForOdd = 1;
  const factorForEven = 2;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const codePoint = GSTIN_ALPHABET.indexOf(first14[i]);
    if (codePoint < 0) {
      return "";
    }
    const factor = i % 2 === 0 ? factorForOdd : factorForEven;
    const product = codePoint * factor;
    const digit = Math.floor(product / 36) + (product % 36);
    sum += digit;
  }
  const checkCode = (36 - (sum % 36)) % 36;
  return GSTIN_ALPHABET[checkCode];
}

/** Returns true when `s` is a structurally valid GSTIN with a correct checksum. */
export function isValidGstin(s: string): boolean {
  if (typeof s !== "string") {
    return false;
  }
  const gstin = s.trim().toUpperCase();
  if (gstin.length !== 15) {
    return false;
  }
  if (!GSTIN_STRUCTURE.test(gstin)) {
    return false;
  }
  if (!(gstin.slice(0, 2) in GST_STATE_CODES)) {
    return false;
  }
  return gstinCheckDigit(gstin.slice(0, 14)) === gstin[14];
}

/**
 * Returns the 2-digit state code of a structurally valid GSTIN (first two
 * chars), or null. Structural validity requires a valid, known state code and
 * the correct overall format — but this does NOT require the checksum to pass,
 * so a state can still be extracted from a mistyped-checksum GSTIN. Use
 * {@link isValidGstin} when the checksum must hold.
 */
export function gstinStateCode(s: string): string | null {
  if (typeof s !== "string") {
    return null;
  }
  const gstin = s.trim().toUpperCase();
  if (gstin.length !== 15 || !GSTIN_STRUCTURE.test(gstin)) {
    return null;
  }
  const code = gstin.slice(0, 2);
  return code in GST_STATE_CODES ? code : null;
}
