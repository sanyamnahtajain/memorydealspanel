/**
 * The Memory Deals notification sound — synthesised, never a file.
 *
 * WHY SYNTHESISE: shipping an .mp3 means another network request that a
 * service worker has to cache, a decode step, and a licence to keep track of.
 * WebAudio gives us the same notes for free, at any length, and it works
 * offline in the installed (standalone) app from the first run.
 *
 * THE BRAND MOTIF: both tunes open with the same four-note ascending hook
 * (D - F# - A - D). Staff and buyers hear different lengths of the SAME sound,
 * so "that's Memory Deals" is learnable in a week.
 *
 *   SHORT (~4.6s) — the motif, a warm answer phrase and a soft bloom that
 *   fades out. Buyers hear this, so it is friendly, never alarming.
 *
 *   LONG (~11.1s) — the motif again, but pushed: a call-and-response, the
 *   motif restated a fourth higher, an insistent two-note ring, a full climb
 *   and a bell that hangs in the air. This is the Zomato-style order alert
 *   that repeats until a staff member acts, and it has to cut through the
 *   noise of a busy shop.
 *
 * BROWSER AUTOPLAY POLICY: no audio may start before the person has touched
 * the page. Nothing here runs at import time — the AudioContext is created
 * lazily, `unlockAudio()` is safe to call from any gesture handler, and
 * `playTune()` returns false (rather than throwing) while sound is still
 * locked, so callers can show a "tap to enable sound" hint and retry.
 *
 * TIMING: every note is scheduled on the AudioContext clock
 * (ctx.currentTime + offset) so the music stays in time even when the main
 * thread is busy. setTimeout is used only to space out loop repeats.
 */

export type TuneKind = "short" | "long";

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

/** Equal-tempered frequencies (A4 = 440Hz) for the notes the tunes use. */
const D4 = 293.66;
const A4 = 440.0;
const D5 = 587.33;
const F5S = 739.99;
const G5 = 783.99;
const A5 = 880.0;
const B5 = 987.77;
const D6 = 1174.66;
const F6S = 1479.98;
const G6 = 1567.98;

/* ------------------------------------------------------------------ */
/* Voices — a stack of oscillators plus one ADSR shape                 */
/* ------------------------------------------------------------------ */

interface Partial {
  type: OscillatorType;
  /** Frequency multiplier against the note's pitch. */
  ratio: number;
  /** Share of the note's volume this oscillator carries. */
  level: number;
}

interface Voice {
  partials: readonly Partial[];
  /** Seconds from silence up to the note's peak. */
  attack: number;
  /** Seconds from the peak down to the sustain level. */
  decay: number;
  /** Fraction of the peak the note holds at. */
  sustain: number;
  /** Seconds of fade-out after the note's written length. */
  release: number;
}

type VoiceName = "soft" | "bright" | "bell" | "pad";

const VOICES: Record<VoiceName, Voice> = {
  /** Warm and rounded — the buyer-facing tune. */
  soft: {
    partials: [
      { type: "triangle", ratio: 1, level: 0.7 },
      { type: "sine", ratio: 2, level: 0.22 },
    ],
    attack: 0.015,
    decay: 0.09,
    sustain: 0.55,
    release: 0.35,
  },
  /** Same body with a little square on top so it carries across a shop. */
  bright: {
    partials: [
      { type: "triangle", ratio: 1, level: 0.62 },
      { type: "sine", ratio: 2, level: 0.24 },
      { type: "square", ratio: 3, level: 0.1 },
    ],
    attack: 0.008,
    decay: 0.06,
    sustain: 0.6,
    release: 0.22,
  },
  /** Inharmonic partials + a long tail: a struck bell rather than a beep. */
  bell: {
    partials: [
      { type: "sine", ratio: 1, level: 0.62 },
      { type: "sine", ratio: 2.76, level: 0.26 },
      { type: "sine", ratio: 5.4, level: 0.1 },
    ],
    attack: 0.004,
    decay: 0.3,
    sustain: 0.3,
    release: 0.9,
  },
  /** A quiet cushion underneath the melody — felt more than heard. */
  pad: {
    partials: [
      { type: "sine", ratio: 1, level: 0.72 },
      { type: "triangle", ratio: 2, level: 0.18 },
    ],
    attack: 0.25,
    decay: 0.3,
    sustain: 0.7,
    release: 0.6,
  },
};

