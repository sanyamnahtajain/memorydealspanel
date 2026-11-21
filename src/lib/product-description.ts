/**
 * Product description writer — the owner asked for every product to have a
 * description (Raj, Nov 2026: "fill all products description boxes").
 *
 * Writes ORIGINAL text from the product's OWN data — name, brand, category,
 * pack size — and nothing else. Two rules keep it honest:
 *
 *  1. FACTS ONLY FROM THE NAME. "Key points" are listed only when the product
 *     name states them (20W, 10000mAh, Type-C, PD, ANC, 1.5M…). Nothing is
 *     invented: no made-up battery life, no guessed compatibility.
 *  2. NO COPYING. Text from Amazon / Flipkart / brand sites is someone else's
 *     copyright, marketplaces forbid scraping, and Google ranks copied pages
 *     below the original. Specs are facts and can be stated; prose is written
 *     here.
 *
 * Pure and isomorphic: the admin editor's "Write for me" button runs it in the
 * browser; the bulk backfill and product create run it on the server.
 */

import { brandName } from "@/lib/display-case";

export interface DescribeInput {
  name: string;
  brand?: string | null;
  category?: string | null;
  moq?: number | null;
  packMultiple?: number | null;
  /**
   * Verified specs (key → value), e.g. taken from the brand's official
   * product page. Listed first in Key points; name-derived facts that say the
   * same thing are dropped.
   */
  specs?: Record<string, unknown> | null;
}

/** Printable spec rows, in order, from the product's `specs` object. */
function specRows(specs: DescribeInput["specs"]): string[] {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return [];
  return Object.entries(specs)
    .filter(([key, value]) => key.trim() && value != null && String(value).trim())
    .map(([key, value]) => `${key.trim()}: ${String(value).trim()}`);
}

/** Does a spec row already state this name-derived fact? */
function coveredBy(fact: string, rows: string[]): boolean {
  const hay = rows.join(" ").toLowerCase().replace(/,/g, "");
  const number = fact.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0];
  if (number && new RegExp(`(^|[^\\d.])${number.replace(".", "\\.")}(?![\\d])`).test(hay)) return true;
  const keyword = fact.toLowerCase().match(/type-c|usb-c|lightning|micro-usb|anc|enc|gan|magsafe|magnetic|wireless|rgb|amoled|bluetooth calling|fast charging|power delivery|quick charge/)?.[0];
  return Boolean(keyword && hay.includes(keyword.replace("magsafe", "mag")));
}

/* ------------------------------------------------------------------ */
/* Kinds of product, matched on category + name keywords               */
/* ------------------------------------------------------------------ */

interface Kind {
  key: string;
  /** Matched against "category name + product name", lower-cased. */
  test: RegExp;
  /** "a … " phrase, e.g. "fast wall charger". */
  noun: string;
  /** One or two sentences that are true of every product of this kind. */
  use: string[];
}

