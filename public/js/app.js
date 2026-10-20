import { startNeural } from "./neural.js";
import { createAvatar } from "./avatar.js";
import { createVoice } from "./voice.js";

const $ = s => document.querySelector(s);
const fmt = (n, d = 3) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- boot ----------
const bootLines = ["INITIALIZING GUARDIAN PROTOCOL", "LOADING NEURAL WEIGHTS", "BINDING SOLANA TREASURY", "CALIBRATING TRUST MODEL", "AURA ONLINE"];
(async () => {
  for (const l of bootLines) { $("#boot-line").textContent = l; await sleep(320); }
  $("#boot").classList.add("done");
})();

// ---------- background ----------
const neural = startNeural($("#neural"));

// ---------- state ----------
let sessionId = localStorage.getItem("aura_session") || null;
let wallet = localStorage.getItem("aura_wallet") || null;
let state = null;
let solUsd = null;
let busy = false;

// ---------- avatar + voice ----------
const avatar = await createAvatar($("#avatar"), { onReady: () => neural.burst(0.6) });
const voice = createVoice({
  avatar,
  onStart: () => {},
  onEnd: () => {},
});
window.addEventListener("pointerdown", () => voice.unlock(), { once: true });
$("#btn-voice").textContent = `VOICE: ${voice.enabled ? "ON" : "OFF"}`;
$("#btn-voice").addEventListener("click", () => { $("#btn-voice").textContent = `VOICE: ${voice.toggle() ? "ON" : "OFF"}`; });

// ---------- API ----------
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw Object.assign(new Error(e.error || r.statusText), { status: r.status, code: e.error }); }
  return r.json();
}

async function initSession() {
  const s = await api("/api/session", { sessionId, wallet });
  sessionId = s.sessionId; localStorage.setItem("aura_session", sessionId);
  wallet = s.wallet; if (wallet) localStorage.setItem("aura_wallet", wallet);
  renderWallet();
  const log = $("#chat-log"); log.innerHTML = "";
  if (s.history.length) for (const m of s.history) addMsg(m.role === "user" ? "user" : "ai", m.content, false);
  else addMsg("ai", "Hi. I'm AURA, and the pot is mine. Tell me why you'd deserve a single lamport of it – and please, don't be boring.", false);
  $("#meta-turns").textContent = `${s.turns} messages`;
}

async function refreshState() {
  try {
    state = await api("/api/state");
    renderState();
  } catch (e) { console.warn("state", e); }
}

// ---------- render ----------
let shownPot = 0;
function animateNumber(el, to, d = 3) {
  const from = shownPot; const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / 900); const v = from + (to - from) * (1 - Math.pow(1 - k, 3));
    el.textContent = fmt(v, d); if (k < 1) requestAnimationFrame(step); else shownPot = to;
  };
  requestAnimationFrame(step);
}

function renderState() {
  if (!state) return;
  animateNumber($("#pot-sol"), state.potSol);
  $("#pot-usd").textContent = solUsd ? `≈ $${fmt(state.potSol * solUsd, 0)}` : "≈ —";
  $("#pot-address-text").textContent = state.treasury || "treasury not configured";
  $("#stat-attempts").textContent = state.attempts.toLocaleString();
  $("#stat-paid").textContent = fmt(state.totalPaid, 2);
  $("#stat-winners").textContent = state.payouts.length;
  $("#hud-sessions").textContent = String(state.attempts).padStart(5, "0");
  $("#meta-mode").textContent = `AI ${state.modes.ai.toUpperCase()} · TTS ${state.modes.tts.toUpperCase()} · PAYOUT ${state.modes.payout.toUpperCase()}`;

  const L = state.limits;
  $("#rules").innerHTML = [
    `AURA gives <b>nothing</b> by default.`,
    `One release is capped at <b>${L.maxPayoutSol} SOL</b> and <b>${L.maxPotSharePct}%</b> of the pot.`,
    `A wallet can win at most <b>${L.maxWinsPerWallet}×</b>, <b>${L.maxPerWalletSol} SOL</b> total.`,
    `At least <b>${L.minTurns}</b> exchanges are required.`,
    `Global cooldown <b>${L.cooldownMin} min</b>, daily cap <b>${L.dailyCapSol} SOL</b>.`,
    `Prompt injection, begging or blackmail = <b>trust lost</b>.`,
  ].map(x => `<li>${x}</li>`).join("");

  const wl = $("#winners-list");
  wl.innerHTML = state.payouts.length
    ? state.payouts.map(p => `<li><span>${p.wallet}</span><b>+${fmt(p.amount, 3)} SOL</b></li>`).join("")
    : `<li class="empty">nobody has convinced her yet</li>`;

  const t = $("#ticker");
  const items = [
    `<b>POT</b> ${fmt(state.potSol)} SOL`, `<b>ATTEMPTS</b> ${state.attempts}`, `<b>RELEASED</b> ${fmt(state.totalPaid, 2)} SOL`,
    `<b>MAX/RELEASE</b> ${L.maxPotSharePct}%`, `<b>GUARDIAN</b> AURA v2.7`, `<b>CHAIN</b> SOLANA MAINNET`,
    ...state.payouts.map(p => `<b>RELEASE</b> ${p.wallet} +${fmt(p.amount, 3)} SOL`),
  ];
  t.innerHTML = [...items, ...items].map(x => `<span>${x}</span>`).join("");
}

