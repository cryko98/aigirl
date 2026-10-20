// Hang + szájszinkron adat.
//  - ElevenLabs (szerver, időbélyegekkel): valódi audio + szó-időzítés -> pontos lipsync
//  - Böngésző Web Speech API (kulcs nélkül): becsült szó-időzítés -> közelítő lipsync
export function createVoice({ avatar, onStart, onEnd }) {
  let enabled = localStorage.getItem("aura_voice") !== "off";
  let speaking = false;

  const isHu = text => /[áéíóöőúüű]/i.test(text) || /\b(egy|hogy|nem|vagy|csak|meg|azt|van)\b/i.test(text);

  function estimateTimings(text, rate = 1) {
    const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const wtimes = [], wdurations = [];
    let t = 120;
    for (const w of words) {
      const letters = w.replace(/[^\p{L}\p{N}]/gu, "").length || 1;
      const dur = (90 + letters * 68) / rate;
      wtimes.push(Math.round(t)); wdurations.push(Math.round(dur));
      t += dur + (/[.,!?…;:]$/.test(w) ? 260 : 55) / rate;
    }
    return { words, wtimes, wdurations };
  }

  function pickVoice(lang) {
    const voices = speechSynthesis.getVoices();
    const female = /female|woman|zira|samantha|karen|moira|tessa|fiona|victoria|aria|jenny|noemi|noémi/i;
    const byLang = voices.filter(v => v.lang.toLowerCase().startsWith(lang));
    return byLang.find(v => female.test(v.name)) || byLang[0] || voices.find(v => female.test(v.name)) || voices[0] || null;
  }

  async function speakServer(text, lang) {
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (r.status !== 200) return false;
    const data = await r.json();
    const bin = atob(data.audio);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ac = avatar.audioCtx;
    const audio = await ac.decodeAudioData(bytes.buffer);
    onStart();
    const total = avatar.speak({ audio, words: data.words, wtimes: data.wtimes, wdurations: data.wdurations, lang });
    await new Promise(res => setTimeout(res, total + 400));
    return true;
  }

  function speakBrowser(text, lang) {
    const timings = estimateTimings(text, 0.97);
    const total = timings.wtimes.at(-1) + timings.wdurations.at(-1);
    if (!("speechSynthesis" in window)) {
      onStart(); avatar.speak({ ...timings, lang });
      return new Promise(res => setTimeout(res, total + 300));
    }
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "hu" ? "hu-HU" : "en-US";
      u.rate = 0.97; u.pitch = 1.05;
      const v = pickVoice(lang); if (v) u.voice = v;
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      let started = false;
      const begin = () => { if (started) return; started = true; onStart(); avatar.speak({ ...timings, lang }); };
      u.onstart = begin;
      setTimeout(begin, 900); // ha a hangmotor nem jelez (nincs hang), a száj akkor is mozog
      u.onend = finish; u.onerror = finish;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      setTimeout(finish, total + 4000); // biztonsági háló
    });
  }

  return {
    get enabled() { return enabled; },
    get speaking() { return speaking; },
    toggle() { enabled = !enabled; localStorage.setItem("aura_voice", enabled ? "on" : "off"); if (!enabled) this.stop(); return enabled; },
    stop() { try { speechSynthesis.cancel(); } catch {} avatar.stopSpeaking(); speaking = false; },
    unlock() { try { avatar.audioCtx?.resume(); } catch {} },
    async speak(text) {
      if (!enabled || !text || !avatar.ready) return;
      this.stop();
      speaking = true;
      const lang = isHu(text) ? "hu" : "en";
      try {
        if (!(await speakServer(text, lang))) await speakBrowser(text, lang);
      } catch (e) {
        console.warn("[voice]", e);
        try { await speakBrowser(text, lang); } catch {}
      }
      speaking = false;
      avatar.stopSpeaking();
      onEnd();
    },
  };
}