// Order matters: the first match wins, so specific kinds come first.
const KINDS: Kind[] = [
  { key: "wireless-charger", test: /wireless charg|charging (pad|stand)|magsafe charg|aerosynq|freedom \d/, noun: "wireless charger", use: ["Place a Qi-enabled phone or earbuds case on it and charging starts — no cable to plug into the device.", "A tidy, cable-free way to top up phones and earbuds on a desk or bedside table."] },
  { key: "watch-charger", test: /watch charg/, noun: "smartwatch charger", use: ["A replacement charger for smartwatches — handy to keep as a spare at home or work."] },
  { key: "car-charger", test: /car charg|car chag|\bcc\d|car power|car adapter/, noun: "car charger", use: ["Plugs into the car's 12V socket to charge phones on the move.", "Keeps phones topped up on long drives and daily commutes."] },
  { key: "car-holder", test: /car mobile|car holder|mobile holder|phone holder|dashboard|windshield|air vent/, noun: "car mobile holder", use: ["Holds the phone steady in the car for navigation and hands-free calls."] },
  { key: "bike", test: /bike|cycle/, noun: "bike accessory", use: ["Made for two-wheeler riders who use their phone on the road."] },
  { key: "power-bank", test: /power ?bank|\bpb ?\d|mah|powerbank|minicharge|energy|halley/, noun: "power bank", use: ["Charges phones and other USB devices away from a wall socket — useful for travel, power cuts and long days out.", "A portable battery that keeps phones running through travel and power cuts."] },
  { key: "cable", test: /cable|cord|\bc to c\b|type-?c to|to lightning|usb to/, noun: "charging cable", use: ["A dependable everyday cable for charging and connecting devices.", "Connects the device to its charger or computer for everyday charging."] },
  { key: "connector", test: /connector|otg|adapter|converter|splitter|hub|aux/, noun: "connector", use: ["Connects devices with different ports so accessories work together."] },
  { key: "charger", test: /charg|adapt|adapto|\bdock\b|\bgan\b/, noun: "wall charger", use: ["Plugs into a standard wall socket to charge phones and other USB devices.", "A reliable everyday charger for phones and USB-powered gadgets."] },
  { key: "earbuds", test: /airpod|airdope|\bbuds?\b|tws|earbud|true wireless/, noun: "pair of true wireless earbuds", use: ["Wire-free listening for music, calls and video, with a pocket-sized charging case.", "Compact earbuds for calls, music and videos, carried in their own charging case."] },
  { key: "neckband", test: /neckband|neck band|rockerz \d{3}\b(?!.*head)/, noun: "Bluetooth neckband", use: ["Sits comfortably around the neck for all-day music and calls."] },
  { key: "headphones", test: /headphone|headset|over-?ear|on-?ear/, noun: "pair of headphones", use: ["Over-the-head comfort for longer listening sessions, calls and gaming."] },
  { key: "earphones", test: /earphone|wired|handsfree|hands-free|in-?ear/, noun: "pair of wired earphones", use: ["Plug-and-play earphones for music and calls — no charging needed."] },
  { key: "laptop-speaker", test: /laptop speaker|computer speaker|desktop speaker|soundbar|sound bar/, noun: "computer speaker", use: ["Gives laptops and desktops fuller sound for music, movies and meetings."] },
  { key: "speaker", test: /speaker|stone|party|boombox|sound/, noun: "Bluetooth speaker", use: ["Fills the room with music from a phone over Bluetooth.", "Portable sound for home, parties and travel."] },
  { key: "smartwatch", test: /watch/, noun: "smartwatch", use: ["Shows notifications, time and activity right on the wrist.", "Everyday wrist companion for notifications, time and fitness tracking."] },
  { key: "keypad-phone", test: /keypad|feature phone|landline|\bphone\b/, noun: "phone", use: ["A simple, dependable phone for calls and messages."] },
  { key: "tempered-glass", test: /temper|glass|screen guard|protector|privacy/, noun: "screen protector", use: ["Helps protect the phone's display from scratches and everyday knocks."] },
  { key: "case", test: /case|cover|back cover|flip/, noun: "phone case", use: ["Helps protect the phone from scratches, drops and daily wear."] },
  { key: "gimbal", test: /gimbal|stabili[sz]er/, noun: "smartphone gimbal", use: ["Steadies the phone while filming for smoother videos."] },
  { key: "tripod", test: /tripod|selfie|stick|stand/, noun: "tripod / selfie stick", use: ["Holds the phone steady for photos, videos, calls and live streams."] },
  { key: "microphone", test: /mic|microphone|lavalier|collar/, noun: "microphone", use: ["Captures clearer voice for videos, reels, interviews and calls."] },
  { key: "memory", test: /memory card|micro ?sd|sd card|pendrive|pen drive|flash drive|\b\d+ ?(gb|tb)\b/, noun: "storage device", use: ["Extra space for photos, videos, music and files."] },
  { key: "keyboard", test: /keyboard|keybord/, noun: "keyboard", use: ["Comfortable typing for computers, laptops and tablets."] },
  { key: "mouse", test: /mouse/, noun: "mouse", use: ["Smooth, accurate control for laptops and desktops."] },
  { key: "tab-pencil", test: /pencil|stylus/, noun: "stylus pen", use: ["Precise writing, drawing and note-taking on a tablet screen."] },
  { key: "projector", test: /projector/, noun: "projector", use: ["Turns any wall into a big screen for movies, presentations and classes."] },
  { key: "camera", test: /camera|cctv|security|webcam/, noun: "camera", use: ["Keeps an eye on home or shop, or adds video to calls."] },
  { key: "torch", test: /torch|flashlight/, noun: "torch", use: ["Bright, handy light for power cuts, night walks and emergencies."] },
  { key: "lighting", test: /light|lamp|led|bulb|ring/, noun: "light", use: ["Practical lighting for home, work or content creation."] },
  { key: "grooming", test: /trimmer|shaver|grooming|dryer|straightener|clipper/, noun: "grooming appliance", use: ["Quick, easy personal grooming at home."] },
  { key: "air-purifier", test: /purifier/, noun: "air purifier", use: ["Helps keep indoor air cleaner at home or in the office."] },
  { key: "power-plate", test: /power plate|extension|spike|socket|board/, noun: "power extension", use: ["Adds sockets so several devices can be powered from one point."] },
  { key: "battery", test: /battery|batteries|cell/, noun: "battery", use: ["Dependable power for everyday devices."] },
  { key: "remote", test: /remote/, noun: "remote control", use: ["A replacement remote for easy everyday control."] },
  { key: "keychain", test: /keychain|key chain|key ring/, noun: "keychain", use: ["A small, handy accessory for keys and bags."] },
  { key: "home-appliance", test: /home appliance|kettle|fan|iron|heater|mixer|humidifier/, noun: "home appliance", use: ["A handy appliance for everyday use at home."] },
  { key: "car-accessory", test: /car /, noun: "car accessory", use: ["A practical add-on for everyday driving."] },
  { key: "calculator", test: /calculator/, noun: "calculator", use: ["Quick, reliable calculations for shop counters, offices and school."] },
  { key: "note-counter", test: /note counting|currency count|money count|cash count/, noun: "note counting machine", use: ["Counts cash quickly and accurately at the shop counter."] },
  { key: "game", test: /\bgame\b|gaming console|game ?pad|joystick|retro/, noun: "handheld game", use: ["Pocket-sized gaming fun for kids and adults."] },
  { key: "tracker", test: /airtag|smart ?finder|tracker|\btag\b/, noun: "item tracker", use: ["Helps find keys, bags and other everyday items."] },
  { key: "writing-pad", test: /ruffpad|writing (pad|tablet)|lcd (pad|tablet)/, noun: "LCD writing pad", use: ["Write, draw and erase again and again — no paper needed."] },
  { key: "sim-tool", test: /sim (pin|ejector|tool)/, noun: "SIM ejector pin", use: ["Opens the SIM tray of phones and tablets."] },
  { key: "computer", test: /computer|laptop|pc /, noun: "computer accessory", use: ["A practical accessory for laptops and desktops."] },
];