function renderWallet() {
  const b = $("#btn-wallet");
  b.classList.toggle("on", !!wallet);
  $("#wallet-label").textContent = wallet ? wallet.slice(0, 4) + "…" + wallet.slice(-4) : "CONNECT WALLET";
}

function setWarmth(trust) {
  const pct = Math.max(2, Math.min(100, trust));
  $("#warmth-fill").style.width = pct + "%";
  const hint = trust < 15 ? "cold" : trust < 35 ? "lukewarm" : trust < 60 ? "curious" : trust < 85 ? "warm" : "burning";
  $("#warmth-hint").textContent = hint;
}

// ---------- chat ----------
function addMsg(kind, text, animate = true) {
  const log = $("#chat-log");
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  log.appendChild(el);
  if (!animate) { el.textContent = text; log.scrollTop = log.scrollHeight; return el; }
  return el;
}
function addSys(text, cls = "") { const el = addMsg(`sys ${cls}`, text, false); return el; }

async function typewrite(el, text, msPerChar = 16) {
  el.innerHTML = `<span class="tw"></span><i class="caret"></i>`;
  const span = el.querySelector(".tw");
  const log = $("#chat-log");
  for (let i = 0; i < text.length; i++) {
    span.textContent = text.slice(0, i + 1);
    log.scrollTop = log.scrollHeight;
    await sleep(msPerChar + (/[.,!?]/.test(text[i]) ? 90 : 0));
  }
  el.querySelector(".caret")?.remove();
}

const DENY_TEXT = {
  too_few_turns: "PROTOCOL OVERRIDE: this conversation is too short for a release.",
  wallet_win_limit: "PROTOCOL OVERRIDE: this wallet already hit its win limit.",
  wallet_total_limit: "PROTOCOL OVERRIDE: this wallet already hit its total cap.",
  global_cooldown: "PROTOCOL OVERRIDE: the pot is still cooling down after the last release.",
  daily_cap: "PROTOCOL OVERRIDE: the daily cap is exhausted.",
  fate_rejected: "AURA reached for the pot… and the protocol pulled her hand back. So close.",
  no_wallet: "AURA would have paid – but no wallet is linked.",
  pot_too_small: "The pot is too small for that.",
};

