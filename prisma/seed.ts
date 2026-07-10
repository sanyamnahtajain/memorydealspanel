/**
 * Idempotent seed for the MemoryDeals dev database.
 *
 * Run with a live DATABASE_URL (see scripts/dev-db.ts):
 *   npm run seed
 *
 * Upsert keys: Category.slug, Product.slug (sku stays in sync),
 * Admin.email, Customer.phone. AccessRequests / AccessGrants /
 * PageViews are replaced wholesale for seeded rows on every run, so
 * repeated runs converge to the same state.
 *
 * All money values are integer paise (49950 = ₹499.50).
 */

import { PrismaClient, Prisma, StockStatus, EntityStatus, CustomerStatus, RequestStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const daysFromNow = (d: number): Date => new Date(now.getTime() + d * DAY);
const daysAgo = (d: number): Date => new Date(now.getTime() - d * DAY);

/** ₹ to integer paise. */
const rs = (rupees: number): number => Math.round(rupees * 100);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categories = [
  { name: "Chargers", slug: "chargers", sortOrder: 1 },
  { name: "Power Cables", slug: "power-cables", sortOrder: 2 },
  { name: "Power Adapters", slug: "power-adapters", sortOrder: 3 },
  { name: "Power Banks", slug: "power-banks", sortOrder: 4 },
  { name: "Earphones & Headsets", slug: "earphones-headsets", sortOrder: 5 },
  { name: "Cases & Covers", slug: "cases-covers", sortOrder: 6 },
  { name: "Screen Guards", slug: "screen-guards", sortOrder: 7 },
  { name: "Car Accessories", slug: "car-accessories", sortOrder: 8 },
] as const;

type CategorySlug = (typeof categories)[number]["slug"];

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

interface SeedProduct {
  category: CategorySlug;
  name: string;
  sku: string;
  brand: string;
  description: string;
  specs: Record<string, string>;
  price: number; // paise
  mrp: number; // paise
  moq?: number;
  stockStatus?: StockStatus;
  status?: EntityStatus;
  tags?: string[];
  imageCount?: 1 | 2 | 3; // -> /seed/<category>-<n>.svg
  softDeleted?: boolean;
}

const products: SeedProduct[] = [
  // --- Chargers (9) ------------------------------------------------------
  { category: "chargers", name: "Ubon 20W PD Fast Charger", sku: "UB-CH-020", brand: "Ubon", description: "20W USB-C PD wall charger with over-current protection, ideal for iPhone and Android fast charging.", specs: { Output: "20W PD", Ports: "1x USB-C", Input: "100-240V AC", Warranty: "6 months" }, price: rs(165), mrp: rs(499), moq: 10, tags: ["fast-charging", "type-c"], imageCount: 3 },
  { category: "chargers", name: "ERD TC-50 Dual USB Charger 12W", sku: "ERD-CH-050", brand: "ERD", description: "BIS-certified dual USB wall charger, 2.4A shared output for phones and feature phones.", specs: { Output: "12W (2.4A)", Ports: "2x USB-A", Certification: "BIS", Warranty: "12 months" }, price: rs(92), mrp: rs(250), moq: 20, tags: ["dual-port"], imageCount: 2 },
  { category: "chargers", name: "Ambrane AWC-38 25W Super Fast Charger", sku: "AM-CH-025", brand: "Ambrane", description: "25W PPS super fast charger for Samsung and other PPS-enabled devices.", specs: { Output: "25W PPS", Ports: "1x USB-C", Protocols: "PD 3.0 / PPS", Warranty: "12 months" }, price: rs(240), mrp: rs(699), moq: 10, tags: ["fast-charging", "samsung"], imageCount: 3 },
  { category: "chargers", name: "Portronics Adapto 33W GaN Charger", sku: "PT-CH-033", brand: "Portronics", description: "Compact GaN charger with USB-C + USB-A dual output, 33W total.", specs: { Output: "33W", Ports: "USB-C + USB-A", Technology: "GaN", Warranty: "12 months" }, price: rs(385), mrp: rs(1099), moq: 5, tags: ["gan", "dual-port", "fast-charging"], imageCount: 2 },
  { category: "chargers", name: "Champ 2.4A Micro USB Charger Combo", sku: "CP-CH-024", brand: "Champ", description: "Budget 2.4A wall charger with detachable micro-USB cable, counter-pack of 1.", specs: { Output: "12W (2.4A)", Ports: "1x USB-A", Cable: "Micro USB, 1m included" }, price: rs(58), mrp: rs(199), moq: 50, stockStatus: StockStatus.LOW, imageCount: 1 },
  { category: "chargers", name: "Ubon CH-560 65W GaN Laptop Charger", sku: "UB-CH-065", brand: "Ubon", description: "65W GaN USB-C charger, powers laptops, tablets and phones from a single brick.", specs: { Output: "65W PD", Ports: "1x USB-C", Technology: "GaN II", Warranty: "12 months" }, price: rs(720), mrp: rs(1999), moq: 5, tags: ["gan", "laptop", "fast-charging"], imageCount: 3 },
  { category: "chargers", name: "Ronin R-940 18W QC 3.0 Charger", sku: "RN-CH-018", brand: "Ronin", description: "Quick Charge 3.0 single-port charger with fire-retardant shell.", specs: { Output: "18W QC 3.0", Ports: "1x USB-A", Material: "PC fire-retardant" }, price: rs(128), mrp: rs(399), moq: 20, stockStatus: StockStatus.OUT_OF_STOCK, imageCount: 2 },
  { category: "chargers", name: "Callmate Turbo 3.0A Charger", sku: "CM-CH-030", brand: "Callmate", description: "3.0A turbo charger, retail blister pack, fast-moving counter item.", specs: { Output: "15W (3.0A)", Ports: "1x USB-A" }, price: rs(75), mrp: rs(249), moq: 40, status: EntityStatus.INACTIVE, imageCount: 1 },
  { category: "chargers", name: "Hitage 45W Dual PD Charger", sku: "HT-CH-045", brand: "Hitage", description: "45W dual USB-C PD charger, splits 25W + 20W across two devices.", specs: { Output: "45W total", Ports: "2x USB-C", Protocols: "PD / PPS" }, price: rs(465), mrp: rs(1299), moq: 5, tags: ["dual-port", "fast-charging"], imageCount: 2, softDeleted: true },

  // --- Power Cables (8) --------------------------------------------------
  { category: "power-cables", name: "Ubon WR-680 Type-C Braided Cable 1.2m", sku: "UB-CB-680", brand: "Ubon", description: "Nylon-braided USB-A to Type-C cable, 3A rated, tangle-free.", specs: { Length: "1.2m", Connector: "USB-A to USB-C", Current: "3A", Material: "Nylon braided" }, price: rs(48), mrp: rs(199), moq: 50, tags: ["type-c", "braided"], imageCount: 3 },
  { category: "power-cables", name: "Ambrane ABCC-10 60W C-to-C Cable", sku: "AM-CB-010", brand: "Ambrane", description: "USB-C to USB-C 60W PD cable, e-marker chip, 1m.", specs: { Length: "1m", Connector: "USB-C to USB-C", Power: "60W PD", Data: "480 Mbps" }, price: rs(95), mrp: rs(299), moq: 25, tags: ["type-c", "pd"], imageCount: 2 },
  { category: "power-cables", name: "Portronics Konnect L 8-Pin Cable", sku: "PT-CB-008", brand: "Portronics", description: "USB-A to 8-pin lightning-compatible cable with aluminium shell connectors.", specs: { Length: "1.2m", Connector: "USB-A to 8-pin", Current: "2.4A" }, price: rs(110), mrp: rs(349), moq: 20, tags: ["iphone"], imageCount: 2 },
  { category: "power-cables", name: "ERD UC-40 Micro USB Cable 1m", sku: "ERD-CB-040", brand: "ERD", description: "Heavy-duty micro USB cable, 2.4A, bulk carton of loose-packed units.", specs: { Length: "1m", Connector: "USB-A to Micro USB", Current: "2.4A" }, price: rs(35), mrp: rs(149), moq: 100, imageCount: 1 },
  { category: "power-cables", name: "boAt A400 Type-C Stress-Tested Cable", sku: "BT-CB-400", brand: "boAt", description: "10000+ bend lifespan Type-C cable with retail hang-pack.", specs: { Length: "1.5m", Connector: "USB-A to USB-C", Current: "3A", Lifespan: "10000 bends" }, price: rs(145), mrp: rs(499), moq: 10, tags: ["type-c", "premium"], imageCount: 3 },
  { category: "power-cables", name: "Callmate 3-in-1 Charging Cable", sku: "CM-CB-301", brand: "Callmate", description: "Micro + Type-C + 8-pin heads on one cable, impulse-buy rack item.", specs: { Length: "1.2m", Connector: "3-in-1", Current: "2A" }, price: rs(72), mrp: rs(299), moq: 40, stockStatus: StockStatus.LOW, imageCount: 2 },
  { category: "power-cables", name: "Ubon WR-555 100W C-to-C Cable 2m", sku: "UB-CB-555", brand: "Ubon", description: "100W e-marked USB-C cable for laptops and fast-charge flagships, 2m.", specs: { Length: "2m", Connector: "USB-C to USB-C", Power: "100W PD", Material: "TPE" }, price: rs(190), mrp: rs(599), moq: 10, tags: ["pd", "laptop"], imageCount: 2 },
  { category: "power-cables", name: "Ronin Fast Micro Cable 2.4A", sku: "RN-CB-024", brand: "Ronin", description: "Value micro-USB cable for feature-phone belt, white PVC.", specs: { Length: "1m", Connector: "USB-A to Micro USB", Current: "2.4A" }, price: rs(38), mrp: rs(129), moq: 100, status: EntityStatus.INACTIVE, imageCount: 1 },

  // --- Power Adapters (7) ------------------------------------------------
  { category: "power-adapters", name: "ERD Universal Travel Adapter TA-105", sku: "ERD-AD-105", brand: "ERD", description: "Universal travel adapter with dual USB, works with EU/US/UK sockets.", specs: { Sockets: "EU/US/UK/AU", USB: "2x 2.4A", Rating: "6A max" }, price: rs(210), mrp: rs(599), moq: 10, tags: ["travel"], imageCount: 2 },
  { category: "power-adapters", name: "Portronics UFO Home Charging Station", sku: "PT-AD-090", brand: "Portronics", description: "6-in-1 desktop charging station: 4 USB ports + 2 universal AC sockets.", specs: { USB: "4x USB-A (6A shared)", AC: "2 universal sockets", Cord: "1.5m" }, price: rs(680), mrp: rs(1899), moq: 5, tags: ["desktop", "multi-port"], imageCount: 3 },
  { category: "power-adapters", name: "Ubon PA-110 USB Power Adapter 5V/2A", sku: "UB-AD-110", brand: "Ubon", description: "Plain 5V 2A USB adapter, OEM white box, high-volume mover.", specs: { Output: "5V / 2A", Ports: "1x USB-A" }, price: rs(52), mrp: rs(199), moq: 50, imageCount: 1 },
  { category: "power-adapters", name: "Ambrane Raap M11 Multi-Plug Adapter", sku: "AM-AD-011", brand: "Ambrane", description: "3-way plug expander with surge guard and 2 USB ports.", specs: { AC: "3 sockets", USB: "2x 2.4A", Surge: "Yes" }, price: rs(340), mrp: rs(999), moq: 10, stockStatus: StockStatus.LOW, tags: ["surge-protection"], imageCount: 2 },
  { category: "power-adapters", name: "Champ 5V/1A Adapter Bulk Pack", sku: "CP-AD-051", brand: "Champ", description: "Entry 5V 1A adapter, loose bulk packing for repair-shop channel.", specs: { Output: "5V / 1A", Ports: "1x USB-A" }, price: rs(36), mrp: rs(120), moq: 100, imageCount: 1 },
  { category: "power-adapters", name: "Hitage QC Adapter with Type-C Port", sku: "HT-AD-020", brand: "Hitage", description: "20W adapter with both USB-C PD and USB-A QC ports.", specs: { Output: "20W", Ports: "USB-C + USB-A", Protocols: "PD / QC 3.0" }, price: rs(255), mrp: rs(799), moq: 10, stockStatus: StockStatus.OUT_OF_STOCK, imageCount: 2 },
  { category: "power-adapters", name: "ERD Railway/Thick-Pin Adapter 10A", sku: "ERD-AD-010", brand: "ERD", description: "Thick-pin to thin-pin 10A conversion adapter, fire-retardant body.", specs: { Rating: "10A", Type: "3-pin conversion" }, price: rs(85), mrp: rs(249), moq: 30, imageCount: 1 },

  // --- Power Banks (8) ---------------------------------------------------
  { category: "power-banks", name: "Ambrane PP-121 10000mAh Power Bank", sku: "AM-PB-121", brand: "Ambrane", description: "Slim 10000mAh power bank, 12W output, dual USB with LED indicators.", specs: { Capacity: "10000mAh", Output: "12W", Ports: "2x USB-A + Micro/Type-C in", Warranty: "6 months" }, price: rs(610), mrp: rs(1499), moq: 5, tags: ["10000mah"], imageCount: 3 },
  { category: "power-banks", name: "Ubon PB-X20 20000mAh 22.5W Power Bank", sku: "UB-PB-020", brand: "Ubon", description: "20000mAh fast-charge power bank, 22.5W PD + QC, digital display.", specs: { Capacity: "20000mAh", Output: "22.5W PD/QC", Display: "LED digits", Warranty: "12 months" }, price: rs(1120), mrp: rs(2999), moq: 5, tags: ["20000mah", "fast-charging"], imageCount: 3 },
  { category: "power-banks", name: "boAt Energyshroom PB300 10000mAh", sku: "BT-PB-300", brand: "boAt", description: "10000mAh with 22.5W fast charging, smart IC protection.", specs: { Capacity: "10000mAh", Output: "22.5W", Ports: "USB-C + 2x USB-A", Warranty: "12 months" }, price: rs(880), mrp: rs(2490), moq: 5, tags: ["fast-charging", "premium"], imageCount: 2 },
  { category: "power-banks", name: "Portronics Luxcell B5 5000mAh Mini", sku: "PT-PB-005", brand: "Portronics", description: "Pocket 5000mAh power bank with built-in Type-C cable.", specs: { Capacity: "5000mAh", Output: "10W", Cable: "Built-in USB-C" }, price: rs(520), mrp: rs(1299), moq: 10, stockStatus: StockStatus.LOW, tags: ["compact"], imageCount: 2 },
  { category: "power-banks", name: "ERD PB-119 10000mAh Rugged Power Bank", sku: "ERD-PB-119", brand: "ERD", description: "Rugged-shell 10000mAh, BIS certified, made in India.", specs: { Capacity: "10000mAh", Output: "12W", Certification: "BIS", Origin: "India" }, price: rs(545), mrp: rs(1399), moq: 10, imageCount: 2 },
  { category: "power-banks", name: "Ambrane Stylo 20K 20000mAh PD", sku: "AM-PB-020", brand: "Ambrane", description: "20000mAh with 20W PD, triple output, quad input.", specs: { Capacity: "20000mAh", Output: "20W PD", Ports: "3 out / 2 in" }, price: rs(1050), mrp: rs(2799), moq: 5, stockStatus: StockStatus.OUT_OF_STOCK, tags: ["20000mah", "pd"], imageCount: 3 },
  { category: "power-banks", name: "Callmate Slim 10000mAh Power Bank", sku: "CM-PB-010", brand: "Callmate", description: "Value-segment slim 10000mAh, single USB output.", specs: { Capacity: "10000mAh", Output: "10W", Ports: "1x USB-A" }, price: rs(430), mrp: rs(1199), moq: 10, status: EntityStatus.INACTIVE, imageCount: 1 },
  { category: "power-banks", name: "Mivi Power Pack 27000mAh Laptop Bank", sku: "MV-PB-027", brand: "Mivi", description: "27000mAh 65W PD power bank capable of charging laptops.", specs: { Capacity: "27000mAh", Output: "65W PD", Ports: "2x USB-C + USB-A", Warranty: "12 months" }, price: rs(1800), mrp: rs(4999), moq: 3, tags: ["laptop", "pd", "premium"], imageCount: 3 },

  // --- Earphones & Headsets (9) -----------------------------------------
  { category: "earphones-headsets", name: "Ubon CL-120 Champ Wired Earphone", sku: "UB-EP-120", brand: "Ubon", description: "3.5mm wired earphone with mic, deep bass drivers, blister pack.", specs: { Driver: "10mm", Jack: "3.5mm", Mic: "Yes", Cable: "1.2m" }, price: rs(88), mrp: rs(299), moq: 20, tags: ["wired"], imageCount: 2 },
  { category: "earphones-headsets", name: "boAt Bassheads 100 Wired Earphone", sku: "BT-EP-100", brand: "boAt", description: "Iconic Bassheads 100 with 10mm drivers and in-line mic.", specs: { Driver: "10mm", Jack: "3.5mm", Mic: "Yes", Warranty: "12 months" }, price: rs(265), mrp: rs(999), moq: 10, tags: ["wired", "premium"], imageCount: 3 },
  { category: "earphones-headsets", name: "Mivi DuoPods A25 TWS Earbuds", sku: "MV-EP-025", brand: "Mivi", description: "TWS earbuds, 40-hour playtime, made in India, Type-C case.", specs: { Playtime: "40h with case", Bluetooth: "5.3", Charging: "USB-C", Origin: "India" }, price: rs(640), mrp: rs(1999), moq: 5, tags: ["tws", "bluetooth"], imageCount: 3 },
  { category: "earphones-headsets", name: "Ubon BT-5605 Wireless Neckband", sku: "UB-EP-560", brand: "Ubon", description: "Magnetic-bud neckband, 24h battery, dual pairing.", specs: { Playtime: "24h", Bluetooth: "5.2", Charging: "USB-C", Mic: "Yes" }, price: rs(385), mrp: rs(1299), moq: 10, tags: ["neckband", "bluetooth"], imageCount: 2 },
  { category: "earphones-headsets", name: "Ambrane Dots 38 TWS Earbuds", sku: "AM-EP-038", brand: "Ambrane", description: "Budget TWS with ENC mic and low-latency game mode.", specs: { Playtime: "30h with case", Bluetooth: "5.3", Mic: "ENC" }, price: rs(560), mrp: rs(1799), moq: 5, stockStatus: StockStatus.LOW, tags: ["tws"], imageCount: 2 },
  { category: "earphones-headsets", name: "Champ Bass King Wired Earphone", sku: "CP-EP-011", brand: "Champ", description: "Entry-level wired earphone, mixed-colour master carton.", specs: { Driver: "10mm", Jack: "3.5mm", Mic: "Yes" }, price: rs(42), mrp: rs(149), moq: 100, imageCount: 1 },
  { category: "earphones-headsets", name: "Portronics Muffs M3 BT Headphone", sku: "PT-EP-003", brand: "Portronics", description: "Over-ear Bluetooth headphone with 40mm drivers, AUX fallback.", specs: { Driver: "40mm", Playtime: "15h", Bluetooth: "5.0", AUX: "Yes" }, price: rs(720), mrp: rs(2499), moq: 5, tags: ["headphone", "bluetooth"], imageCount: 2 },
  { category: "earphones-headsets", name: "Hitage Sports Neckband NBT-9210", sku: "HT-EP-921", brand: "Hitage", description: "Sweat-resistant sports neckband, vibration call alert.", specs: { Playtime: "18h", Bluetooth: "5.0", Rating: "IPX4" }, price: rs(310), mrp: rs(999), moq: 10, stockStatus: StockStatus.OUT_OF_STOCK, imageCount: 2 },
  { category: "earphones-headsets", name: "Ronin Handsfree R-900 Wired", sku: "RN-EP-900", brand: "Ronin", description: "Legacy wired handsfree for feature phones, discontinued line.", specs: { Jack: "3.5mm", Mic: "Yes" }, price: rs(38), mrp: rs(120), moq: 100, status: EntityStatus.INACTIVE, imageCount: 1, softDeleted: true },

  // --- Cases & Covers (7) ------------------------------------------------
  { category: "cases-covers", name: "KGL Crystal Clear Case iPhone 15", sku: "KG-CS-015", brand: "KGL", description: "Transparent TPU back case with camera-lip protection for iPhone 15.", specs: { Model: "iPhone 15", Material: "Soft TPU", Thickness: "1.5mm" }, price: rs(65), mrp: rs(299), moq: 25, tags: ["iphone", "transparent"], imageCount: 2 },
  { category: "cases-covers", name: "Tigon Shockproof Cover Redmi Note 13", sku: "TG-CS-013", brand: "Tigon", description: "Military-grade corner-bumper case for Redmi Note 13 series.", specs: { Model: "Redmi Note 13", Material: "TPU + PC", Drop: "2m rated" }, price: rs(95), mrp: rs(399), moq: 20, tags: ["shockproof", "redmi"], imageCount: 3 },
  { category: "cases-covers", name: "KGL Matte Finish Case Galaxy A55", sku: "KG-CS-055", brand: "KGL", description: "Anti-fingerprint matte case for Samsung Galaxy A55.", specs: { Model: "Galaxy A55", Material: "Frosted PC", Finish: "Matte" }, price: rs(78), mrp: rs(349), moq: 20, tags: ["samsung"], imageCount: 2 },
  { category: "cases-covers", name: "Troops Leather Flip Cover Vivo Y200", sku: "TR-CS-200", brand: "Troops", description: "PU leather flip cover with card slot and stand for Vivo Y200.", specs: { Model: "Vivo Y200", Material: "PU leather", Features: "Card slot, stand" }, price: rs(140), mrp: rs(499), moq: 10, tags: ["flip-cover", "vivo"], imageCount: 2 },
  { category: "cases-covers", name: "Tigon Camera-Guard Case OnePlus 12R", sku: "TG-CS-012", brand: "Tigon", description: "Slide camera-shutter case for OnePlus 12R, ring-stand back.", specs: { Model: "OnePlus 12R", Material: "PC", Features: "Lens slider, ring stand" }, price: rs(125), mrp: rs(449), moq: 15, stockStatus: StockStatus.LOW, tags: ["oneplus"], imageCount: 3 },
  { category: "cases-covers", name: "KGL Silicone Case iPhone 14 Assorted", sku: "KG-CS-014", brand: "KGL", description: "Liquid-silicone feel cases for iPhone 14, assorted colour box of 10.", specs: { Model: "iPhone 14", Material: "Silicone", Pack: "Assorted colours" }, price: rs(90), mrp: rs(399), moq: 30, tags: ["iphone"], imageCount: 1 },
  { category: "cases-covers", name: "Troops Universal Flip 5.5\" Cover", sku: "TR-CS-055", brand: "Troops", description: "Universal sliding-camera flip cover for 5.5-inch phones, clearance stock.", specs: { Fit: "Universal 5.5 inch", Material: "PU leather" }, price: rs(60), mrp: rs(249), moq: 50, status: EntityStatus.INACTIVE, stockStatus: StockStatus.LOW, imageCount: 1 },

  // --- Screen Guards (6) --------------------------------------------------
  { category: "screen-guards", name: "Tigon 11D Tempered Glass Redmi 13C", sku: "TG-SG-013", brand: "Tigon", description: "Full-glue 11D edge-to-edge tempered glass for Redmi 13C, 10-pack sleeve.", specs: { Model: "Redmi 13C", Hardness: "9H", Type: "11D full glue" }, price: rs(45), mrp: rs(199), moq: 50, tags: ["redmi", "tempered-glass"], imageCount: 2 },
  { category: "screen-guards", name: "KGL Privacy Glass iPhone 15 Pro", sku: "KG-SG-015", brand: "KGL", description: "Anti-spy privacy tempered glass with installation frame for iPhone 15 Pro.", specs: { Model: "iPhone 15 Pro", Hardness: "9H", Type: "Privacy matte" }, price: rs(135), mrp: rs(599), moq: 20, tags: ["iphone", "privacy"], imageCount: 3 },
  { category: "screen-guards", name: "Tigon UV Curved Glass Galaxy S24 Ultra", sku: "TG-SG-024", brand: "Tigon", description: "UV-glue curved tempered glass with lamp kit for Galaxy S24 Ultra.", specs: { Model: "Galaxy S24 Ultra", Type: "UV curved", Kit: "UV lamp included" }, price: rs(180), mrp: rs(799), moq: 10, tags: ["samsung", "curved"], imageCount: 2 },
  { category: "screen-guards", name: "ERD Matte Hydrogel Sheet Universal", sku: "ERD-SG-001", brand: "ERD", description: "Cuttable matte hydrogel screen film, universal up to 6.9 inch.", specs: { Fit: "Universal 6.9 inch", Type: "Hydrogel matte", Pack: "5 sheets" }, price: rs(110), mrp: rs(449), moq: 20, imageCount: 1 },
  { category: "screen-guards", name: "Tigon Camera Lens Glass OnePlus 12", sku: "TG-SG-012", brand: "Tigon", description: "Metal-ring camera lens protectors for OnePlus 12, pack of 2 sets.", specs: { Model: "OnePlus 12", Type: "Lens protector", Pack: "2 sets" }, price: rs(55), mrp: rs(249), moq: 30, stockStatus: StockStatus.OUT_OF_STOCK, tags: ["oneplus", "lens"], imageCount: 2 },
  { category: "screen-guards", name: "KGL OG Glass Vivo Y-Series Combo", sku: "KG-SG-100", brand: "KGL", description: "OG-grade tempered glass mixed carton covering top 10 Vivo Y models.", specs: { Fit: "Vivo Y-series assorted", Hardness: "9H", Pack: "100 pcs carton" }, price: rs(38), mrp: rs(149), moq: 100, tags: ["vivo", "bulk"], imageCount: 1 },

  // --- Car Accessories (6) ------------------------------------------------
  { category: "car-accessories", name: "Portronics Clamp M3 Car Mobile Holder", sku: "PT-CA-003", brand: "Portronics", description: "Dashboard/windshield suction car mount with one-touch lock.", specs: { Mount: "Suction, dashboard", Fit: "4-7 inch phones", Rotation: "360°" }, price: rs(230), mrp: rs(699), moq: 10, tags: ["car-mount"], imageCount: 2 },
  { category: "car-accessories", name: "Ubon CC-115 38W Car Charger", sku: "UB-CA-115", brand: "Ubon", description: "Dual-port 38W car charger, PD + QC, zinc alloy body.", specs: { Output: "38W (PD 20W + QC 18W)", Ports: "USB-C + USB-A", Body: "Zinc alloy" }, price: rs(215), mrp: rs(699), moq: 10, tags: ["car-charger", "fast-charging"], imageCount: 3 },
  { category: "car-accessories", name: "Ambrane ACC-74 Bluetooth FM Transmitter", sku: "AM-CA-074", brand: "Ambrane", description: "FM transmitter with dual USB charging, BT calling and TF-card playback.", specs: { Bluetooth: "5.0", Charging: "2x USB", Playback: "FM / TF card / AUX" }, price: rs(410), mrp: rs(1299), moq: 5, tags: ["fm-transmitter"], imageCount: 2 },
  { category: "car-accessories", name: "Hitage Magnetic Vent Mount HP-560", sku: "HT-CA-560", brand: "Hitage", description: "Magnetic AC-vent phone holder with metal plates included.", specs: { Mount: "AC vent, magnetic", Plates: "2 included" }, price: rs(120), mrp: rs(399), moq: 20, stockStatus: StockStatus.LOW, imageCount: 1 },
  { category: "car-accessories", name: "ERD Car Charger 12W Twin USB", sku: "ERD-CA-012", brand: "ERD", description: "Reliable 12W twin-USB car charger with LED ring, BIS certified.", specs: { Output: "12W (2.4A)", Ports: "2x USB-A", Certification: "BIS" }, price: rs(95), mrp: rs(299), moq: 25, imageCount: 2 },
  { category: "car-accessories", name: "Portronics Vayu Car Vacuum Cleaner", sku: "PT-CA-020", brand: "Portronics", description: "Portable 12V car vacuum cleaner with HEPA filter and 3 nozzles.", specs: { Power: "12V, 60W", Filter: "HEPA", Accessories: "3 nozzles" }, price: rs(940), mrp: rs(2499), moq: 5, tags: ["car-care"], imageCount: 3 },
];

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

interface SeedCustomer {
  businessName: string;
  contactName: string;
  phone: string;
  email?: string;
  gstNumber?: string;
  city?: string;
  status: CustomerStatus;
  notes?: string;
  /** Days until the active grant expires (negative = already expired). */
  grantExpiryDays?: number | null; // null = no expiry
  lastLoginDaysAgo?: number;
}

const customers: SeedCustomer[] = [
  // APPROVED (5)
  { businessName: "Shree Balaji Mobile World", contactName: "Rakesh Gupta", phone: "9876543210", email: "balajimobiles@gmail.com", gstNumber: "07AABCS1234A1Z5", city: "Delhi", status: CustomerStatus.APPROVED, grantExpiryDays: 60, lastLoginDaysAgo: 1 },
  { businessName: "Mehta Telecom", contactName: "Jignesh Mehta", phone: "9823011224", email: "mehtatelecom@yahoo.in", gstNumber: "24AAHFM5678B1Z2", city: "Ahmedabad", status: CustomerStatus.APPROVED, grantExpiryDays: 3, notes: "Renewal reminder due — grant expires this week.", lastLoginDaysAgo: 2 },
  { businessName: "SK Mobile Accessories", contactName: "Salim Khan", phone: "9812345670", email: "skmobileacc@gmail.com", city: "Lucknow", status: CustomerStatus.APPROVED, grantExpiryDays: 90, lastLoginDaysAgo: 5 },
  { businessName: "Krishna Mobiles & Recharge", contactName: "Venkatesh Rao", phone: "9845098450", gstNumber: "29AAKCK9012C1Z8", city: "Bengaluru", status: CustomerStatus.APPROVED, grantExpiryDays: null, notes: "Long-standing buyer, no expiry on access.", lastLoginDaysAgo: 0 },
  { businessName: "City Care Mobile Point", contactName: "Amandeep Singh", phone: "9988776655", email: "citycaremobile@gmail.com", city: "Ludhiana", status: CustomerStatus.APPROVED, grantExpiryDays: 30, lastLoginDaysAgo: 9 },
  // PENDING (3)
  { businessName: "New Bombay Mobile Hub", contactName: "Prakash Jadhav", phone: "9820098200", email: "nbmhub@gmail.com", city: "Navi Mumbai", status: CustomerStatus.PENDING },
  { businessName: "Radhika Enterprises", contactName: "Radhika Sharma", phone: "9711223344", gstNumber: "09AAPFR3456D1Z1", city: "Noida", status: CustomerStatus.PENDING },
  { businessName: "Star Mobile Gallery", contactName: "Mohd. Faizan", phone: "9930112233", city: "Hyderabad", status: CustomerStatus.PENDING },
  // REJECTED (2)
  { businessName: "Quick Deals Trading", contactName: "Sunil Verma", phone: "9899887766", city: "Gurugram", status: CustomerStatus.REJECTED, notes: "Could not verify shop details on call." },
  { businessName: "AK Communications", contactName: "Arun Kumar", phone: "9765432109", email: "akcomms@rediffmail.com", city: "Patna", status: CustomerStatus.REJECTED, notes: "Retail buyer, not wholesale." },
  // EXPIRED (1)
  { businessName: "Ganesh Mobile Stores", contactName: "Ganesh Patil", phone: "9850012345", email: "ganeshmobilestores@gmail.com", gstNumber: "27AAGFG7890E1Z4", city: "Pune", status: CustomerStatus.EXPIRED, grantExpiryDays: -12, notes: "Access lapsed; follow up for renewal.", lastLoginDaysAgo: 20 },
  // BLOCKED (1)
  { businessName: "Royal Gadget Bazaar", contactName: "Imran Shaikh", phone: "9702233445", city: "Mumbai", status: CustomerStatus.BLOCKED, grantExpiryDays: 45, notes: "Blocked for sharing price screenshots publicly.", lastLoginDaysAgo: 30 },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Seeding MemoryDeals dev data...");

  // Hashing at cost 12 is slow (~250ms each); hash the two passwords once.
  const [adminHash, customerHash] = await Promise.all([
    bcrypt.hash("admin1234", 12),
    bcrypt.hash("customer1", 12),
  ]);

  // 1. Categories (upsert by slug)
  const categoryIdBySlug = new Map<string, string>();
  for (const c of categories) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      create: { name: c.name, slug: c.slug, sortOrder: c.sortOrder, image: `/seed/${c.slug}-1.svg`, status: EntityStatus.ACTIVE },
      update: { name: c.name, sortOrder: c.sortOrder, image: `/seed/${c.slug}-1.svg`, status: EntityStatus.ACTIVE },
    });
    categoryIdBySlug.set(c.slug, row.id);
  }

  // 2. Products (upsert by slug; sku kept in sync)
  const productIds: string[] = [];
  for (const p of products) {
    const categoryId = categoryIdBySlug.get(p.category);
    if (!categoryId) throw new Error(`Unknown category slug: ${p.category}`);

    const imageCount = p.imageCount ?? 1;
    const images = Array.from({ length: imageCount }, (_, i) => ({
      url: `/seed/${p.category}-${i + 1}.svg`,
      thumbUrl: `/seed/${p.category}-${i + 1}.svg`,
      sortOrder: i,
      isPrimary: i === 0,
    }));

    const data = {
      categoryId,
      name: p.name,
      sku: p.sku,
      brand: p.brand,
      description: p.description,
      specs: p.specs as Prisma.InputJsonValue,
      price: p.price,
      mrp: p.mrp,
      moq: p.moq ?? null,
      stockStatus: p.stockStatus ?? StockStatus.IN_STOCK,
      status: p.status ?? EntityStatus.ACTIVE,
      tags: p.tags ?? [],
      images,
      deletedAt: p.softDeleted ? daysAgo(7) : null,
    };

    const row = await prisma.product.upsert({
      where: { slug: slugify(p.name) },
      create: { slug: slugify(p.name), ...data },
      update: data,
    });
    productIds.push(row.id);
  }

  // 3. Admin (upsert by email)
  await prisma.admin.upsert({
    where: { email: "admin@memorydeals.test" },
    create: { email: "admin@memorydeals.test", passwordHash: adminHash, name: "Anchal", totpSecret: null },
    update: { passwordHash: adminHash, name: "Anchal", totpSecret: null },
  });

  // 4. Customers (upsert by phone)
  const customerIds: string[] = [];
  let grantCount = 0;
  let requestCount = 0;

  for (const c of customers) {
    const row = await prisma.customer.upsert({
      where: { phone: c.phone },
      create: {
        businessName: c.businessName,
        contactName: c.contactName,
        phone: c.phone,
        passwordHash: customerHash,
        email: c.email ?? null,
        gstNumber: c.gstNumber ?? null,
        city: c.city ?? null,
        status: c.status,
        notes: c.notes ?? null,
        lastLoginAt: c.lastLoginDaysAgo !== undefined ? daysAgo(c.lastLoginDaysAgo) : null,
      },
      update: {
        businessName: c.businessName,
        contactName: c.contactName,
        passwordHash: customerHash,
        email: c.email ?? null,
        gstNumber: c.gstNumber ?? null,
        city: c.city ?? null,
        status: c.status,
        notes: c.notes ?? null,
        lastLoginAt: c.lastLoginDaysAgo !== undefined ? daysAgo(c.lastLoginDaysAgo) : null,
      },
    });
    customerIds.push(row.id);

    // Requests + grants are replaced wholesale per seeded customer, which
    // keeps repeat runs idempotent without a natural unique key.
    await prisma.accessRequest.deleteMany({ where: { customerId: row.id } });
    await prisma.accessGrant.deleteMany({ where: { customerId: row.id } });

    const requestedAt = daysAgo(14);

    switch (c.status) {
      case CustomerStatus.PENDING:
        await prisma.accessRequest.create({
          data: { customerId: row.id, status: RequestStatus.PENDING, reason: "New wholesale account signup.", createdAt: daysAgo(2) },
        });
        requestCount++;
        break;

      case CustomerStatus.REJECTED:
        await prisma.accessRequest.create({
          data: { customerId: row.id, status: RequestStatus.REJECTED, reason: c.notes ?? "Verification failed.", createdAt: requestedAt, decidedAt: daysAgo(12) },
        });
        requestCount++;
        break;

      case CustomerStatus.APPROVED:
      case CustomerStatus.EXPIRED:
      case CustomerStatus.BLOCKED: {
        await prisma.accessRequest.create({
          data: { customerId: row.id, status: RequestStatus.APPROVED, reason: "Wholesale buyer verified on call.", createdAt: requestedAt, decidedAt: daysAgo(13) },
        });
        requestCount++;
        await prisma.accessGrant.create({
          data: {
            customerId: row.id,
            approvedAt: daysAgo(13),
            expiresAt: c.grantExpiryDays === null || c.grantExpiryDays === undefined ? null : daysFromNow(c.grantExpiryDays),
            revokedAt: c.status === CustomerStatus.BLOCKED ? daysAgo(4) : null,
            grantedBy: "admin@memorydeals.test",
          },
        });
        grantCount++;
        break;
      }
    }
  }

  // 5. PageViews — replaced for seeded products each run.
  await prisma.pageView.deleteMany({ where: { productId: { in: productIds } } });

  const approvedCustomerIds = customerIds.slice(0, 5); // first 5 seeds are APPROVED
  const pageViewData: Prisma.PageViewCreateManyInput[] = [];
  for (let i = 0; i < 18; i++) {
    pageViewData.push({
      productId: productIds[(i * 7) % productIds.length],
      // Mix of logged-in views and anonymous-ish views (no customer).
      customerId: i % 3 === 2 ? null : approvedCustomerIds[i % approvedCustomerIds.length],
      createdAt: daysAgo((i * 13) % 14),
    });
  }
  await prisma.pageView.createMany({ data: pageViewData });

  // 6. Summary
  const [categoryCount, productCount, activeProducts, softDeleted, adminCount, customerCount, pageViewCount] =
    await Promise.all([
      prisma.category.count(),
      prisma.product.count(),
      prisma.product.count({ where: { status: EntityStatus.ACTIVE, deletedAt: null } }),
      prisma.product.count({ where: { deletedAt: { not: null } } }),
      prisma.admin.count(),
      prisma.customer.count(),
      prisma.pageView.count(),
    ]);

  console.log("\nSeed complete:\n");
  console.table([
    { entity: "Categories", count: categoryCount },
    { entity: "Products (total)", count: productCount },
    { entity: "Products (active, not deleted)", count: activeProducts },
    { entity: "Products (soft-deleted)", count: softDeleted },
    { entity: "Admins", count: adminCount },
    { entity: "Customers", count: customerCount },
    { entity: "Access requests (seeded)", count: requestCount },
    { entity: "Access grants (seeded)", count: grantCount },
    { entity: "Page views", count: pageViewCount },
  ]);
  console.log('Admin login   : admin@memorydeals.test / "admin1234"');
  console.log('Customer login: any seeded phone / "customer1" (e.g. 9876543210, APPROVED)');
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
