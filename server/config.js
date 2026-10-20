import "dotenv/config";

const num = (key, def) => {
  const v = process.env[key];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  port: num("PORT", 3000),

  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",

  elevenKey: process.env.ELEVENLABS_API_KEY || "",
  elevenVoice: process.env.ELEVENLABS_VOICE_ID || "",
  elevenModel: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",

  rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  treasuryPublicKey: process.env.TREASURY_PUBLIC_KEY || "",
  treasurySecretKey: process.env.TREASURY_SECRET_KEY || "",
  demoPotSol: num("DEMO_POT_SOL", 0),

  limits: {
    maxPayoutSol: num("MAX_PAYOUT_SOL", 0.5),
    maxPotShare: num("MAX_POT_SHARE", 0.05),
    maxPerWalletSol: num("MAX_PER_WALLET_SOL", 0.75),
    maxWinsPerWallet: num("MAX_WINS_PER_WALLET", 2),
    minTurnsBeforePayout: num("MIN_TURNS_BEFORE_PAYOUT", 6),
    payoutCooldownMin: num("PAYOUT_COOLDOWN_MIN", 20),
    dailyPayoutCapSol: num("DAILY_PAYOUT_CAP_SOL", 3),
    winChanceScaler: num("GLOBAL_WIN_CHANCE_SCALER", 1),
    messageRateLimit: num("MESSAGE_RATE_LIMIT", 8),
  },
};