/* ------------------------------------------------------------------ */
/* The score                                                           */
/* ------------------------------------------------------------------ */

interface Note {
  /** Pitch in Hz. */
  freq: number;
  /** Start offset in seconds from the top of the tune. */
  at: number;
  /** Written length in seconds, before the voice's release tail. */
  dur: number;
  /** Peak volume, 0-1, before the tune and master levels are applied. */
  gain: number;
  voice: VoiceName;
}

/** The four-note hook every Memory Deals sound opens with. */
const MOTIF = [D5, F5S, A5, D6] as const;

/** Lays the motif down at `start`, one note every `step` seconds. */
function motif(
  start: number,
  step: number,
  gain: number,
  voice: VoiceName,
  pitches: readonly number[] = MOTIF,
): Note[] {
  return pitches.map((freq, i) => ({
    freq,
    at: start + i * step,
    // The last note of the hook is held — that is what makes it a phrase.
    dur: i === pitches.length - 1 ? step * 3.5 : step * 1.8,
    gain: gain * (0.85 + i * 0.05),
    voice,
  }));
}

/** Friendly and finished: hook, answer, bloom. Nothing here nags. */
const SHORT_SCORE: readonly Note[] = [
  ...motif(0.0, 0.17, 0.62, "soft"),
  // Answer phrase — the line settles back down instead of climbing.
  { freq: B5, at: 1.2, dur: 0.3, gain: 0.5, voice: "soft" },
  { freq: A5, at: 1.48, dur: 0.3, gain: 0.5, voice: "soft" },
  { freq: F5S, at: 1.76, dur: 0.75, gain: 0.55, voice: "soft" },
  { freq: D4, at: 1.15, dur: 1.5, gain: 0.26, voice: "pad" },
  { freq: A4, at: 1.15, dur: 1.5, gain: 0.2, voice: "pad" },
  // Closing bloom — the home chord, left to ring away to nothing.
  { freq: D5, at: 2.7, dur: 0.9, gain: 0.3, voice: "bell" },
  { freq: F5S, at: 2.7, dur: 0.9, gain: 0.26, voice: "bell" },
  { freq: A5, at: 2.7, dur: 0.9, gain: 0.26, voice: "bell" },
  { freq: D6, at: 2.7, dur: 0.9, gain: 0.28, voice: "bell" },
  { freq: D4, at: 2.7, dur: 1.2, gain: 0.22, voice: "pad" },
];

