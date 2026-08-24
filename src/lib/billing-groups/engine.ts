import {
  GENERAL_GROUP_CODE,
  GENERAL_GROUP_NAME,
  type AppliedTier,
  type BillingGroupConfig,
  type BillingGroupRule,
  type Bucket,
  type BucketableLine,
  type BucketedCart,
  type DiscountTier,
  type LineAllocation,
  type NextTierHint,
} from "./types";

/**
 * Billing-groups rule engine — PURE and deterministic (no DB, no Date), so it
 * runs identically for the live cart preview, at order placement (where the
 * result is frozen onto the order), in the admin "try it" preview, and in
 * tests. Given the cart lines and the ACTIVE group configs, it decides which
 * bucket each line lands in and what each bucket's tiered discount is.
 *
 * Money is integer paise throughout; the bucket discount is allocated to its
 * lines with the largest-remainder method so the line shares always sum to the
 * bucket discount exactly (no paisa is ever lost or invented).
 */

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/** Does `line` belong to `group`? (Tagged-union switch: extend per matcher kind.) */
export function lineMatchesGroup(line: BucketableLine, group: BillingGroupConfig): boolean {
  switch (group.matcher.kind) {
    case "brands":
      return line.brandId !== null && group.matcher.brandIds.includes(line.brandId);
    default:
      return false;
  }
}

/**
 * The group a line belongs to: the FIRST active group (by sortOrder, then
 * name) that matches — so an overlapping brand resolves deterministically to
 * the group the admin sorted first. `null` → the General bucket.
 */
export function resolveGroupForLine(
  line: BucketableLine,
  groups: BillingGroupConfig[],
): BillingGroupConfig | null {
  for (const group of orderedActive(groups)) {
    if (lineMatchesGroup(line, group)) return group;
  }
  return null;
}

