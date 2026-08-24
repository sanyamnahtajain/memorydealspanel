/**
 * Bilingual notification text (Hindi + English).
 *
 * WHY THIS EXISTS, and why it is text rather than audio. A push notification
 * drawn by the phone while the app is closed uses the phone's own sound — no
 * website can substitute a voice line there. What DOES always reach the
 * customer, locked screen included, is the words. So the words are where the
 * effort belongs.
 *
 * The shop's buyers are mobile-accessory retailers across India. Many read
 * Hindi far more comfortably than English, and the owner's instruction has
 * been consistent: simple language, short sentences. Hindi therefore comes
 * FIRST and English follows, separated by a middle dot — a reader who wants
 * either one finds it immediately, and nobody is locked out.
 *
 * The Devanagari here deliberately keeps the loan-words retailers actually
 * use in the trade ("एक्सेस", "ऑर्डर", "प्राइस") rather than formal Hindi
 * equivalents nobody says out loud in a shop.
 *
 * Staff-facing alerts are NOT translated: the admin panel is one small team
 * working in English, and a doubled title would only cost them reading speed
 * on the alert that matters most.
 */

/**
 * Join a Hindi and an English fragment into one notification string.
 *
 * Titles must stay SHORT. A phone truncates the title first, and since Hindi
 * leads, an over-long title cuts the English half off entirely — leaving a
 * non-Hindi reader with nothing. Bodies have far more room, so that is where
 * the detail goes. `copy.test.ts` pins every title under the limit.
 */
export function bilingual(hindi: string, english: string): string {
  const hi = hindi.trim();
  const en = english.trim();
  if (!hi) return en;
  if (!en) return hi;
  return `${hi} · ${en}`;
}

export interface NotifyText {
  title: string;
  body: string;
}

/**
 * Access approved — the one the owner called out by name.
 * "The Memory Deals — your access is approved."
 */
export function accessApprovedText(): NotifyText {
  return {
    title: bilingual("एक्सेस अप्रूव", "Access approved"),
    body: bilingual(
      "अब आप सभी प्राइस देख सकते हैं और ऑर्डर कर सकते हैं।",
      "You can now see prices and place orders.",
    ),
  };
}

/**
 * Access ending in `days`. Always carries the deal the owner insists on
 * communicating: one order buys another 30 days.
 */
export function accessExpiringText(days: number, extendDays: number): NotifyText {
  const dayWordHi = days === 1 ? "दिन" : "दिन";
  const dayWordEn = days === 1 ? "day" : "days";
  return {
    title: bilingual(
      `प्राइस बंद: ${days} ${dayWordHi}`,
      `${days} ${dayWordEn} left`,
    ),
    body: bilingual(
      `अभी एक ऑर्डर करें और ${extendDays} दिन और मिल जाएंगे। ऑर्डर नहीं किया तो प्राइस बंद हो जाएंगे।`,
      `Place one order now and you get ${extendDays} more days. No order — prices stop.`,
    ),
  };
}

/** Access has lapsed. */
export function accessExpiredText(): NotifyText {
  return {
    title: bilingual("प्राइस बंद", "Prices stopped"),
    body: bilingual(
      "दोबारा चालू करने के लिए यहाँ टैप करें।",
      "Tap here to ask for prices again.",
    ),
  };
}

/** We have the buyer's order. Sent the moment it is placed. */
export function orderPlacedText(
  orderNumber: string,
  itemCount: number,
): NotifyText {
  const itemsEn = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  return {
    title: bilingual("ऑर्डर मिल गया", "Order received"),
    body: bilingual(
      `ऑर्डर ${orderNumber} — ${itemCount} आइटम। हम जल्दी कन्फर्म करेंगे।`,
      `Order ${orderNumber} — ${itemsEn}. We will confirm it shortly.`,
    ),
  };
}

/**
 * An order changed state. `statusLabel` is the existing English label from
 * ORDER_STATUS_LABEL; `statusHindi` is its Hindi counterpart, resolved by the
 * caller from ORDER_STATUS_HINDI below.
 */
export function orderStatusText(
  orderNumber: string,
  statusLabel: string,
  statusHindi: string,
): NotifyText {
  return {
    title: bilingual("ऑर्डर अपडेट", "Order update"),
    body: bilingual(
      `ऑर्डर ${orderNumber} अब ${statusHindi} है।`,
      `Order ${orderNumber} is now ${statusLabel}.`,
    ),
  };
}

/**
 * Hindi for each order status. Keyed by the Prisma OrderStatus values so a
 * new status cannot silently fall through untranslated — callers should use
 * `orderStatusHindi()` which falls back to the English label.
 */
const ORDER_STATUS_HINDI: Record<string, string> = {
  PLACED: "प्लेस हो गया",
  CONFIRMED: "कन्फर्म हो गया",
  PACKED: "पैक हो गया",
  SHIPPED: "भेज दिया गया",
  DELIVERED: "डिलीवर हो गया",
  CANCELLED: "कैंसिल हो गया",
};

/** Hindi label for a status, falling back to the English one when unknown. */
export function orderStatusHindi(status: string, englishLabel: string): string {
  return ORDER_STATUS_HINDI[status] ?? englishLabel;
}

/** Items left sitting in the cart. */
export function cartReminderText(itemCount: number): NotifyText {
  const itemsEn = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  return {
    title: bilingual("कार्ट में सामान", "Cart is waiting"),
    body: bilingual(
      `आपकी कार्ट में ${itemCount} आइटम हैं। प्राइस बदल सकते हैं, इसलिए ऑर्डर कर दें।`,
      `You have ${itemsEn} in your cart. Prices can change, so place the order.`,
    ),
  };
}