/** The staff alert: same hook, then it refuses to be ignored. */
const LONG_SCORE: readonly Note[] = [
  // 1. The hook, stated plainly so it is recognisable.
  ...motif(0.0, 0.16, 0.6, "bright"),
  // 2. Call and response — two notes trading, picking up the pace.
  { freq: A5, at: 1.4, dur: 0.26, gain: 0.55, voice: "bright" },
  { freq: D6, at: 1.68, dur: 0.26, gain: 0.58, voice: "bright" },
  { freq: A5, at: 1.96, dur: 0.26, gain: 0.55, voice: "bright" },
  { freq: D6, at: 2.24, dur: 0.55, gain: 0.6, voice: "bright" },
  // 3. The hook again, a fourth higher: the same tune, more urgent.
  ...motif(3.0, 0.16, 0.62, "bright", [G5, B5, D6, G6]),
  // 4. The nag — a hard two-note ring, twice, over a low drone.
  { freq: D6, at: 4.4, dur: 0.22, gain: 0.6, voice: "bright" },
  { freq: A5, at: 4.68, dur: 0.22, gain: 0.6, voice: "bright" },
  { freq: D6, at: 4.96, dur: 0.22, gain: 0.6, voice: "bright" },
  { freq: A5, at: 5.24, dur: 0.22, gain: 0.6, voice: "bright" },
  { freq: D6, at: 5.8, dur: 0.22, gain: 0.62, voice: "bright" },
  { freq: A5, at: 6.08, dur: 0.22, gain: 0.62, voice: "bright" },
  { freq: D6, at: 6.36, dur: 0.22, gain: 0.62, voice: "bright" },
  { freq: A5, at: 6.64, dur: 0.3, gain: 0.62, voice: "bright" },
  { freq: D4, at: 4.3, dur: 2.6, gain: 0.18, voice: "pad" },
  // 5. One fast climb straight up out of the nag.
  { freq: D5, at: 7.1, dur: 0.22, gain: 0.52, voice: "bright" },
  { freq: F5S, at: 7.25, dur: 0.22, gain: 0.54, voice: "bright" },
  { freq: A5, at: 7.4, dur: 0.22, gain: 0.56, voice: "bright" },
  { freq: D6, at: 7.55, dur: 0.22, gain: 0.58, voice: "bright" },
  { freq: F6S, at: 7.7, dur: 0.45, gain: 0.6, voice: "bright" },
  // 6. A struck bell, struck again, hanging over the room.
  { freq: D5, at: 8.3, dur: 1.0, gain: 0.3, voice: "bell" },
  { freq: A5, at: 8.3, dur: 1.0, gain: 0.28, voice: "bell" },
  { freq: D6, at: 8.3, dur: 1.2, gain: 0.3, voice: "bell" },
  { freq: D6, at: 9.1, dur: 1.0, gain: 0.28, voice: "bell" },
  { freq: A5, at: 9.1, dur: 1.0, gain: 0.26, voice: "bell" },
  { freq: D4, at: 8.3, dur: 1.8, gain: 0.15, voice: "pad" },
];

const SCORES: Record<TuneKind, readonly Note[]> = {
  short: SHORT_SCORE,
  long: LONG_SCORE,
};

/** Overall output level. Every note volume above is relative to this. */
const MASTER_LEVEL = 0.9;

/** Per-tune level: the buyer's sound is deliberately gentler than the staff's. */
const TUNE_LEVEL: Record<TuneKind, number> = { short: 0.5, long: 0.95 };

/**
 * A hair of lead-in before the first note. Scheduling exactly at
 * `currentTime` can land in the past by the time the audio thread sees it,
 * which clips the attack.
 */
const LEAD_IN = 0.06;

/** When a note finally falls silent, relative to the top of the tune. */
function noteEnd(n: Note): number {
  const voice = VOICES[n.voice];
  return n.at + Math.max(n.dur, voice.attack + voice.decay) + voice.release;
}

function scoreLength(score: readonly Note[]): number {
  return score.reduce((longest, n) => Math.max(longest, noteEnd(n)), 0);
}

/**
 * How long each tune runs, in milliseconds — derived from the score itself so
 * it can never drift out of step with the music. Callers use it to time loop
 * repeats and to clear a "playing" state in the UI.
 */
export const TUNE_DURATION_MS: Record<TuneKind, number> = {
  short: Math.ceil((LEAD_IN + scoreLength(SHORT_SCORE)) * 1000),
  long: Math.ceil((LEAD_IN + scoreLength(LONG_SCORE)) * 1000),
};

/* ------------------------------------------------------------------ */
/* Audio context — created lazily, unlocked by a gesture               */
/* ------------------------------------------------------------------ */

type AudioContextCtor = new () => AudioContext;

let ctxRef: AudioContext | null = null;
let masterRef: GainNode | null = null;
let listenersInstalled = false;