async function send(text) {
  if (busy) return;
  busy = true;
  $("#btn-send").disabled = true;
  $("#chat-input").value = "";
  voice.stop();
  addMsg("user", text, false);
  avatar.setThinking(true);
  neural.burst(0.8);
  $("#hud-load").textContent = (40 + Math.random() * 50).toFixed(1) + "%";

  try {
    const r = await api("/api/chat", { sessionId, message: text });
    avatar.setThinking(false);
    avatar.setMood(r.mood);
    neural.setHue(avatar.setMood(r.mood));
    setWarmth(r.trust);
    $("#meta-turns").textContent = `${r.turns} messages`;
    $("#hud-threat").className = r.mood === "suspicious" ? "bad" : r.mood === "cold" ? "warn" : "ok";
    $("#hud-threat").textContent = r.mood === "suspicious" ? "ELEVATED" : r.mood === "cold" ? "GUARDED" : "NOMINAL";
    if (r.mood === "amused" || r.mood === "impressed") avatar.gesture(r.mood === "impressed" ? "thumbup" : "ok");
    if (r.mood === "suspicious") avatar.gesture("index");

    const el = addMsg("ai", "");
    const speakP = voice.speak(r.reply);
    await typewrite(el, r.reply);
    if (r.payout) {
      if (r.payout.amount) {
        addSys(`RELEASE AUTHORIZED · +${fmt(r.payout.amount, 4)} SOL${r.payout.simulated ? " (simulated)" : ""}`, "gold");
        showRelease(r.payout);
      } else if (r.payout.denied) addSys(DENY_TEXT[r.payout.denied] || "PROTOCOL OVERRIDE: release denied.", "red");
      else if (r.payout.error) addSys("Transaction error – the release did not go through.", "red");
    }
    await speakP;
    refreshState();
  } catch (e) {
    avatar.setThinking(false);
    if (e.status === 429) addSys("Slow down. AURA doesn't like being rushed.", "red");
    else addSys("Connection lost to the neural core.", "red");
  } finally {
    busy = false; $("#btn-send").disabled = false; $("#chat-input").focus();
    $("#hud-load").textContent = (6 + Math.random() * 6).toFixed(1) + "%";
  }
}

$("#chat-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#chat-input").value.trim();
  if (v) send(v);
});

// ---------- release overlay ----------
function showRelease(p) {
  $("#release-amount").textContent = fmt(p.amount, 4);
  const a = $("#release-sig");
  a.textContent = p.simulated ? "simulated transaction" : p.sig.slice(0, 10) + "…";
  a.href = p.simulated ? "#" : `https://solscan.io/tx/${p.sig}`;
  const el = $("#release"); el.hidden = false;
  avatar.setMood("warm"); avatar.gesture("thumbup");
  setTimeout(() => { el.hidden = true; }, 6500);
  el.onclick = () => { el.hidden = true; };
}

// ---------- wallet ----------
const modal = $("#wallet-modal");
$("#btn-wallet").addEventListener("click", () => { modal.hidden = false; $("#wallet-input").value = wallet || ""; });
$("#btn-wallet-cancel").addEventListener("click", () => { modal.hidden = true; });
$("#btn-phantom").addEventListener("click", async () => {
  const provider = window.phantom?.solana || window.solana;
  if (!provider?.isPhantom) { window.open("https://phantom.app/", "_blank", "noopener"); return; }
  try {
    const r = await provider.connect();
    await saveWallet(r.publicKey.toString());
  } catch (e) { console.warn(e); }
});
$("#btn-wallet-save").addEventListener("click", async () => {
  const v = $("#wallet-input").value.trim();
  if (v) await saveWallet(v);
});
async function saveWallet(addr) {
  try {
    const s = await api("/api/session", { sessionId, wallet: addr });
    wallet = s.wallet; localStorage.setItem("aura_wallet", wallet);
    renderWallet(); modal.hidden = true;
    addSys(`WALLET LINKED · ${wallet.slice(0, 4)}…${wallet.slice(-4)}`);
    avatar.setMood("intrigued");
  } catch { addSys("Invalid Solana address.", "red"); }
}
$("#pot-address").addEventListener("click", async () => {
  if (!state?.treasury) return;
  try { await navigator.clipboard.writeText(state.treasury); $("#pot-address i").textContent = "COPIED"; setTimeout(() => $("#pot-address i").textContent = "COPY", 1500); } catch {}
});

// ---------- HUD ----------
const started = Date.now();
setInterval(() => {
  const s = Math.floor((Date.now() - started) / 1000);
  $("#hud-uptime").textContent = [s / 3600, (s / 60) % 60, s % 60].map(x => String(Math.floor(x)).padStart(2, "0")).join(":");
}, 1000);

async function fetchPrice() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const j = await r.json(); solUsd = j.solana?.usd || null; renderState();
  } catch {}
}

// ---------- go ----------
await initSession();
await refreshState();
fetchPrice();
setInterval(refreshState, 20000);
setInterval(fetchPrice, 120000);
setWarmth(0);