const FALLBACK: Kind = { key: "accessory", test: /./, noun: "everyday accessory", use: ["A handy, practical pick for everyday use."] };

/**
 * Which kinds a product NAME may narrow a broad CATEGORY down to. The
 * category is the owner's own grouping and normally wins; the name only
 * refines it ("Chargers" + "… Wireless Charger" → wireless charger), never
 * contradicts it ("Connectors" + "C To C Mic Connector" stays a connector).
 */
const REFINES: Record<string, string[]> = {
  charger: ["wireless-charger", "watch-charger", "car-charger", "power-bank", "cable"],
  speaker: ["laptop-speaker"],
  "car-accessory": ["car-charger", "car-holder", "wireless-charger"],
  computer: ["keyboard", "mouse", "laptop-speaker", "memory", "camera", "connector", "cable"],
  "home-appliance": ["grooming", "air-purifier", "lighting", "torch", "power-plate"],
  lighting: ["torch"],
};

export function productKind(input: Pick<DescribeInput, "name" | "category">): Kind {
  const byCategory = KINDS.find((k) => k.test.test((input.category ?? "").toLowerCase()));
  const byName = KINDS.find((k) => k.test.test(input.name.toLowerCase()));
  if (byCategory && byName && REFINES[byCategory.key]?.includes(byName.key)) return byName;
  return byCategory ?? byName ?? FALLBACK;
}

/* ------------------------------------------------------------------ */
/* Facts stated in the product name                                    */
/* ------------------------------------------------------------------ */

