/**
 * Generate the spoken Memory Deals notification lines with ElevenLabs.
 *
 * RUN THIS YOURSELF, once, with your own key:
 *
 *   ELEVENLABS_API_KEY=... node scripts/generate-voice-lines.mjs
 *
 * The MP3s land in public/sounds/ and are committed like any other asset, so
 * the running app never calls ElevenLabs and never needs the key. Generation
 * is a build-time step, not a runtime dependency — that keeps the key out of
 * production entirely and means a notification can never be delayed by a
 * third-party API being slow or down.
 *
 * Idempotent: a line whose file already exists is skipped. Pass --force to
 * regenerate everything (e.g. after changing a voice or the wording).
 *
 *   ELEVENLABS_API_KEY=... node scripts/generate-voice-lines.mjs --force
 *
 * Each file is built as: opening chime → spoken line → closing chime, so the
 * asset is self-contained. Pass --no-chimes for speech only.
 *
 * Pick a different voice with ELEVENLABS_VOICE_ID. The default is a
 * multilingual voice that handles Devanagari; if the Hindi comes out with an
 * English accent, browse voices in the ElevenLabs dashboard and set that env
 * var to one tagged for Hindi.
 *
 * WHERE THESE ACTUALLY PLAY — read this before adding more lines. A push
 * notification drawn by the phone while the app is closed uses the phone's
 * own sound; no website can substitute a voice line there. These play when
 * the app is OPEN (see src/lib/notify/voice.ts). The text of a notification
 * is what reaches a locked phone, and that lives in src/lib/notify/copy.ts.
 *
 * THE OPENING AND CLOSING CHIMES ARE NOT IN THESE FILES. The app plays the
 * Memory Deals tune before the voice and a short sign-off after it
 * (src/lib/notify/voice.ts). Keeping the wrapper in the app rather than baked
 * into each MP3 means the chime can be retuned without paying to regenerate
 * eight files, and every line stays perfectly in sync with the tune the rest
 * of the app already uses.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "sounds");
const API = "https://api.elevenlabs.io/v1/text-to-speech";

// eleven_multilingual_v2 speaks Devanagari; the older monolingual models do not.
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";
/**
 * Voice presets. The owner asked for a SOFT voice with a warm, marketing
 * read — not the flat announcement voice. Pick one by name:
 *
 *   ELEVENLABS_VOICE=soft-female   (default)
 *   ELEVENLABS_VOICE=soft-male
 *
 * or paste any voice id from the ElevenLabs Voice Library:
 *
 *   ELEVENLABS_VOICE_ID=<id>
 *
 * These are stock voices present on every account. If the Hindi comes out
 * with an English accent, browse the library for a Hindi-native voice and
 * pass its id — the wording and everything else stays the same.
 */
const VOICE_PRESETS = {
  "soft-female": { id: "EXAVITQu4vr4xnSDxMaL", label: "soft female (Bella)" },
  "soft-male": { id: "ErXwobaYiN019PkySvjV", label: "soft male (Antoni)" },
};
const PRESET =
  VOICE_PRESETS[process.env.ELEVENLABS_VOICE ?? "soft-female"] ??
  VOICE_PRESETS["soft-female"];
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? PRESET.id;

/**
 * The lines. Hindi, because that is what these customers speak in the shop,
 * and each one opens with the brand so the listener knows who is talking
 * before they have picked up the phone.
 */
const LINES = [
  {
    file: "access-approved.mp3",
    text: "द मेमोरी डील्स। आपका एक्सेस अप्रूव हो गया है। अब आप सभी प्राइस देख सकते हैं।",
    note: "Customer: price access approved",
  },
  {
    file: "access-expiring.mp3",
    text: "द मेमोरी डील्स। आपका प्राइस एक्सेस जल्दी बंद होने वाला है। एक ऑर्डर करें और तीस दिन और पाएं।",
    note: "Customer: access ending soon",
  },
  {
    file: "access-expired.mp3",
    text: "द मेमोरी डील्स। आपके प्राइस बंद हो गए हैं। दोबारा चालू करने के लिए ऐप खोलें।",
    note: "Customer: access has lapsed",
  },
  {
    file: "order-placed.mp3",
    text: "द मेमोरी डील्स। आपका ऑर्डर मिल गया है। हम जल्दी कन्फर्म करेंगे।",
    note: "Customer: we received your order",
  },
  {
    file: "cart-reminder.mp3",
    text: "द मेमोरी डील्स। आपकी कार्ट में सामान रखा है। ऑर्डर करना न भूलें।",
    note: "Customer: items left in cart",
  },
  {
    file: "admin-new-order.mp3",
    text: "नया ऑर्डर आया है। द मेमोरी डील्स।",
    note: "Staff: a new order has arrived",
  },
  {
    file: "admin-new-request.mp3",
    text: "नई एक्सेस रिक्वेस्ट आई है। द मेमोरी डील्स।",
    note: "Staff: a new access request",
  },
  {
    file: "brand.mp3",
    text: "द मेमोरी डील्स। यू नीड इट, वी हैव इट।",
    note: "Brand sting — the slogan",
  },
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function generate(line, apiKey) {
  const response = await fetch(`${API}/${VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: line.text,
      model_id: MODEL_ID,
      voice_settings: {
        // A warm marketing read rather than a flat announcement: stability
        // loosened so the delivery has some lift, style raised so it carries
        // a little warmth — but not so far that it starts performing, which
        // reads as insincere on a message about someone's own order.
        stability: 0.45,
        similarity_boost: 0.85,
        style: 0.45,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs returned ${response.status} ${response.statusText}. ${detail.slice(0, 300)}`,
    );
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 1000) {
    throw new Error(`suspiciously small audio (${audio.length} bytes)`);
  }
  return audio;
}

