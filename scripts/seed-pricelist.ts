/**
 * Bulk seed from the supplier price lists (transcribed from photos).
 *
 * - Brand is derived from the product NAME (the lists mix brands), category by
 *   keyword. Missing brands + categories are created. Prices are the per-unit
 *   RATE in whole rupees → integer paise.
 * - Idempotent: upsert by slug (no duplicate products). Existing products keep
 *   their SKU. deletedAt is set explicitly (Atlas visibility).
 *
 * Run:
 *   DATABASE_URL="mongodb+srv://.../memorydeals?..." npx tsx scripts/seed-pricelist.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);

// ── Brand derivation (ordered; first prefix match wins) ────────────────────
const BRAND_RULES: [RegExp, string][] = [
  [/^realme/i, "realme"],
  [/^one\s?plus|^oneplus/i, "OnePlus"],
  [/^boat/i, "boAt"],
  [/^ambrane/i, "Ambrane"],
  [/^portronics|^por[\s-]?\d/i, "Portronics"],
  [/^noise/i, "Noise"],
  [/^jbl/i, "JBL"],
  [/^zebronics|^zeb[\s.]/i, "Zebronics"],
  [/^fireboltt?|^firebolt/i, "Fireboltt"],
  [/^digitek/i, "Digitek"],
  [/^ubon/i, "Ubon"],
  [/^erd/i, "ERD"],
  [/^captain/i, "Captain"],
  [/^sandisk/i, "SanDisk"],
  [/^samsung/i, "Samsung"],
  [/^apple|^airtag/i, "Apple"],
  [/^redmi/i, "Redmi"],
  [/^mi\s/i, "Mi"],
  [/^xiaomi/i, "Mi"],
  [/^oppo/i, "Oppo"],
  [/^vivo/i, "Vivo"],
  [/^nothing|^cmf/i, "Nothing"],
  [/^google/i, "Google"],
  [/^nokia/i, "Nokia"],
  [/^itel/i, "Itel"],
  [/^lava/i, "Lava"],
  [/^hmd/i, "HMD"],
  [/^jio|^jivell/i, "Jio"],
  [/^kechaoda/i, "Kechaoda"],
  [/^beetel|^beetal/i, "Beetel"],
  [/^binatone/i, "Binatone"],
  [/^panasonic/i, "Panasonic"],
  [/^casio/i, "Casio"],
  [/^havells/i, "Havells"],
  [/^philips/i, "Philips"],
  [/^marshall/i, "Marshall"],
  [/^pebble/i, "Pebble"],
  [/^hp\s/i, "HP"],
  [/^dell/i, "Dell"],
  [/^logitech/i, "Logitech"],
  [/^rap+oo|^rappo/i, "Rapoo"],
  [/^lapcare/i, "Lapcare"],
  [/^quantron/i, "Quantron"],
  [/^intex/i, "Intex"],
  [/^qubo/i, "Qubo"],
  [/^cp\s?plus/i, "CP Plus"],
  [/^mz\s/i, "MZ"],
  [/^soroo/i, "Soroo"],
  [/^evm/i, "EVM"],
  [/^kudos/i, "Kudos"],
  [/^dji/i, "DJI"],
  [/^koosda/i, "Koosda"],
  [/^ubon/i, "Ubon"],
  [/^metbul+|^metbull/i, "Metbull"],
  [/^flayr|^flayer/i, "Flayr"],
];
function deriveBrand(name: string): string | null {
  for (const [re, brand] of BRAND_RULES) if (re.test(name)) return brand;
  return null;
}

// ── Category derivation (ordered; first keyword match wins) ────────────────
interface Cat { slug: string; name: string; hsn: string }
const CATS: Record<string, Cat> = {
  screen: { slug: "screen-protectors", name: "Screen Protectors", hsn: "3919" },
  microphones: { slug: "microphones", name: "Microphones", hsn: "8518" },
  lighting: { slug: "lighting", name: "Lighting", hsn: "9405" },
  gimbals: { slug: "gimbals", name: "Gimbals & Stabilizers", hsn: "9620" },
  tripods: { slug: "tripods-selfie-sticks", name: "Tripods & Selfie Sticks", hsn: "9620" },
  grooming: { slug: "grooming", name: "Grooming & Personal Care", hsn: "8510" },
  projectors: { slug: "projectors", name: "Projectors", hsn: "8528" },
  cameras: { slug: "cameras-security", name: "Cameras & Security", hsn: "8525" },
  computer: { slug: "computer-peripherals", name: "Computer Peripherals", hsn: "8471" },
  memory: { slug: "memory-cards", name: "Memory Cards & Storage", hsn: "8523" },
  powerbanks: { slug: "power-banks", name: "Power Banks", hsn: "8507" },
  watches: { slug: "smart-watches", name: "Smart Watches", hsn: "8517" },
  speakers: { slug: "bluetooth-speakers", name: "Bluetooth Speakers", hsn: "8518" },
  earphones: { slug: "earphones-headsets", name: "Earphones & Headsets", hsn: "8518" },
  car: { slug: "car-accessories", name: "Car Accessories", hsn: "8708" },
  cables: { slug: "cables", name: "Cables", hsn: "8544" },
  chargers: { slug: "chargers", name: "Chargers", hsn: "8504" },
  torches: { slug: "torches", name: "Torches", hsn: "8513" },
  phones: { slug: "keypad-phones", name: "Keypad Phones & Landline", hsn: "8517" },
  other: { slug: "other-accessories", name: "Other Accessories", hsn: "8517" },
};
function deriveCategory(name: string): Cat {
  const n = name.toLowerCase();
  if (/tempered|privacy|uv glass| glass|membrane|fibre|fiber|lamination|ring camera/.test(n)) return CATS.screen;
  if (/\bdwm\b|podcast mic|lavalier|wireless mic|\bmic\b(?!.*speaker)/.test(n) && !/speaker|soundbar/.test(n)) return CATS.microphones;
  if (/ring light|video light|stick light|led-d|rgb light|selfie light|\bled\b light/.test(n)) return CATS.lighting;
  if (/gimbal|gimble|gimbel|osmo/.test(n)) return CATS.gimbals;
  if (/tripod|selfie stick|monopod|feet stand| stand \d/.test(n)) return CATS.tripods;
  if (/trimmer|shaver|massager|facial|grooming/.test(n)) return CATS.grooming;
  if (/projector|projecter|pixaplay|cinehead|smart led/.test(n)) return CATS.projectors;
  if (/camera|cctv|\bdvr\b/.test(n)) return CATS.cameras;
  if (/mouse|keyboard|key board|keytonic|k-board|wireless kit|wired kit|km\d|combo/.test(n)) return CATS.computer;
  if (/\bmsd\b|pendrive|memory card|micro ?sd|\botg\b|card reader|flair|flash drive|note machine|note counting/.test(n)) return CATS.memory;
  if (/power ?bank|\bpb\d|\d+k? ?mah|magsafe power|energitank|energisafe|energipod|powermini|minicharge/.test(n)) return CATS.powerbanks;
  if (/watch|smartwatch/.test(n)) return CATS.watches;
  if (/soundbar|sound bar|speaker|\bstone\b|party ?pal|aavante|music bomb|thump|barrel|sound feast|boombox|radio|\bspk\b|sp[- ]?\d/.test(n)) return CATS.speakers;
  if (/neckband|neck band|buds|airdop|airpod|earphone|handsfree|headphone|head ?phone|hphone|\btws\b|rockerz|\bhitz\b|beatz|wave beam|enco|escape \d|air clip|\bn\/b\b/.test(n)) return CATS.earphones;
  if (/holder|mount|dashcam|dash cam|car charger|car power|inverter|vacuum|vaccum|tyre|tire|inflator|carplay|car receiver|\bbike\b|rearview|car perfume|aromatherapy/.test(n)) return CATS.car;
  if (/cable/.test(n)) return CATS.cables;
  if (/charger|adaptor|adapter|\bdock\b|adapto/.test(n)) return CATS.chargers;
  if (/torch/.test(n)) return CATS.torches;
  if (/telephone|cordless|walki|walkie|calculator|keypad|dual sim|single sim|4g sim|feature phone| sim\b|gsm/.test(n)) return CATS.phones;
  return CATS.other;
}

// ── The transcribed data (name, price in whole rupees = per-unit RATE) ──────
const RAW: [string, number][] = [
  // realme
  ["realme T110",1140],["realme T200 Lite",1100],["realme T200 X",1150],["realme T200",1390],["realme T310",1590],["realme Buds T500 Pro",2390],["realme Air 7",2340],["realme Air 8",3080],["realme Buds Air 7 Pro",3950],["realme Air 8 Pro",5450],["realme Wireless 5 Lite",950],["realme Buds Wireless 3 Neo",950],["realme Buds Wireless 3",1390],["realme Buds Wireless 5 ANC",1390],["realme Watch S2 With Strap",2900],["realme Watch 5",3550],["realme SuperVOOC 45W Adaptor",730],["realme 80W Dock",1540],["realme 2in1 1.5M 3Amp Cable",260],["realme SuperVOOC Cable",250],["realme Buds 3 Aux Earphone",490],["realme Buds 3 Type C Earphone",540],
  // boAt earbuds
  ["boAt Ace",740],["boAt Joy",740],["boAt 91",790],["boAt 71",790],["boAt Airdopes 161/163",790],["boAt Pulse",790],["boAt 213",790],["boAt 138/131 Gen 2",790],["boAt 138/131",690],["boAt Ace Gen 2",830],["boAt 219",790],["boAt Immortal 100",875],["boAt Immortal 121",840],["boAt Immortal 141",840],["boAt Immortal Katana",1390],["boAt 170 ANC",910],["boAt 141 Elite ANC",1050],["boAt 131 Elite ANC",1050],["boAt 513 ANC",1200],["boAt Ultra Pro",1230],["boAt 161 ANC Elite",1240],["boAt 701 ANC",1710],["boAt Nirvana Lucid",1410],["boAt Nirvana Crystal",1550],["boAt Nirvana Crown",2180],["boAt Nirvana Zenith Pro",2380],["boAt 311 Pro",810],["boAt Drift",1020],
  // OnePlus
  ["OnePlus Nord Buds 3R",1540],["OnePlus Nord Buds 3",1970],["OnePlus Nord Buds 4 Pro",3600],["OnePlus Nord Buds 3 Pro",2490],["OnePlus Buds 3",4200],["OnePlus Buds 4",5400],["OnePlus Z2 ANC Neckband",1730],["OnePlus Z3 Neckband",1390],["OnePlus 80W Adaptor",1600],["OnePlus 100W Charger",2050],["OnePlus Cable USB To C",640],["OnePlus C To C Cable",640],
  // Digitek
  ["Digitek DWM 010 Type C Mic",700],["Digitek DWM 006 Pro Type C Mic",680],["Digitek DWM 014 ANC Type C Mic",1020],["Digitek DWM 007 Pro Apple Mic",740],["Digitek DWM 009 Pro Apple Mic",1175],["Digitek DWM 114 Mic",1800],["Digitek DWM 115 Mic",2715],["Digitek DWM 120 Mic",1885],["Digitek DWM 124 Mic",2415],["Digitek DWM 103 Mini Mic",1690],["Digitek DWM 116 Mic",3120],["Digitek DWM 119 Mic",2260],["Digitek DWM 101 Extreme Mic",3500],["Digitek DM 401C Podcast Mic",1980],["Digitek Smart Finder DSF 001",520],["Digitek Video Light LED-D432",1400],["Digitek Battery F750",690],["Digitek DRL 14C 14 Inch Ring Light + Stand",1200],["Digitek DPRL19 RT 19 Inch Ring Light",2720],["Digitek Tripod DTR 550 LT",1500],["Digitek Stick Light DSL25W RGB",4070],["Digitek Stick Light DSL 30W RGB",6265],["Digitek Stick Light DSL 27W RGB",4125],["Digitek Action Camera DAC 002",6745],["Digitek Action Camera DAC 101",8245],["Digitek Gimbal DSG 007F AI",5955],["Digitek Gimbal DSG 008F Pro",4900],["Digitek Gimbal DSG 009F AI",7245],["Digitek C To L Mic Connector",240],["Digitek C To C Mic Connector",150],
  // Bike & Car Holder
  ["Portronics POR 2060 Mobike 4 Bike Mobile Holder",198],["Portronics POR 3330 Mobike 5 Plus",296],["Portronics POR 3329 Mobike 4 Plus Bike Mobile Holder",315],["Portronics POR 1987 Clamp M3",241],["Portronics Clamp M2 POR1609",236],["Portronics POR 2532 Mogun 4",363],["Portronics POR 2531 Clamp Z",182],["Portronics Vayu 5.0 Lite POR 3198",1265],["Portronics POR 2853 Mobike 5 Bike Holder",270],["Portronics POR 3255 Hold Y Magnetic Mobile Stand",533],["Portronics POR 3047 Hold X Magnetic Mobile Stand",589],["Ambrane Grip Stand 2",256],["Q31 Car Holder",300],["Universal Cell Holder Clip",130],["H12 Car Holder",120],["Car Mobile Mount",150],["Car Phone Holder 360",150],["USZJ 072 Car Holder",1000],["Motorcycle XY089 Holder",150],["Car Rearview Mirror Bracket",220],["KSD H-22 Car Holder",500],
  // Dash Cam / Car
  ["Intelligent Aromatherapy Car Perfume",480],["boAt Dashcam E1",2700],["Majik Third Eye Dashcam",1470],["Portronics POR 2759 Tune Wireless Car Receiver",1683],["Portronics POR 3263 Tune Plus Carplay Android Auto",6001],["Ambrane BT Carplay Carlink BW-W06",1683],["Ambrane Carlink Stream BW W21",5704],["Portronics POR 3269 Zaptor Car Power 200W",2000],["Portronics POR 3247 Car Power 3 Pro 200W",2810],["Portronics Car Power One POR003",2613],["Ambrane Car Inverter Smartstrip Auto",2280],["Zebronics Air Gun 700",1740],["Zebronics 19T16 Tyre Inflator",2070],["Portronics POR 3094 Vayu 8.0 Inflator",1385],["Portronics POR 3396 Vayu 3T Portable Inflator",1374],["Portronics POR 2155 Vayu 5 Portable Tyre Inflator",2062],["Ambrane Vacuum Cleaner Minivac 02",2000],["Ambrane Vacuum Cleaner Minivac 01",1027],["Portronics POR 2670 Mopcop Pro Portable Vacuum",1550],["Portronics POR 3470 Mopcop Prime Vacuum Cleaner",2122],
  // Mouse & Keyboard
  ["Zebronics Alex Mouse",120],["Quantron Mouse 535",85],["HP M10 Wired Mouse USB",230],["Dell MS116 Wired Mouse USB",265],["Logitech Wired Mouse M90",305],["HP Wireless Mouse",490],["Dell Wireless Mouse",640],["Logitech M170 Wireless Mouse",540],["Logitech Wireless Mouse 185",740],["Zebronics Dazzle Wireless Mouse",167],["Zebronics Keyboard K65",210],["Quantron Wired Keyboard QKB 11",210],["HP Wired Keyboard",470],["Dell KB 216 Wired Keyboard",550],["HP K120 Wired Keyboard",590],["Rapoo USB Keyboard",480],["Keyboard + Mouse Kit Companion 107",585],["HP Wireless Kit KM 260",990],["Dell Wireless Kit KM3322W",1325],["Logitech Wireless Kit MK220",1380],["Rapoo Wireless Kit",1100],["HP Wired Kit KM150",740],["HP Wireless Keyboard",790],["Lapcare Gaming Keyboard",790],["Zebronics Transformer 1 Gaming Keyboard",1050],
  // Chargers (mixed)
  ["Mi Micro Cable",105],["Mi Type C Cable",110],["Mi 33W Sonic Cable 2.0",155],["Mi 120W Cable",340],["Mi 60W C To C Cable",340],["Mi 22.5W Charger",560],["Mi 33W Sonic Charger",830],["Mi 45W Charger",1140],["Mi 67W Charger",1390],["Mi 120W Charger",1950],["Nothing 33W CMF Charger",730],["Nothing 65W Charger",1890],["Vivo 44W Adaptor",1140],["Vivo 80W Adaptor",1320],["Vivo 6Amp Type C Cable",340],["Oppo 45W Adaptor",490],["Oppo 80W VOOC Adaptor",990],["Oppo VOOC Type C Cable",280],["boAt Type C To L 27W Cable",180],["Google 30W Charger With Cable",1880],
  // Gimbals
  ["M1 3Axis Gimbal",2850],["Smart X2 Gimbal",4480],["Koosda KM03 Gimbal",4480],["DJI Osmo Mobile SE",5500],["DJI Osmo Mobile 7 Gimbal",5900],["DJI Osmo 7P Gimbal",9200],
  // Noise watches
  ["Noise Quad Call",990],["Noise Victor Watch",980],["Noise Caliber 3 Go Watch",990],["Noise Colorfit Icon Arc Smartwatch",1050],["Noise Colorfit Pulse 4 Smartwatch",1510],["Noise Colorfit Pulse Grand 3",1100],["Noise Twist Go",1250],["Noise Twist Go Chain",1540],["Noise Hexa Watch",1590],["Noise Vortex Plus Strap",1810],["Noise Fit Diva Strap",2200],["Noise Diva Metal Gold Chain",2500],["Noise Champ 3 Watch",1700],["Noise Force 2",1460],["Noise Endeavour",3100],["Noise Origin",2400],["Noise Colorfit Pro 6",3050],["Noise Colorfit Pro 6 Max",4700],["Noise Diva Araya Chain",3800],["Noise Explorer 2 Frost Pop",5100],
  // Noise buds (mixed)
  ["Noise Go Buds",730],["Noise Buds F1",770],["Noise Buds R1",820],["Noise Buds Combat X",820],["Noise Pop",820],["Noise Buds Marine",1780],["Noise View Buds",1800],["Noise Air Clips 2",1850],["Noise Master Buds",4400],["Nothing CMF 2A Buds",1590],["Nothing CMF 2 Buds",2020],["JBL Wave Beam 2",2950],["JBL Wave Beam",2290],["Oppo Enco Buds 3 Pro",1190],["Mi Buds 5A",1100],["Samsung Buds 3 FE",7050],["Marshall Minor 4",8800],
  // Grooming / Projector / Camera / Massager (mixed)
  ["Havells BT 5100C Trimmer",790],["Havells Trimmer BT2111",700],["Havells Trimmer BT6111",1040],["Zebronics HT 100 Trimmer",660],["Zebronics HT120 Trimmer",685],["Zebronics Shaver S Lite",780],["Philips Trimmer",790],["boAt Cinehead E1 Projector",6700],["Portronics POR 2289 Beam 450 Smart LED Projector",8839],["Portronics POR 2310 Beam 470 Mini Smart LED Projector",7185],["Zebronics Pixaplay 72 Projector",5580],["Orange Projector",2850],["Mini Projector",2560],["5MP Camera Wifi 360",1850],["5MP Camera OU 4 360 Sim",2040],["Solar Camera 8MP Dual",2900],["Solar Camera 8MP Triple",3700],["CP Plus Camera Wifi 2MP CP E28Q",1750],["CP Plus Camera Wifi 3MP CP E38Q",1990],["CP Plus Camera Wifi 3MP P34Q",1990],["Qubo 3MP Camera",2300],["Qubo Smart Bullet Camera",2800],["Facial Massager Gun",415],["Head Massager",340],["Neck Shoulder Massager",1250],["Portronics POR 3144 Zeno Go Mini Massager",1788],
  // Power banks (mixed)
  ["Intex Magsafe Power Bank 10K MAH",1090],["boAt PB300 Lite 10K MAH",730],["boAt PB300 10K MAH",880],["boAt PB400 20K MAH",1360],["boAt PB 331 Magsafe 10K MAH",1260],["boAt PB600 160W 27K MAH",2600],["Noise Onyx 20K MAH 45W Power Bank",2050],["Noise QI2 Magsafe Power Bank",1910],["Mi 4i 10K MAH Power Bank",1120],["Mi 4i 20K MAH Power Bank",1780],["Samsung 10K MAH Wireless Power Bank",1750],
  // Torches / Calculators / Telephones (mixed)
  ["MZ M299 Torch",750],["MZ M239 Torch",950],["MZ M237 Torch",550],["MZ M986 Torch",430],["MZ M987 Torch",450],["MZ M923 Torch",340],["MZ M930 Torch",300],["MZ M035 Torch",320],["MZ M983 Torch",620],["Soroo Torch",100],["Portronics POR 3045 Eco Glow 2 Torch",358],["Portronics POR 2507 Eco Glow Mini Torch",204],["Portronics POR 2506 Ecoglow Rechargeable LED Torch",402],["Casio Calculator DJ-120D",700],["Casio Calculator MJ-12SB",480],["Libor 70 Note Counting Machine",4800],["Libor 75 Note Counting Machine",4500],["Mix Value Note Counting Machine",7800],["Beetel Phone M56",1090],["Beetel Telephone G10",575],["Beetel Cordless Telephone X90",1850],["Beetel GSM Sim Phone F1K Single Sim",2350],["Binatone Fusion 200 Dual Sim",2100],["Panasonic Telephone KX-TG3611SXB",2790],["Walkie Talkie BF888S",1150],
  // Apple & Samsung
  ["Apple 20W Adapter",1710],["Apple OG Cable C To L",1340],["Apple OG Cable C To C",1390],["Apple C To C Cable 2M",1850],["Apple Lightning Earphone",1510],["Apple Type C Earphone",1650],["Apple AirTag 4 Pack",2150],["Samsung 25W Adaptor",850],["Samsung 60W Adaptor",2890],["Samsung USB To Type C Cable 1.5M DG930",390],["Samsung C To C Cable 1M DA705",435],["Samsung Type C Earphone",540],["Samsung AKG Type-C Earphone",1240],
  // Branded Earphones
  ["boAt 100 Earphone",250],["boAt 104 Earphone",270],["boAt 85 Earphone",250],["boAt 162 V2 Earphone",270],["boAt 220 Earphone",330],["boAt 90C Type C Earphone",345],["boAt Basshead 300C",415],["Mi Aux Earphone Sonic",365],["Mi Type-C Earphone",540],["Oppo Type C Earphone",390],["Vivo Type C Earphone",350],
  // Keypad Phones
  ["Itel 2165 C",910],["Itel Ace 3 Shine",850],["Itel Ace 2 Heera",810],["Lava A1 Josh",950],["Lava Hero Shakti",890],["Nokia 105 Single Sim With Charger",1140],["Nokia 105 UPI",1190],["Nokia 130",1890],["HMD 100 Single Sim",840],["HMD 100 Dual Sim",900],["HMD 105 Dual Sim",960],["Jio Bharat V4",710],["Kechaoda A27",770],["Kechaoda K33",870],["Kechaoda K115",860],["Jivell Mobile",430],["Foneme F60",450],
  // Portronics mouse/keyboard
  ["Portronics POR1800 Toad 101 Wired Mouse",98],["Portronics POR 3351 Vader X Wired Mouse",464],["Portronics POR 2016 Vader Wired Mouse",359],["Portronics POR 3432 Toad 33 Wireless Mouse",237],["Portronics POR 2783 Toad 34 Wireless Mouse",252],["Portronics POR 3467 Toad Neo Wireless Bluetooth Mouse",453],["Portronics POR 2880 Vader Max Wireless Mouse",670],["Portronics POR 2385 Vader Pro Wireless Mouse",440],["Portronics POR 1784 Toad II Wireless Mouse",457],["Portronics POR 2151 Toad 8 Wireless Mouse",523],["Portronics POR 2417 Ki Pad 3 Wired Keyboard",370],["Portronics POR 2405 Keytonic Keyboard",550],["Portronics POR 3337 Key4 Combo Wireless Keyboard Mouse",780],["Portronics POR 1933 Key 7 Combo Wireless Keyboard",765],["Portronics POR 347 Bubble 2.0 Bluetooth Keyboard",1121],["Portronics POR 2198 Bubble Keyboard",838],["Portronics POR 2195 Bubble 3.0 Wireless Keyboard",802],["Portronics POR 2457 Bubble 4.0 Keyboard",989],["Portronics POR 2200 Akshr Prime Wireless Keyboard",798],["Ambrane SLIQ-3 Wireless Mouse",229],
  // Tempered / Glass / Membrane
  ["Super X OG Tempered",15],["Privacy Tempered",35],["Metbull Tempered",35],["Metbull Tempered New Model",45],["Metbull Privacy",42],["Metbull Privacy 17 Series",47],["Metbull S Series Tempered",40],["Metbull 360 Privacy",60],["Metbull S Series Privacy",60],["Flayr Tempered",45],["Border Less Flayr",47],["Xmart 50kg Tempered",65],["Border Less Flayr Privacy",70],["AG Matt Tempered",35],["5 in 1 UV Glass",170],["2 in 1 UV Glass",75],["Ring Camera Glass Apple",35],["Ring Camera Glass Samsung",55],["Big Fibre",150],["Medium Fibre",80],["Small Fibre",70],["360 Membrane",18],["Membrane",18],["Watch Membrane",13],["Fold Front & Back Membrane",25],["Fold Middle Membrane",65],["8 Inch Lamination Sheet",35],["12 Inch Lamination Sheet",120],["17 Inch Lamination Sheet",220],["2 in 1 Tab Tempered",280],["5 in 1 Tab Tempered",630],
  // Tripods
  ["Tripod Stand 3366",450],["Tripod Stand F3366",500],["Tripod Stand 3388",580],["KSD 280 Tripod Stand",670],["KSD 580 Tripod Stand",900],["KSD 680 Tripod Stand",1200],["KSD 980 Tripod Stand",1490],["VCT 5208 Tripod",1100],["KTP 03 Selfie Stick + Tripod",850],["VCT 91666 Selfie Stick + Tripod",1100],["VCT 1688 L Selfie Stick + Tripod",1000],["Seven X 9 Feet Stand",450],
  // Ring Lights
  ["Ring Light 12 Inch",200],["Ring Light 14 Inch",450],["Ring Light 22 Inch",1600],["Ring Light 18 Inch RGB",1150],["M160 RGB Light",420],["M28 Selfie Light + Magsafe",430],
  // Fireboltt watches
  ["Fireboltt Assault",900],["Fireboltt Maverick",950],["Fireboltt Gladiator Plus Strap",1150],["Fireboltt Asteroid",910],["Fireboltt Ninja Call Pro",950],["Fireboltt Shark",950],["Fireboltt Ninja Call Pro Max",1030],["Fireboltt Phoenix Pro Watch",1150],["Fireboltt Rise Force",1090],["Fireboltt Zenith Chain",1190],["Fireboltt Invincible Plus Strap",1250],["Fireboltt Collide",1300],["Fireboltt Legacy Nova",2150],["Fireboltt Shott 4/64GB 4G SIM Watch",2950],["Fireboltt Shott 2/16GB 4G SIM Watch",2750],["Pebble Junior Kids Watch",4370],["Pebble Cosmos Engage",1100],["Pebble Nomad Smart Watch PFB 56",1100],["Zebronics Mamba Watch",1060],["Zebronics Fit S1 Smart Watch",1154],["Redmi Watch Move",1450],
  // Ambrane power banks
  ["Ambrane PP-129 10K mAh 12W",701],["Ambrane Extreme 10K mAh 22.5W",878],["Ambrane Stylo N10 10K mAh 22.5W",989],["Ambrane Extreme 20K mAh 22.5W",1348],["Ambrane Stylo N20 20K mAh 22.5W",1761],["Ambrane Minicharge 20 20K mAh 22.5W",1647],["Ambrane Powermini 20 20K mAh 35W",1968],["Ambrane PB12 10K mAh Magsafe 22.5W",1396],["Ambrane PB21 10K mAh Magsafe",1495],["Ambrane PB12 Pro 10K mAh Magsafe",1751],["Ambrane PB 24 Pro 20K mAh Magsafe 25W",2643],
  // Ambrane cables/chargers/audio
  ["Ambrane Micro Cable ACM 1A2",46],["Ambrane ACT C11 Type C Cable",61],["Ambrane BCM C15 Micro 1.5M Cable",104],["Ambrane BCT C15 Type C 1.5M Cable",109],["Ambrane BCL C15 Lightning 1.5M Cable",117],["Ambrane BCTT 15 C To C 1.5M Cable",138],["Ambrane ABTL 125G C To L 1.25M Cable",152],["Ambrane Wall Charger AWC-47 Micro",132],["Ambrane AWC47 T Wall Charger With Type C Cable",171],["Ambrane AQC 56 18W Dock",180],["Ambrane Uni 20T With C To C Cable",355],["Ambrane Wall Charger Flash 30",370],["Ambrane Wall Charger AWC-25",335],["Ambrane Car Charger ACC56",140],["Ambrane CS1 51W Car Charger",335],["Ambrane Hitz 30 Neckband",670],["Ambrane Buds Bots Icon",880],["Ambrane EP56 Pro Aux Earphone",399],["Ambrane Beatz T02 Type C Earphone",203],
  // ERD
  ["ERD UC 50 Micro Cable",45],["ERD UC 60 Type C Cable",50],["ERD UC 70 iPhone Cable",65],["ERD UC 211 C To C Cable",66],["ERD UC 256 Micro Flat Cable",52],["ERD UC 235 Type C Flat Cable",58],["ERD UC 281 3 In 1 Cable",102],["ERD UC 201 Aux Cable",51],["ERD UC 150 Micro Braided Cable",72],["ERD UC 302 Type C Cable",68],["ERD UC 305 Lightning Cable",79],["ERD UC 303 C To C Cable",75],["ERD UC 306 C To L Cable",124],["ERD UC 146 120W Type C Cable",188],["ERD TC 202 2 Amp Dock",103],["ERD TC 202 With Micro Cable Dock",148],["ERD TC 204 15W Dock",131],["ERD TC 222 20W Dock",185],["ERD TC 222 With C Cable Dock",235],["ERD TC 223 33W Dock",244],["ERD TC 232 25W C To C Cable Dock",273],["ERD TC 224 44W Dock",292],["ERD TC 102 10W USB Dock",121],["ERD TC 102 M 10W USB Micro Dock",165],["ERD TC 131 20W C To C Cable",284],["ERD TC 132 25W C To C Cable",290],["ERD TC 133 33W C To C Cable",320],["ERD TC 145 45W Dock USB + C",487],["ERD TC 146 65W Dock USB + C",572],["ERD TC 161 45W USB To C Cable",522],["ERD TC 162 65W USB To C Cable",578],["ERD CC 21 2 Amp Dock",102],["ERD CC 22 2 Amp Dual USB Dock",121],["ERD PB 10KE 10K mAh Power Bank",523],["ERD PB 20KE 20K mAh Power Bank",875],["ERD PB 180 10K mAh Magsafe Power Bank",1148],["ERD PB 130 10K mAh 25W Power Bank",690],["ERD UC 207 Micro OTG",48],["ERD UC 206 Type C OTG",56],["ERD TWS 20 Earbuds",532],["ERD WE 11 Pro Neckband",402],["ERD NK 1100 5C Keypad",101],["ERD NK 6100 4C Keypad",130],["ERD X200 Samsung Charger",130],["ERD F 90 Jio Charger",146],["ERD HC 23 5 Mtr HDMI Cable",480],["ERD PS 30D 5 Amp DTH Charger",480],["ERD HF102 Type C Handsfree",151],
  // Small speakers
  ["MZ S7 Speaker",260],["MZ M-13 VP Speaker",330],["Soroo Yo 434 Speaker",280],["Soroo Yo 466 Speaker",300],["Soroo Yo 390 Speaker",215],["Soroo Yo 381 Speaker",180],["Soroo Yo 366 Speaker",150],["Soroo Yo 461 Speaker",265],["MZ S 666 Retro Radio Speaker",740],["MZ M-408 Speaker",350],["MZ M-419 Speaker",360],["MZ TG-113 Speaker",225],
  // Zebronics cables/chargers/audio
  ["Zebronics MU240 Micro Cable",50],["Zebronics TU240 Type C Cable",55],["Zebronics ULC300V Lightning Cable",85],["Zebronics LT200 C To C Cable",50],["Zebronics CCS600 Type-C Cable",80],["Zebronics 3 In 1 Cable UMLCC1205",150],["Zebronics Calyx Earphone With Mic",120],["Zebronics Aria Type C Earphone",145],["Zebronics MA100B 2.4Amp With Micro Cable",140],["Zebronics MA200 2.4Amp With Type C Cable",148],["Zebronics MA100B 20W With Type C Cable",150],["Zebronics MA104B 20W C Dock",320],["Zebronics MA108B 25W C Dock",290],["Zebronics MA101B 35W Adaptor",570],["Zebronics CC242A3 Car Charger Type C Cable",133],["Zebronics CC60 60W Car Charger",410],["Zebronics Yoga N3 BT Earphone",410],["Zebronics Chime Airpods",670],["Zebronics PB17 10K MAH 12W Power Bank",480],["Zebronics Energisafe 10R4 10K MAH 22.5W Power Bank",590],["Zebronics Paradise Neo R Headphone",660],["Zebronics HT 100 Trimmer",660],
  // Zebronics power banks
  ["Zebronics S10 Pro 10K MAH 22.5W Power Bank",590],["Zebronics 10MR 10000mAh Power Bank",650],["Zebronics Energitank 10R1 Power Bank",1010],["Zebronics R5 Pro 20K MAH 22.5W Power Bank",980],["Zebronics Energipod 20R2 Power Bank",1090],["Zebronics 27R1 22.5W 27000mAh Power Bank",1450],["Zebronics 50RI 50K 22.5W Power Bank",2450],["Zebronics MW 67 10K MAH Magsafe Power Bank",1350],["Zebronics Energitank 10R5 10K MAH Power Bank",1250],
  // boAt watches
  ["boAt Watch Wave Pro 47 Non Calling",725],["boAt Wave Call",990],["boAt Storm Call 3",1050],["boAt Astra Neo Watch",1090],["boAt Ultima Ember",1710],["boAt Storm Verge Watch Chain",1720],["boAt Storm Verge Watch",1470],["boAt Lunar Discovery",1200],["boAt Wave Aura",1240],["boAt Storm Infinity Watch",1240],["boAt Enigma Daze Watch Chain",1700],["boAt Ultima Prime",1760],["boAt Wave Sigma 3 Curv",1210],["boAt Chrome Horizon Watch",2800],["boAt Chrome Endeavour Watch",3600],["boAt Lunar Pro Lite Sim Watch",2650],["boAt Lunar Discovery Neo",1190],
  // Speakers (mixed)
  ["JBL Go 3 Speaker",2390],["JBL Essential 2 Speaker",4600],["JBL Flip 6 Speaker",7400],["JBL Flip 7 Speaker",10100],["Mi Smart Speaker",1900],["boAt Stone 110",620],["boAt Stone 358",1340],["boAt Stone 358 Pro",1440],["boAt Beam Speaker",1420],["boAt Stone Sphinx Pro",2290],["boAt Stone Vibe",1260],["boAt Opus",6800],["boAt Joy Bar",900],["boAt Aavante Bar Aspire",890],["boAt Aavante Groove Plus",1210],["boAt Aavante Bar 950",2390],["boAt Aavante Bar Mystiq 100W",4500],["boAt 1550 Plus 160 Watt Soundbar",4900],["boAt Partypal 390",9400],["boAt Partypal 600",15500],["Kudos Duubi Marvel 24W Speaker",1350],["Kudos Duubi 40W Speaker",1950],
  // Headphones (mixed)
  ["EVM Headphone",810],["boAt Rockerz Trendz",930],["boAt Rockerz 421",990],["boAt Rockerz 430",990],["boAt Rockerz 460",990],["boAt Rockerz 425",1080],["boAt Rockerz 480",1410],["boAt Headphone 558",1340],["boAt Rockerz 512 ANC",2290],["boAt Rockerz 650 Pro",2350],["boAt Rockerz Plus 550 ANC",2650],["boAt 450 ANC Headphone",2275],["Fireboltt Bumble Bee Headphone",820],["Fireboltt O-Prime Headphone",1200],["Noise Airwave Max XR",2800],["Noise Airwave Max 4",1410],["Noise Airwave Max 5 Headphone",3600],["Noise Airwave Max 6 Headphone",4700],["Logitech H340 Headphone",2100],["JBL 510 Headphone",2100],["JBL 520 Headphone",2600],["JBL BT720 Headphone",4450],["JBL BT770 NC Headphone",4750],["JBL 520 Type C Headphone",1950],["Portronics POR 3261 Muffs M6 Bluetooth Headphone",952],["Portronics POR 3418 Muffs Noise A3 Headphone",1245],["Portronics POR 1882 Muffs M2 Headphone",886],["Zebronics Thunder Max Headphone",715],
  // Neckbands (mixed)
  ["boAt Signature Neckband",100],["boAt Rivera Neckband",170],["boAt Rockerz Summit Neckband",580],["boAt Rockerz 200",660],["boAt Rockerz Strive",660],["boAt Rockerz Bold Neckband",660],["boAt Rockerz Apex Neckband",700],["boAt Zen ANC",1120],["Noise Airwave Neckband",810],["Noise Crest Neckband",810],["Ubon BT-5200 Neckband",370],["ERD WE-31 Neckband",410],["Zebronics Yoga N3 Neckband",510],["Zebronics Escape 10 Neckband",380],["Portronics POR 1979 Harmonics Z7 Neckband",556],["Portronics POR 3090 Harmonics Z12 Wireless Neckband",692],["Portronics POR 1552 Harmonics 250 Neckband",725],
  // Ubon
  ["Ubon UB-111 Rapper Earphone",35],["Ubon TC-686 Type C Earphone",140],["Ubon Aux Earphone",30],["Ubon WR 71 OG C To C Cable",85],["Ubon WR 72 OG C To L Cable",100],["Ubon WR 58 C To C Cable",115],["Ubon WR 59 C To L Cable",135],["Ubon WR 97 C To C Orange Cable",140],["Ubon BT-50 Airpods",570],["Ubon SP 43 Speaker 8W",385],["Ubon SP-46 Speaker 10W",425],["Ubon SP-65 20W Speaker",590],["Ubon SP 80 Sound Bar 16W",570],["Ubon SP-90 Sound Bar With Mic",670],["Ubon Micro To C Connector",20],["Ubon GR 207 Multi Card Reader",50],
  // Portronics chargers/cables/audio
  ["Portronics POR 1103 Adapto One",280],["Portronics POR 1964 Adapto 25 Pro",458],["Portronics POR 1832 Adapto 70",523],["Portronics POR 2019 Adapto 35B",507],["Portronics POR 1242 Adapto 25 Plus",398],["Portronics POR 1255 Adapto 45C 45W Wall Charger",945],["Portronics POR 2955 Adapto 100 Pro With Cable",2089],["Portronics POR 2492 Adapto 100 Wall Charger",2514],["Portronics POR 1813 Konnect Micro Cable",50],["Portronics POR 1814 Konnect Link Type C Cable",64],["Portronics POR 1812 Konnect Lightning Cable",76],["Portronics POR 2715 Silklink Type C Cable",76],["Portronics POR 2719 Silklink Lightning Cable",83],["Portronics POR 1821 Konnect Dash Pro Type C 80W Cable",120],["Portronics POR 1661 Konnect Dash 2 Type C 65W Cable",153],["Portronics POR 1647 Konnect C To C Cable",110],["Portronics POR 1649 Konnect L1 C To L Cable",140],["Portronics POR 3416 Flatro Type C To C 60W Cable",160],["Portronics POR 2153 Procharge 4 In 1 Cable",375],["Portronics POR 2050 Konnect View Type C 66W Cable",307],["Portronics POR 2211 Konnect View Lightning Cable",248],["Portronics POR 2158 Konnect X Lightning Cable",98],["Portronics POR 2930 Conch Kappa Wired Earphone",208],["Portronics POR 2147 Conch Theta A Wired Earphone",202],["Portronics POR 2922 Conch Sigma Earphone",314],["Portronics POR 2749 Conch Theta C Wired Earphone",252],["Portronics POR 3063 Conch Theta L Earphone",360],["Portronics POR 3400 Quadline 60W Cable",483],
  // Speakers (Ambrane/Zeb/Portronics)
  ["Ambrane Evoke Aura Speaker",922],["Zebronics Sound Feast 80 Speaker",1700],["Zebronics Barrel 200 Speaker",2550],["Zebronics Impact Tower Speaker With Mic",2650],["Zebronics Music Bomb 2 Speaker",5350],["Zebronics Thump 802 Bluetooth Speaker",7800],["Zebronics Ababa 1 Computer Speaker",5325],["Portronics POR 1399 Sounddrum Portable Speaker",940],["Portronics POR 280 Sound Pot BT Speaker",1313],["Portronics POR 3282 Talk Six Wearable Speaker",1601],["Portronics POR 1578 Sound Drum 20W Speaker",2095],["Portronics POR 2982 Fynix 30W Portable BT Speaker",2254],["Portronics POR 2331 Harmony Mini 25W Speaker",2657],["Portronics POR 2392 Resonate Speaker",1484],["Portronics POR 2394 Resonet 2 14W Speaker With Mic",1843],["Portronics POR 1680 Radian 16W Soundbar",934],["Portronics POR 2345 Rumble 25W Speaker",1430],["Portronics POR 2787 Radiant 2 Speaker",2700],["Portronics POR 2342 Dash 10 50W Wireless Speaker",4971],["Portronics POR 3334 Dash 30W Party Speaker",2441],["Portronics POR 2343 Iron Beats 5 Plus 180W Wireless Speaker",10920],["Portronics POR 2244 Iron Beats 5 150W Speaker",8570],["Portronics POR 2347 Iron Beats 5 Pro 180W Wireless Speaker",9830],["Portronics POR 1272 Pure Sound 101 Speaker",4500],["Portronics POR 2650 Pure Sound 108 160W Soundbar",4786],
  // Captain / SanDisk memory
  ["Captain MSD 8GB",290],["Captain MSD 16GB",365],["Captain MSD 32GB",540],["Captain MSD 64GB",830],["Captain MSD 128GB",1370],["Captain Pendrive 8GB",290],["Captain Pendrive 16GB",330],["Captain Pendrive 32GB",420],["Captain Pendrive 64GB",530],["Captain Pendrive 128GB",990],["Soroo MSD 16GB",460],["Soroo MSD 32GB",590],["Soroo MSD 64GB",1150],["Soroo Pendrive 8GB",370],["Soroo Pendrive 16GB",440],["Soroo Pendrive 32GB",510],["Soroo Pendrive 64GB",620],["SanDisk Ultra MSD A1 64GB",1350],["SanDisk Ultra MSD A1 128GB",1890],["SanDisk Ultra MSD A1 256GB",3450],["SanDisk Ultra MSD A1 512GB",7900],["SanDisk Pendrive CZ50 16GB",460],["SanDisk Pendrive CZ50 32GB",550],["SanDisk Pendrive CZ50 64GB",660],["SanDisk Pendrive CZ50 128GB",1080],["SanDisk Ultra Flair CZ73 32GB",825],["SanDisk Ultra Flair CZ73 64GB",980],["SanDisk Ultra Flair CZ73 128GB",1510],["SanDisk Ultra Flair CZ73 256GB",2830],["SanDisk Ultra Flair CZ73 512GB",6150],["SanDisk Extreme MSD A2 64GB",1950],["SanDisk Extreme MSD A2 128GB",2850],["SanDisk Extreme MSD A2 256GB",5050],["SanDisk Extreme MSD A2 512GB",8900],["SanDisk Type-C OTG C3 32GB",1070],["SanDisk Type-C OTG C3 64GB",1250],["SanDisk Type-C OTG C3 128GB",1690],["SanDisk Type-C OTG C3 256GB",2900],["SanDisk Type-C OTG C3 512GB",5900],["SanDisk Extreme Pro MSD A2 64GB",2850],["SanDisk Extreme Pro MSD A2 128GB",4150],["SanDisk Extreme Pro MSD A2 256GB",6800],["SanDisk Extreme Pro MSD A2 512GB",13500],["SanDisk Metal OTG Type-C C4 64GB",1490],["SanDisk Metal OTG Type-C C4 128GB",2100],["SanDisk Metal OTG Type-C C4 256GB",3250],["SanDisk Metal OTG Type-C C4 512GB",6350],
];

async function main() {
  // Dedupe by slug (last write wins on price — keeps a single record).
  const bySlug = new Map<string, { name: string; price: number }>();
  for (const [name, price] of RAW) {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean || !Number.isFinite(price) || price <= 0) continue;
    bySlug.set(slugify(clean), { name: clean, price });
  }

  // Ensure categories.
  const catBySlug = new Map<string, string>();
  const usedCats = new Set<string>();
  for (const { name } of bySlug.values()) usedCats.add(deriveCategory(name).slug);
  for (const cat of Object.values(CATS)) {
    if (!usedCats.has(cat.slug)) continue;
    const row = await prisma.category.upsert({
      where: { slug: cat.slug },
      create: { name: cat.name, slug: cat.slug, status: "ACTIVE", defaultHsnCode: cat.hsn, defaultGstRateBps: 1800 },
      update: {},
      select: { id: true },
    });
    catBySlug.set(cat.slug, row.id);
  }

  // Ensure brands.
  const brandBySlug = new Map<string, string>();
  const brandNames = new Set<string>();
  for (const { name } of bySlug.values()) {
    const b = deriveBrand(name);
    if (b) brandNames.add(b);
  }
  let sort = 100;
  for (const bn of brandNames) {
    const bslug = slugify(bn);
    const row = await prisma.brand.upsert({
      where: { slug: bslug },
      create: { name: bn, slug: bslug, status: "ACTIVE", sortOrder: sort++ },
      update: {},
      select: { id: true },
    });
    brandBySlug.set(bslug, row.id);
  }

  // Upsert products.
  let created = 0;
  let updated = 0;
  for (const [slug, { name, price }] of bySlug) {
    const cat = deriveCategory(name);
    const categoryId = catBySlug.get(cat.slug)!;
    const brandName = deriveBrand(name);
    const brandId = brandName ? brandBySlug.get(slugify(brandName)) ?? null : null;
    const sku = ("PL-" + slug).toUpperCase().slice(0, 60);
    const pricePaise = Math.round(price * 100);

    const existing = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    await prisma.product.upsert({
      where: { slug },
      create: {
        name, slug, sku, brand: brandName, brandId, categoryId,
        price: pricePaise, status: "ACTIVE", stockStatus: "IN_STOCK", deletedAt: null,
      },
      update: {
        name, brand: brandName, brandId, categoryId, price: pricePaise,
        status: "ACTIVE", deletedAt: null,
      },
    });
    if (existing) updated++; else created++;
  }

  const [prod, brands, cats] = await Promise.all([
    prisma.product.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.brand.count(),
    prisma.category.count(),
  ]);
  console.log(`\nDone. Unique products in file: ${bySlug.size} (created ${created}, updated ${updated}).`);
  console.log(`DB now: ${prod} visible products, ${brands} brands, ${cats} categories.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