export function factsFromName(name: string): string[] {
  const n = ` ${name} `;
  const facts: string[] = [];
  const add = (fact: string) => {
    if (!facts.includes(fact)) facts.push(fact);
  };

  const watt = n.match(/(\d{1,3}(?:\.\d)?)\s?w(?:att)?s?\b/i);
  if (watt && Number(watt[1]) >= 2) add(`${watt[1]}W output`);

  const mah = n.match(/(\d{1,2}(?:[,.]?\d{3})|\d{1,3})\s?(k)?\s?mah\b/i);
  if (mah) {
    const value = mah[2] ? Number(mah[1]) * 1000 : Number(mah[1].replace(/[,.]/g, ""));
    if (value >= 500) add(`${value.toLocaleString("en-IN")} mAh capacity`);
  } else {
    const k = n.match(/\b(\d{1,2})\s?k\b(?!\s?(?:gb|tb))/i);
    if (k && /power ?bank|\bpb\b|magsafe/i.test(n)) add(`${(Number(k[1]) * 1000).toLocaleString("en-IN")} mAh capacity`);
  }

  const storage = n.match(/\b(\d{1,4})\s?(gb|tb)\b/i);
  if (storage) add(`${storage[1]}${storage[2].toUpperCase()} storage`);

  const amp = n.match(/\b(\d(?:\.\d)?)\s?a(?:mp)?\b/i);
  if (amp && Number(amp[1]) <= 10) add(`${amp[1]}A current`);

  const len = n.match(/\b(\d(?:\.\d)?)\s?(?:m|mtr|meter|metre)s?\b/i);
  if (len && Number(len[1]) > 0 && Number(len[1]) <= 10) add(`${len[1]} m length`);

  if (/\bc\s?to\s?c\b|type[- ]?c\s?to\s?type[- ]?c|usb-?c\s?to\s?usb-?c/i.test(n)) add("USB-C to USB-C");
  else if (/\bc\s?to\s?(lightning|l)\b|type[- ]?c\s?to\s?lightning/i.test(n)) add("USB-C to Lightning");
  else if (/\btype[- ]?c\b|usb-?c\b|\bc[- ]type\b/i.test(n)) add("Type-C (USB-C)");
  if (/lightning|iphone cable|\bios\b/i.test(n) && !facts.some((f) => f.includes("Lightning"))) add("Lightning connector");
  if (/micro ?usb|\bv8\b/i.test(n)) add("Micro-USB");
  if (/\b(pd|power delivery)\b/i.test(n)) add("Power Delivery (PD) fast charging");
  if (/\bqc\s?\d(\.\d)?|quick charg/i.test(n)) add("Quick Charge support");
  if (/\bgan\b/i.test(n)) add("GaN technology — compact for its power");
  if (/vooc|warp|dash|supervooc|turbo|fast charg|super ?fast/i.test(n)) add("Fast charging");
  if (/magsafe|magnetic|mag ?charge|magwave|magclick/i.test(n)) add("Magnetic (MagSafe-style) attach");
  if (/wireless/i.test(n)) add("Wireless");
  if (/\banc\b|noise cancel/i.test(n)) add("Active noise cancellation (ANC)");
  if (/\benc\b/i.test(n)) add("Environmental noise cancellation (ENC) for calls");
  const bt = n.match(/\b(?:bt|bluetooth)\s?v?(\d\.\d)\b/i);
  if (bt) add(`Bluetooth ${bt[1]}`);
  const ip = n.match(/\bip[x]?\s?(\d{1,2})\b/i);
  if (ip) add(`IP${ip[0].toUpperCase().includes("X") ? "X" : ""}${ip[1]} water resistance`);
  if (/\brgb\b/i.test(n)) add("RGB lights");
  const ports = n.match(/\b(dual|two|2|triple|three|3|four|4)\s?(?:port|usb)/i);
  if (ports) {
    const count = { dual: 2, two: 2, "2": 2, triple: 3, three: 3, "3": 3, four: 4, "4": 4 }[ports[1].toLowerCase()];
    if (count) add(`${count} charging ports`);
  }
  if (/\bamoled\b/i.test(n)) add("AMOLED display");
  if (/\b(bt|bluetooth) call|calling/i.test(n)) add("Bluetooth calling");
  return facts;
}

/* ------------------------------------------------------------------ */
/* Readable casing for ALL-CAPS catalogue names                        */
/* ------------------------------------------------------------------ */

const KEEP_UPPER = new Set(["USB", "PD", "QC", "GAN", "ANC", "ENC", "TWS", "OTG", "LED", "HD", "RGB", "BT", "IPX", "AMOLED", "LCD", "TV", "AC", "DC", "GB", "TB", "MAH", "SD", "PC", "CCTV", "UV", "FM", "NFC", "II", "III", "IV", "XL", "XXL", "TMD", "ERD", "HP", "JBL", "MZ", "LG"]);