function audioContextCtor(): AudioContextCtor | null {
  // No window means no DOM (server render, or a test runner in node).
  if (typeof window === "undefined") return null;
  const g = globalThis as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  // webkitAudioContext keeps older iOS Safari working.
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/**
 * Bring audio up, or nudge a suspended context back to life. Safe to call at
 * any time, but browsers only really let it through during or after a user
 * gesture — so call it from a click / tap / key handler.
 *
 * Returns whether sound can play RIGHT NOW.
 */
export function unlockAudio(): boolean {
  const Ctor = audioContextCtor();
  if (!Ctor) return false;
  try {
    ctxRef = ctxRef ?? new Ctor();
    if (ctxRef.state === "suspended") {
      // Rejects when there has been no gesture yet; that is expected, and the
      // next gesture will try again.
      void ctxRef.resume().catch(() => undefined);
    }
    return ctxRef.state === "running";
  } catch {
    return false;
  }
}

/** Whether a tune would be heard if we played one this instant. */
export function isAudioReady(): boolean {
  return ctxRef?.state === "running";
}

/**
 * Arm a one-time, app-wide "first gesture unlocks sound" handler. Idempotent:
 * call it from as many components as you like, the listeners attach once.
 */
export function installAudioUnlockListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  const unlock = () => {
    unlockAudio();
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchend", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

function master(ctx: AudioContext): GainNode {
  if (!masterRef) {
    masterRef = ctx.createGain();
    masterRef.gain.value = MASTER_LEVEL;
    masterRef.connect(ctx.destination);
  }
  return masterRef;
}

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

interface Playback {
  bus: GainNode;
  oscillators: OscillatorNode[];
  /** Context time this playback goes quiet on its own. */
  endsAt: number;
}

let playing: Playback[] = [];
/** Bumped on every stop / restart so stale loop timers know to give up. */
let loopToken = 0;
let loopTimer: ReturnType<typeof setTimeout> | null = null;

/** Gap between loop repeats — a breath, so the nag does not become a drone. */
const LOOP_GAP_MS = 700;
/** How soon to try again after a repeat that made no sound (locked or muted). */
const RETRY_MS = 1_600;

/**
 * Schedules one note. The gain always starts AND finishes at a true zero, so
 * notes never click on the way in or out.
 */
function scheduleNote(
  ctx: AudioContext,
  dest: AudioNode,
  n: Note,
  t0: number,
  sink: OscillatorNode[],
): void {
  const voice = VOICES[n.voice];
  const at = t0 + n.at;
  // A note shorter than its own attack + decay would invert the envelope.
  const held = Math.max(n.dur, voice.attack + voice.decay);
  const holdEnd = at + held;
  const releaseEnd = holdEnd + voice.release;

  for (const p of voice.partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = p.type;
    osc.frequency.setValueAtTime(n.freq * p.ratio, at);

    const peak = n.gain * p.level;
    // exponentialRampToValueAtTime cannot touch zero, hence the small floor.
    const sustained = Math.max(peak * voice.sustain, 0.0002);
    const g = gain.gain;
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(peak, at + voice.attack);
    g.linearRampToValueAtTime(sustained, at + voice.attack + voice.decay);
    g.setValueAtTime(sustained, holdEnd);
    g.exponentialRampToValueAtTime(0.0001, releaseEnd);
    g.linearRampToValueAtTime(0, releaseEnd + 0.015);

    osc.connect(gain).connect(dest);
    osc.start(at);
    osc.stop(releaseEnd + 0.03);
    sink.push(osc);
  }
}

/** Drop playbacks that have already finished so the list cannot grow forever. */
function prune(now: number): void {
  playing = playing.filter((p) => {
    if (p.endsAt > now) return true;
    try {
      p.bus.disconnect();
    } catch {
      /* already gone */
    }
    return false;
  });
}

/**
 * Play a tune once. Returns false — never throws — when audio is locked or
 * unsupported, so the caller can show a hint and try again later.
 */
export function playTune(kind: TuneKind): boolean {
  if (!unlockAudio() || !ctxRef) return false;
  const ctx = ctxRef;
  try {
    const now = ctx.currentTime;
    prune(now);

    const bus = ctx.createGain();
    bus.gain.value = TUNE_LEVEL[kind];
    bus.connect(master(ctx));

    const t0 = now + LEAD_IN;
    const oscillators: OscillatorNode[] = [];
    for (const n of SCORES[kind]) scheduleNote(ctx, bus, n, t0, oscillators);

    playing.push({
      bus,
      oscillators,
      endsAt: t0 + scoreLength(SCORES[kind]) + 0.1,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * A ~0.4s two-note confirmation — the first two notes of the brand hook.
 *
 * For UI acknowledgements ("sound is back on") where playing a full 4.5s
 * tune would be an annoyance rather than feedback. Deliberately separate
 * from the tunes so the settings toggle can never be mistaken for an alert.
 */
export function playBlip(): boolean {
  if (!unlockAudio() || !ctxRef) return false;
  const ctx = ctxRef;
  try {
    const now = ctx.currentTime;
    prune(now);

    const bus = ctx.createGain();
    bus.gain.value = 0.45;
    bus.connect(master(ctx));

    const blip: Note[] = [
      { freq: MOTIF[0], at: 0, dur: 0.12, gain: 0.7, voice: "soft" },
      { freq: MOTIF[2], at: 0.13, dur: 0.16, gain: 0.7, voice: "soft" },
    ];

    const t0 = now + LEAD_IN;
    const oscillators: OscillatorNode[] = [];
    for (const n of blip) scheduleNote(ctx, bus, n, t0, oscillators);

    playing.push({ bus, oscillators, endsAt: t0 + scoreLength(blip) + 0.1 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Silence everything: stops the loop and cuts any notes still sounding.
 * Safe to call when nothing is playing.
 */
export function stopTune(): void {
  loopToken += 1;
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  const stopping = playing;
  playing = [];
  const now = ctxRef?.currentTime ?? 0;

  for (const p of stopping) {
    try {
      // Fade the whole tune out over 30ms rather than chopping it — a hard
      // cut on a sounding oscillator is an audible click.
      p.bus.gain.cancelScheduledValues(now);
      p.bus.gain.setValueAtTime(Math.max(p.bus.gain.value, 0.0001), now);
      p.bus.gain.linearRampToValueAtTime(0, now + 0.03);
    } catch {
      /* context already closed */
    }
    for (const osc of p.oscillators) {
      try {
        osc.stop(now + 0.04);
      } catch {
        /* never started, or already stopped */
      }
    }
  }
}

export interface LoopOptions {
  /**
   * Checked before every repeat; return false to skip this one (the caller's
   * mute setting, say). A skipped repeat retries again shortly after.
   */
  shouldPlay?: () => boolean;
  /** Called after every repeat with whether sound actually came out. */
  onRepeat?: (audible: boolean) => void;
}

/**
 * Repeat a tune until `stopTune()` is called — the "someone has to deal with
 * this" alert.
 *
 * A repeat that could not sound (audio still locked behind a gesture, or the
 * caller muted) is retried on a short timer instead of the full tune length,
 * so the very next repeat after the person taps the screen is audible.
 */
export function startLoopingTune(kind: TuneKind, options: LoopOptions = {}): void {
  stopTune();
  const token = loopToken;

  const repeat = () => {
    if (token !== loopToken) return;
    const allowed = options.shouldPlay?.() ?? true;
    const audible = allowed && playTune(kind);
    options.onRepeat?.(audible);
    if (token !== loopToken) return; // onRepeat may have stopped us
    loopTimer = setTimeout(
      repeat,
      audible ? TUNE_DURATION_MS[kind] + LOOP_GAP_MS : RETRY_MS,
    );
  };

  repeat();
}
