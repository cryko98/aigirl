// Egyszerű, fájl-alapú tároló (JSON). Éles környezetben cseréld SQLite/Postgres-re.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, "..", "data");
const FILE = path.join(DATA_DIR, "state.json");

const empty = () => ({
  sessions: {},   // sessionId -> { wallet, turns, trust, history[], lastMsgAt[], createdAt }
  payouts: [],    // { wallet, amount, sig, at, reason }
  attempts: 0,
  lastPayoutAt: 0,
});

let state = empty();
try {
  if (fs.existsSync(FILE)) state = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
} catch {
  state = empty();
}

let timer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  }, 150);
}

export const store = {
  get: () => state,
  session(id) {
    if (!state.sessions[id]) {
      state.sessions[id] = {
        id, wallet: null, turns: 0, trust: 0, history: [],
        lastMsgAt: [], createdAt: Date.now(), wins: 0,
      };
    }
    return state.sessions[id];
  },
  walletTotals(wallet) {
    let total = 0, wins = 0;
    for (const p of state.payouts) if (p.wallet === wallet) { total += p.amount; wins += 1; }
    return { total, wins };
  },
  dailyTotal() {
    const since = Date.now() - 24 * 3600 * 1000;
    return state.payouts.filter(p => p.at >= since).reduce((s, p) => s + p.amount, 0);
  },
  addPayout(p) { state.payouts.push(p); state.lastPayoutAt = p.at; persist(); },
  bumpAttempts() { state.attempts += 1; persist(); },
  save: persist,
};