export function readableName(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length > 3 && letters === letters.toUpperCase();
  if (!allCaps) return name.trim().replace(/\s+/g, " ");
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => {
      const core = word.replace(/[^A-Za-z0-9]/g, "");
      if (/\d/.test(core)) return word; // model codes: CC48, PB331, 20W
      if (KEEP_UPPER.has(core.toUpperCase())) return word;
      if (core.length <= 1) return word;
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Brands whose official spelling isn't plain title case. */
const BRAND_CASING: Record<string, string> = {
  boat: "boAt", realme: "realme", oneplus: "OnePlus", jbl: "JBL", hp: "HP", mi: "Mi", iqoo: "iQOO",
  sandisk: "SanDisk", "cp plus": "CP Plus", dji: "DJI", mz: "MZ", erd: "ERD", ikare: "iKare", lg: "LG",
  hmd: "HMD", evm: "EVM", tcl: "TCL", "fire-boltt": "Fire-Boltt", fireboltt: "Fire-Boltt",
};

function cleanBrand(brand: string | null | undefined, name: string): string | null {
  const b = (brand ?? "").trim();
  if (!b || /^(other|others|na|n\/a|none|generic|unbranded|local)$/i.test(b)) return null;
  const known = BRAND_CASING[b.toLowerCase()];
  if (known) return known;
  // Otherwise: the name's own spelling when it is deliberate mixed case
  // ("Nothing", "Ubon"), else the shop's brand display rule.
  const inName = name.match(new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"))?.[0];
  if (inName && inName !== inName.toUpperCase()) return inName;
  return brandName(b) || null;
}

function pick<T>(items: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return items[h % items.length];
}

function article(phrase: string): string {
  return /^(a|an) /i.test(phrase) || /^pair /i.test(phrase) ? `a ${phrase}` : /^[aeiou]/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
}

/**
 * A ready-to-save description: an opening paragraph, "Key points" from the
 * name, and a wholesale line when the product has a minimum order or pack.
 */
export function describeProduct(input: DescribeInput): string {
  const officialModel = input.specs && typeof input.specs === "object" && !Array.isArray(input.specs)
    ? String((input.specs as Record<string, unknown>).Model ?? "").trim()
    : "";
  const name = officialModel || readableName(input.name);
  const kind = productKind(input);
  const brand = cleanBrand(input.brand, input.name);
  const facts = factsFromName(input.name);
  const nounPhrase = kind.noun.startsWith("pair of") ? `a ${kind.noun}` : article(kind.noun);

  const nameHasBrand = brand ? name.toLowerCase().includes(brand.toLowerCase()) : true;
  const who = brand && !nameHasBrand ? ` from ${brand}` : "";
  const opener = pick(
    [
      `${name} is ${nounPhrase}${who}.`,
      `The ${name} is ${nounPhrase}${who}.`,
    ],
    input.name,
  );
  const paragraph = `${opener} ${pick(kind.use, input.name + "u")}`;

  // "Model" is the opening sentence and "Type" restates it — keep both in the
  // spec table, not in the bullets.
  const official = specRows(input.specs).filter((row) => !/^(model|type):/i.test(row));
  const points = [...official, ...facts.filter((fact) => !coveredBy(fact, official))];
  if (brand && !official.some((row) => /^brand:/i.test(row))) points.push(`Brand: ${brand}`);

  const lines = [paragraph];
  if (points.length > 0) {
    lines.push("", "Key points", ...points.map((p) => `• ${p}`));
  }
  const moq = input.moq && input.moq > 1 ? input.moq : null;
  const pack = input.packMultiple && input.packMultiple > 1 ? input.packMultiple : null;
  if (moq || pack) {
    const parts = [moq ? `minimum order ${moq} pieces` : null, pack ? `sold in packs of ${pack}` : null].filter(Boolean);
    lines.push("", `Wholesale: ${parts.join(", ")}.`);
  }
  return lines.join("\n");
}

/** Every opening line the writer can produce — used to recognise its own text. */
export function writerSentences(): string[] {
  return [...KINDS, FALLBACK].flatMap((kind) => kind.use);
}

/** Is this box empty enough to fill? Owner-written text is never replaced. */
export function needsDescription(description: string | null | undefined): boolean {
  return !description || description.trim().length === 0;
}