function orderedActive(groups: BillingGroupConfig[]): BillingGroupConfig[] {
  return groups
    .filter((g) => g.active)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Tiers                                                               */
/* ------------------------------------------------------------------ */

/** Tiers sorted ascending by floor (defensive — the schema also enforces it). */
function sortedTiers(tiers: DiscountTier[]): DiscountTier[] {
  return tiers.slice().sort((a, b) => a.fromPaise - b.fromPaise);
}

/**
 * Which tier fires for `subtotalPaise`: the HIGHEST floor that is met
 * (>= is inclusive — exactly ₹25,000 hits a "from ₹25,000" tier). `null`
 * when the subtotal is below every floor.
 */
export function resolveTier(
  tiers: DiscountTier[],
  subtotalPaise: number,
): { applied: AppliedTier | null; next: NextTierHint | null } {
  let applied: AppliedTier | null = null;
  let next: NextTierHint | null = null;
  for (const tier of sortedTiers(tiers)) {
    if (subtotalPaise >= tier.fromPaise) {
      applied = { fromPaise: tier.fromPaise, percentBps: tier.percentBps };
    } else {
      next = {
        tier: { fromPaise: tier.fromPaise, percentBps: tier.percentBps },
        remainingPaise: tier.fromPaise - subtotalPaise,
      };
      break; // tiers are ascending — the first unmet floor is the next one
    }
  }
  // A "next" tier that isn't better than what already applies is no nudge.
  if (next && applied && next.tier.percentBps <= applied.percentBps) next = null;
  return { applied, next };
}

/** Integer-paise percentage with half-up rounding (bps = hundredths of a %). */
export function percentOfPaise(paise: number, percentBps: number): number {
  return Math.round((paise * percentBps) / 10_000);
}

/* ------------------------------------------------------------------ */
/* Allocation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Split `discountPaise` across `lines` in proportion to their totals using the
 * largest-remainder method: floors first, then hand the leftover paise to the
 * lines with the biggest fractional parts. Σ shares === discountPaise always;
 * no share ever exceeds its line total.
 */
export function allocateDiscount(
  lines: BucketableLine[],
  discountPaise: number,
): LineAllocation[] {
  const subtotal = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  if (discountPaise <= 0 || subtotal <= 0) {
    return lines.map((l) => ({
      key: l.key,
      lineTotalPaise: l.lineTotalPaise,
      discountPaise: 0,
      netPaise: l.lineTotalPaise,
    }));
  }
  const capped = Math.min(discountPaise, subtotal);
  const exact = lines.map((l) => (l.lineTotalPaise * capped) / subtotal);
  const floors = exact.map(Math.floor);
  let leftover = capped - floors.reduce((s, f) => s + f, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    if (floors[i] < lines[i].lineTotalPaise) {
      floors[i] += 1;
      leftover -= 1;
    }
  }
  return lines.map((l, i) => ({
    key: l.key,
    lineTotalPaise: l.lineTotalPaise,
    discountPaise: floors[i],
    netPaise: l.lineTotalPaise - floors[i],
  }));
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

/**
 * Run a group's rules on a bucket subtotal. Today there is one rule kind; the
 * switch is the extension point (flat-off, free shipping… add a case).
 * Multiple rules compose additively, capped at the subtotal.
 */
export function applyRules(
  rules: BillingGroupRule[],
  subtotalPaise: number,
): { discountPaise: number; appliedTier: AppliedTier | null; nextTier: NextTierHint | null } {
  let discountPaise = 0;
  let appliedTier: AppliedTier | null = null;
  let nextTier: NextTierHint | null = null;
  for (const rule of rules) {
    switch (rule.kind) {
      case "tieredPercent": {
        const { applied, next } = resolveTier(rule.tiers, subtotalPaise);
        if (applied) {
          discountPaise += percentOfPaise(subtotalPaise, applied.percentBps);
          appliedTier = applied;
        }
        if (next) nextTier = next;
        break;
      }
      default:
        break;
    }
  }
  return { discountPaise: Math.min(discountPaise, subtotalPaise), appliedTier, nextTier };
}

/* ------------------------------------------------------------------ */
/* Bucketing                                                           */
/* ------------------------------------------------------------------ */

/**
 * Split `lines` into buckets by the ACTIVE `groups` and apply each group's
 * rules. Buckets come back in group `sortOrder`, with General LAST; empty
 * buckets are omitted. With no active groups (or no matches) the result is a
 * single General bucket with zero discount — i.e. today's behaviour.
 */
export function bucketizeLines(
  lines: BucketableLine[],
  groups: BillingGroupConfig[],
): BucketedCart {
  const active = orderedActive(groups);
  const byGroup = new Map<string | null, BucketableLine[]>();
  for (const line of lines) {
    const group = resolveGroupForLine(line, active);
    const key = group?.id ?? null;
    const list = byGroup.get(key);
    if (list) list.push(line);
    else byGroup.set(key, [line]);
  }

  const buckets: Bucket[] = [];
  for (const group of active) {
    const groupLines = byGroup.get(group.id);
    if (!groupLines || groupLines.length === 0) continue;
    buckets.push(buildBucket(group, groupLines));
  }
  const general = byGroup.get(null);
  if (general && general.length > 0) buckets.push(buildBucket(null, general));

  const subtotalPaise = buckets.reduce((s, b) => s + b.subtotalPaise, 0);
  const groupDiscountPaise = buckets.reduce((s, b) => s + b.discountPaise, 0);
  return {
    buckets,
    subtotalPaise,
    groupDiscountPaise,
    netPaise: subtotalPaise - groupDiscountPaise,
    isSplit: buckets.length > 1,
  };
}

function buildBucket(group: BillingGroupConfig | null, lines: BucketableLine[]): Bucket {
  const subtotalPaise = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  const { discountPaise, appliedTier, nextTier } = group
    ? applyRules(group.rules, subtotalPaise)
    : { discountPaise: 0, appliedTier: null, nextTier: null };
  return {
    groupId: group?.id ?? null,
    code: group?.code ?? GENERAL_GROUP_CODE,
    name: group?.name ?? GENERAL_GROUP_NAME,
    color: group?.color ?? "slate",
    separateBill: group?.separateBill ?? false,
    couponStacking: group?.couponStacking ?? true,
    notes: group?.notes ?? null,
    lines: allocateDiscount(lines, discountPaise),
    subtotalPaise,
    discountPaise,
    appliedTier,
    nextTier,
    netPaise: subtotalPaise - discountPaise,
  };
}

/** "MD-A1B2" + "/DLR" → the bill sub-number printed on a bucket's page. */
export function bucketBillNumber(orderNumber: string, code: string): string {
  return `${orderNumber}/${code}`;
}