/**
 * The opening and closing chimes, generated once and reused for every line.
 *
 * ElevenLabs' sound-generation endpoint makes these, so the whole audio asset
 * is self-contained: chime → spoken line → chime, in ONE mp3. The owner asked
 * for the sound to sit before and after the script, and baking it in means it
 * plays identically wherever the file is used, including anywhere the app's
 * own tune engine is not involved.
 *
 * If sound generation is unavailable on the account, we fall back to speech
 * only — a missing chime must never cost you the voice line.
 */
const SOUND_API = "https://api.elevenlabs.io/v1/sound-generation";

async function generateSound(prompt, seconds, apiKey) {
  const response = await fetch(SOUND_API, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: seconds,
      // Follow the prompt closely; we want a clean chime, not an improvisation.
      prompt_influence: 0.6,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

const OPEN_PROMPT =
  "a short soft pleasant notification chime, two gentle bell tones rising, " +
  "warm and clean, no music bed, no reverb tail";
const CLOSE_PROMPT =
  "a short soft notification end chime, one gentle bell tone falling, warm " +
  "and clean, fading out quickly";

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error(
      "[voice] ELEVENLABS_API_KEY is not set.\n" +
        "        Run: ELEVENLABS_API_KEY=... node scripts/generate-voice-lines.mjs",
    );
    process.exitCode = 1;
    return;
  }

  const force = process.argv.includes("--force");
  const noChimes = process.argv.includes("--no-chimes");
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[voice] voice: ${process.env.ELEVENLABS_VOICE_ID ?? PRESET.label}`);

  // Generate the two chimes once and reuse them for every line.
  let openChime = null;
  let closeChime = null;
  if (!noChimes) {
    try {
      openChime = await generateSound(OPEN_PROMPT, 1.2, apiKey);
      closeChime = await generateSound(CLOSE_PROMPT, 1.0, apiKey);
      await writeFile(join(OUT_DIR, "chime-open.mp3"), openChime);
      await writeFile(join(OUT_DIR, "chime-close.mp3"), closeChime);
      console.log("[voice] chimes generated (start + end)");
    } catch (error) {
      console.warn(
        `[voice] could not generate chimes (${error.message}) — ` +
          "continuing with speech only.",
      );
      openChime = null;
      closeChime = null;
    }
  }

  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const line of LINES) {
    const target = join(OUT_DIR, line.file);

    if (!force && (await exists(target))) {
      console.log(`[voice] skip   ${line.file} (already there)`);
      skipped += 1;
      continue;
    }

    try {
      const speech = await generate(line, apiKey);
      // chime → line → chime, in one file. MP3 is a frame stream, so joining
      // buffers of the same format plays back as one continuous track.
      const audio = Buffer.concat(
        [openChime, speech, closeChime].filter(Boolean),
      );
      await writeFile(target, audio);
      console.log(
        `[voice] wrote  ${line.file}  ${(audio.length / 1024).toFixed(0)}kB  — ${line.note}`,
      );
      written += 1;
    } catch (error) {
      // Keep going: one bad line should not cost you the whole batch.
      console.error(`[voice] FAILED ${line.file}: ${error.message}`);
      failed += 1;
    }
  }

  console.log(
    `\n[voice] done — ${written} written, ${skipped} skipped, ${failed} failed.`,
  );
  if (written > 0) {
    console.log("[voice] commit public/sounds/ so production serves them.");
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[voice] unexpected failure:", error);
  process.exitCode = 1;
});
