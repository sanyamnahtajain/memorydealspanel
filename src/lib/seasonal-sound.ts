/**
 * Sleigh bells, synthesised in the browser (Web Audio) — no downloaded
 * sound files, so nothing to license and nothing extra to load.
 *
 * Each bell strike is a handful of inharmonic sine partials (what makes a
 * small metal bell sound like a bell rather than a note) with a click-fast
 * attack and a short ring, plus a tiny burst of filtered noise for the
 * pellet rattling inside. A "jingle" is a shaken cluster of strikes that
 * swells and fades, the way a harness sounds as the team trots past.
 *
 * Polite by design:
 *  - browsers only allow sound after the visitor has tapped/typed something;
 *    until then `playSleighBells` simply returns false;
 *  - quiet (master gain ~0.12) and short (≈2s);
 *  - callers decide when (at most once per visit — see SantaParade/Splash),
 *    and the owner can switch sounds off (Settings → Seasonal look).
 */

type Ctor = new () => AudioContext;

let ctx: AudioContext | null = null;
let armed = false;

function ctor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const g = globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Try to bring audio up (works during/after a user gesture). */
function ensureContext(): AudioContext | null {
  const C = ctor();
  if (!C) return null;
  try {
    ctx = ctx ?? new C();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

/** Arm a once-only "first gesture wakes the audio" listener. */
export function armSeasonalAudio(): void {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const wake = () => {
    ensureContext();
  };
  window.addEventListener("pointerdown", wake, { passive: true, once: true });
  window.addEventListener("keydown", wake, { once: true });
}

export function seasonalAudioReady(): boolean {
  return ctx?.state === "running";
}

function strike(ac: AudioContext, out: AudioNode, at: number, pitch: number, level: number) {
  // Inharmonic partials of a small sleigh bell.
  const partials: [number, number, number][] = [
    [1, 1, 0.42],
    [1.53, 0.55, 0.3],
    [2.32, 0.35, 0.22],
    [3.1, 0.18, 0.15],
  ];
  for (const [ratio, amp, decay] of partials) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = pitch * ratio;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level * amp, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.02);
  }
  // The pellet's rattle: 25ms of band-passed noise.
  const len = Math.floor(ac.sampleRate * 0.025);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = pitch * 2;
  bp.Q.value = 6;
  const ng = ac.createGain();
  ng.gain.value = level * 0.5;
  noise.connect(bp).connect(ng).connect(out);
  noise.start(at);
}

/**
 * Play one ~2s jingle. Returns false (and plays nothing) when the browser
 * has not allowed sound yet.
 */
export function playSleighBells(): boolean {
  const ac = ensureContext();
  if (!ac || ac.state !== "running") return false;
  try {
    const master = ac.createGain();
    master.gain.value = 0.12;
    // A touch of brightness and stereo-free "air".
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    master.connect(hp).connect(ac.destination);

    const t0 = ac.currentTime + 0.05;
    const total = 1.9;
    const strikes = 26;
    for (let i = 0; i < strikes; i++) {
      // Shaken in pairs (the trot), with a little human jitter.
      const beat = Math.floor(i / 2) * (total / (strikes / 2));
      const at = t0 + beat + (i % 2) * 0.055 + Math.random() * 0.02;
      // Swell in, fade out.
      const env = Math.sin(Math.PI * Math.min(1, (at - t0) / total));
      const pitch = 2600 + Math.random() * 1500;
      strike(ac, master, at, pitch, 0.25 + env * 0.75);
    }
    return true;
  } catch {
    return false;
  }
}
