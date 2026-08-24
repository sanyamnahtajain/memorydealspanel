import { z } from "zod";

import {
  findTopic,
  topicsFor,
  type NotifyAudience,
  type NotifyTopic,
} from "./topics";

/**
 * Notification preferences — stored per PERSON (not per device) as a small
 * JSON blob on the Customer / Admin row, and read defensively here.
 *
 * Shape on disk:
 *   { "v": 1, "muted": ["offers", ...] }
 *
 * We store the MUTED list rather than the enabled one on purpose: a topic
 * added in a later release is then ON for existing users by default (if that
 * is the topic's default), instead of silently missing from everyone's stored
 * map and arriving switched off.
 *
 * Every parse is total — malformed or hand-edited JSON degrades to "defaults"
 * rather than throwing into a page render.
 */

const storedPrefsSchema = z.object({
  v: z.literal(1).optional(),
  muted: z.array(z.string().max(64)).max(64).optional(),
});

export interface NotifyPrefs {
  /** Topic keys this person has switched off. */
  muted: ReadonlySet<string>;
}

export const EMPTY_PREFS: NotifyPrefs = { muted: new Set<string>() };

/** Parse the stored blob. Anything unexpected => defaults (nothing muted). */
export function parseNotifyPrefs(value: unknown): NotifyPrefs {
  if (value === null || value === undefined) return EMPTY_PREFS;

  const parsed = storedPrefsSchema.safeParse(value);
  if (!parsed.success) return EMPTY_PREFS;

  // Drop keys that no longer exist and any topic that cannot be muted, so a
  // stale stored value can never suppress an account-critical notice.
  const muted = (parsed.data.muted ?? []).filter((key) => {
    const topic = findTopic(key);
    return topic !== null && topic.lockedOn !== true;
  });

  return { muted: new Set(muted) };
}

/** Serialise for storage. Locked topics are never written as muted. */
export function serializeNotifyPrefs(prefs: NotifyPrefs): {
  v: 1;
  muted: string[];
} {
  const muted = [...prefs.muted].filter((key) => {
    const topic = findTopic(key);
    return topic !== null && topic.lockedOn !== true;
  });
  return { v: 1, muted: muted.sort() };
}

/**
 * Should this person receive this topic?
 *
 * Order of precedence: unknown topic => no; locked topic => always yes;
 * explicitly muted => no; otherwise the topic's own default.
 */
export function wantsTopic(prefs: NotifyPrefs, topicKey: string): boolean {
  const topic = findTopic(topicKey);
  if (!topic) return false;
  if (topic.lockedOn) return true;
  if (prefs.muted.has(topicKey)) return false;
  return topic.defaultOn;
}

/** A settings-UI row: the topic plus whether it is currently on. */
export interface NotifyTopicState {
  topic: NotifyTopic;
  enabled: boolean;
}

/** Every topic for an audience, with its current on/off state resolved. */
export function resolveTopicStates(
  audience: NotifyAudience,
  prefs: NotifyPrefs,
): NotifyTopicState[] {
  return topicsFor(audience).map((topic) => ({
    topic,
    enabled: wantsTopic(prefs, topic.key),
  }));
}

/** Apply one switch flip, returning the new preferences. */
export function toggleTopic(
  prefs: NotifyPrefs,
  topicKey: string,
  enabled: boolean,
): NotifyPrefs {
  const topic = findTopic(topicKey);
  // Unknown or locked topics are not user-controllable — no-op.
  if (!topic || topic.lockedOn) return prefs;

  const muted = new Set(prefs.muted);
  if (enabled) muted.delete(topicKey);
  else muted.add(topicKey);
  return { muted };
}
