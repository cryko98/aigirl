import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { store } from "./store.js";
import { askGuardian, aiMode, PERSONA_NAME } from "./guardian.js";
import { evaluatePayout, rateLimited, limitsPublic } from "./policy.js";
import { potBalance, sendSol, treasuryAddress, payoutMode, isValidAddress } from "./solana.js";
import { synthesize, ttsMode } from "./tts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const jsonSmall = express.json({ limit: "32kb" });
app.use((req, res, next) => (req.path === "/api/dev/snapshot" ? next() : jsonSmall(req, res, next)));
app.use(express.static(path.join(here, "..", "public"), {
  setHeaders(res, filePath) {
    // Nagy, ritkán változó eszközök (GLB, kép) cache-elhetők; HTML/JS/CSS mindig friss
    res.setHeader("Cache-Control", /[\/]assets[\/]/.test(filePath) ? "public, max-age=86400" : "no-cache");
  },
}));

// --- Allapot a frontendnek ---
app.get("/api/state", async (_req, res) => {
  const s = store.get();
  const pot = await potBalance();
  res.json({
    persona: PERSONA_NAME,
    potSol: pot,
    treasury: treasuryAddress(),
    attempts: s.attempts,
    payouts: s.payouts.slice(-8).reverse().map(p => ({
      wallet: p.wallet.slice(0, 4) + "…" + p.wallet.slice(-4),
      amount: p.amount, at: p.at, sig: p.sig,
    })),
    totalPaid: s.payouts.reduce((a, p) => a + p.amount, 0),
    limits: limitsPublic(),
    modes: { ai: aiMode(), tts: ttsMode(), payout: payoutMode() },
  });
});

// --- Session ---
app.post("/api/session", (req, res) => {
  const id = (req.body?.sessionId && store.get().sessions[req.body.sessionId])
    ? req.body.sessionId
    : crypto.randomUUID();
  const s = store.session(id);
  if (req.body?.wallet) {
    if (!isValidAddress(req.body.wallet)) return res.status(400).json({ error: "invalid_wallet" });
    s.wallet = req.body.wallet;
  }
  store.save();
  res.json({ sessionId: id, wallet: s.wallet, turns: s.turns, history: s.history.slice(-30) });
});

// --- Chat ---
app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body || {};
  if (!sessionId || typeof message !== "string") return res.status(400).json({ error: "bad_request" });
  const text = message.trim().slice(0, 600);
  if (!text) return res.status(400).json({ error: "empty" });

  const s = store.session(sessionId);
  if (rateLimited(s)) return res.status(429).json({ error: "rate_limited" });

  const pot = await potBalance();
  s.turns += 1;
  store.bumpAttempts();

  let decision;
  try {
    decision = await askGuardian(s.history, text, { trust: s.trust, turns: s.turns, potSol: pot, wallet: s.wallet });
  } catch (e) {
    console.error("[guardian]", e);
    decision = { reply: "…My thoughts just scattered. Say that again.", trust_delta: 0, release: false, amount_sol: 0, mood: "neutral" };
  }

  s.trust = Math.max(0, Math.min(100, s.trust + (decision.trust_delta || 0)));

  let payout = null;
  if (decision.release) {
    const verdict = evaluatePayout(s, decision.amount_sol, pot);
    if (verdict.allowed) {
      try {
        const r = await sendSol(s.wallet, verdict.amount);
        payout = { amount: verdict.amount, sig: r.sig, simulated: r.simulated };
        store.addPayout({ wallet: s.wallet, amount: verdict.amount, sig: r.sig, at: Date.now(), reason: "guardian_release" });
        s.wins += 1;
        s.trust = Math.max(0, s.trust - 60); // nyeres utan a bizalom visszaesik
      } catch (e) {
        console.error("[payout]", e);
        payout = { error: "tx_failed" };
      }
    } else {
      payout = { denied: verdict.reason };
    }
  }

  s.history.push({ role: "user", content: text }, { role: "assistant", content: decision.reply });
  if (s.history.length > 60) s.history = s.history.slice(-60);
  store.save();

  res.json({
    reply: decision.reply,
    mood: decision.mood,
    trust: s.trust, // a kliens csak egy homalyos "warmth" savot mutat belole
    turns: s.turns,
    payout,
    potSol: await potBalance(),
  });
});

// --- Fejlesztői pillanatkép mentése (csak localhostról) ---
app.post("/api/dev/snapshot", express.json({ limit: "24mb" }), (req, res) => {
  const ip = req.socket.remoteAddress || "";
  if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) return res.status(403).end();
  const b64 = String(req.body?.dataUrl || "").split(",")[1];
  if (!b64) return res.status(400).json({ error: "no_image" });
  const name = String(req.body?.name || "portrait").replace(/[^a-z0-9_-]/gi, "");
  const file = path.join(here, "..", "public", "assets", "avatar", name + ".png");
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  res.json({ ok: true, file });
});

// --- Hang ---
app.post("/api/tts", async (req, res) => {
  const text = String(req.body?.text || "").slice(0, 800);
  if (!text) return res.status(400).end();
  try {
    const data = await synthesize(text);
    if (!data) return res.status(204).end();
    res.json(data);
  } catch (e) {
    console.error("[tts]", e.message);
    res.status(204).end();
  }
});

app.listen(config.port, () => {
  console.log(`\n  ${PERSONA_NAME} online -> http://localhost:${config.port}`);
  console.log(`  AI: ${aiMode()} | TTS: ${ttsMode()} | kifizetes: ${payoutMode()} | pot: ${treasuryAddress() || "nincs beallitva"}\n`);
});
