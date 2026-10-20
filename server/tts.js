// Hang: ElevenLabs időbélyeges TTS -> { audio(base64 mp3), words, wtimes, wdurations }.
// Kulcs nélkül null-t ad, a kliens a böngésző beépített TTS-ét használja.
import { config } from "./config.js";

export const ttsMode = () => (config.elevenKey && config.elevenVoice ? "elevenlabs" : "browser");

export async function synthesize(text) {
  if (ttsMode() !== "elevenlabs") return null;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenVoice}/with-timestamps?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": config.elevenKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: config.elevenModel,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const al = data.alignment || data.normalized_alignment;
  const { words, wtimes, wdurations } = alignmentToWords(al);
  return { audio: data.audio_base64, words, wtimes, wdurations };
}

// Karakter-szintű időzítésből szó-szintű (ms)
function alignmentToWords(al) {
  const words = [], wtimes = [], wdurations = [];
  if (!al) return { words, wtimes, wdurations };
  const chars = al.characters, st = al.character_start_times_seconds, en = al.character_end_times_seconds;
  let cur = "", start = null, end = null;
  const flush = () => {
    if (cur) { words.push(cur); wtimes.push(Math.round(start * 1000)); wdurations.push(Math.round((end - start) * 1000)); }
    cur = ""; start = null; end = null;
  };
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) { flush(); continue; }
    if (start === null) start = st[i];
    end = en[i]; cur += chars[i];
  }
  flush();
  return { words, wtimes, wdurations };
}
