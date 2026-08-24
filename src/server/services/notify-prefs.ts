import { prisma } from "@/server/db";

import {
  parseNotifyPrefs,
  resolveTopicStates,
  serializeNotifyPrefs,
  toggleTopic,
  type NotifyPrefs,
  type NotifyTopicState,
} from "@/lib/notify/prefs";
import type { NotifyAudience } from "@/lib/notify/topics";

/**
 * Read/write notification preferences for one person.
 *
 * Preferences live on the person's own row (`Customer.notifyPrefs` /
 * `Admin.notifyPrefs`) as a small JSON blob, so a buyer who mutes "offers" on
 * their phone is muted on their laptop too. Device-level facts (is push
 * allowed here, is the app installed here) stay in the browser — they are not
 * preferences, they are properties of the device.
 *
 * Every read is defensive: a malformed blob resolves to the topic defaults
 * rather than throwing into a page render.
 */

export type NotifyOwner =
  | { kind: "customer"; id: string }
  | { kind: "admin"; id: string };

function audienceOf(owner: NotifyOwner): NotifyAudience {
  return owner.kind === "customer" ? "customer" : "admin";
}

/** Current stored preferences, or the defaults when there are none. */
export async function getNotifyPrefs(owner: NotifyOwner): Promise<NotifyPrefs> {
  if (owner.kind === "customer") {
    const row = await prisma.customer.findUnique({
      where: { id: owner.id },
      select: { notifyPrefs: true },
    });
    return parseNotifyPrefs(row?.notifyPrefs ?? null);
  }
  const row = await prisma.admin.findUnique({
    where: { id: owner.id },
    select: { notifyPrefs: true },
  });
  return parseNotifyPrefs(row?.notifyPrefs ?? null);
}

/** The settings-screen rows: every topic for this audience, with its state. */
export async function getNotifyTopicStates(
  owner: NotifyOwner,
): Promise<NotifyTopicState[]> {
  const prefs = await getNotifyPrefs(owner);
  return resolveTopicStates(audienceOf(owner), prefs);
}

async function writePrefs(
  owner: NotifyOwner,
  prefs: NotifyPrefs,
): Promise<void> {
  const data = { notifyPrefs: serializeNotifyPrefs(prefs) };
  if (owner.kind === "customer") {
    await prisma.customer.update({ where: { id: owner.id }, data });
  } else {
    await prisma.admin.update({ where: { id: owner.id }, data });
  }
}

/**
 * Flip one topic switch and persist. Returns the resulting rows so the caller
 * can hand the UI a fresh, authoritative state instead of guessing.
 *
 * Read-modify-write on a single small document: two switches flipped in the
 * same instant could in principle race, but the loser is one switch on one
 * person's settings screen, and the UI re-renders from the returned state.
 * Locking a preference blob would cost more than it protects.
 */
export async function setTopicEnabled(
  owner: NotifyOwner,
  topicKey: string,
  enabled: boolean,
): Promise<NotifyTopicState[]> {
  const current = await getNotifyPrefs(owner);
  const next = toggleTopic(current, topicKey, enabled);
  await writePrefs(owner, next);
  return resolveTopicStates(audienceOf(owner), next);
}

/**
 * Turn every unlockable topic on or off in one go — the master switch on the
 * settings screen. Locked topics (an order the buyer placed, their access
 * ending) are unaffected by design.
 */
export async function setAllTopics(
  owner: NotifyOwner,
  enabled: boolean,
): Promise<NotifyTopicState[]> {
  const audience = audienceOf(owner);
  const current = await getNotifyPrefs(owner);
  let next = current;
  for (const { topic } of resolveTopicStates(audience, current)) {
    next = toggleTopic(next, topic.key, enabled);
  }
  await writePrefs(owner, next);
  return resolveTopicStates(audience, next);
}
