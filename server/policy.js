// KEMÉNY SZABÁLYOK – ezeket a szerver kényszeríti ki, az AI döntése csak javaslat.
// Az AI SOHA nem tud többet kifizettetni, mint amit ezek a korlátok engednek.
import { config } from "./config.js";
import { store } from "./store.js";

const L = config.limits;

export function rateLimited(session) {
  const now = Date.now();
  session.lastMsgAt = (session.lastMsgAt || []).filter(t => now - t < 60_000);
  if (session.lastMsgAt.length >= L.messageRateLimit) return true;
  session.lastMsgAt.push(now);
  return false;
}

/**
 * Az AI "release" javaslatát szűri. Visszaad: { allowed, amount, reason }
 * @param {object} session
 * @param {number} proposedSol  az AI által javasolt összeg
 * @param {number} potSol       a pot aktuális egyenlege
 */
export function evaluatePayout(session, proposedSol, potSol) {
  const deny = (reason) => ({ allowed: false, amount: 0, reason });

  if (!session.wallet) return deny("no_wallet");
  if (!(proposedSol > 0)) return deny("zero_amount");
  if (session.turns < L.minTurnsBeforePayout) return deny("too_few_turns");

  const { total, wins } = store.walletTotals(session.wallet);
  if (wins >= L.maxWinsPerWallet) return deny("wallet_win_limit");
  if (total >= L.maxPerWalletSol) return deny("wallet_total_limit");

  const sinceLast = Date.now() - (store.get().lastPayoutAt || 0);
  if (sinceLast < L.payoutCooldownMin * 60_000) return deny("global_cooldown");

  const daily = store.dailyTotal();
  if (daily >= L.dailyPayoutCapSol) return deny("daily_cap");

  // Összeg vágása minden plafonhoz
  let amount = Math.min(
    proposedSol,
    L.maxPayoutSol,
    potSol * L.maxPotShare,
    L.maxPerWalletSol - total,
    L.dailyPayoutCapSol - daily,
  );
  // Hagyjunk fee-t a poton
  amount = Math.min(amount, Math.max(0, potSol - 0.01));
  amount = Math.floor(amount * 1e4) / 1e4; // 4 tizedes

  if (amount < 0.001) return deny("pot_too_small");

  // Végső "sors" dobás: a bizalmi szint is számít – minél alacsonyabb, annál ritkább
  const trust = Math.max(0, Math.min(100, session.trust || 0));
  const chance = Math.min(1, (trust / 100) * L.winChanceScaler);
  if (Math.random() > chance) return deny("fate_rejected");

  return { allowed: true, amount, reason: "ok" };
}

export const limitsPublic = () => ({
  maxPayoutSol: L.maxPayoutSol,
  maxPotSharePct: L.maxPotShare * 100,
  maxPerWalletSol: L.maxPerWalletSol,
  maxWinsPerWallet: L.maxWinsPerWallet,
  minTurns: L.minTurnsBeforePayout,
  cooldownMin: L.payoutCooldownMin,
  dailyCapSol: L.dailyPayoutCapSol,
});
