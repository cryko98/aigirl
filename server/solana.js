import {
  Connection, PublicKey, Keypair, SystemProgram, Transaction,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { config } from "./config.js";

const connection = new Connection(config.rpcUrl, "confirmed");

let treasury = null;
let treasuryPub = null;
try {
  if (config.treasurySecretKey) {
    const raw = config.treasurySecretKey.trim();
    const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : base58Decode(raw);
    treasury = Keypair.fromSecretKey(bytes);
    treasuryPub = treasury.publicKey;
  } else if (config.treasuryPublicKey) {
    treasuryPub = new PublicKey(config.treasuryPublicKey);
  }
} catch (e) {
  console.error("[solana] Hibas treasury kulcs:", e.message);
}

export const treasuryAddress = () => (treasuryPub ? treasuryPub.toBase58() : null);
export const payoutMode = () => (treasury ? "live" : "simulated");

let cached = { sol: 0, at: 0 };
export async function potBalance() {
  if (!treasuryPub) return config.demoPotSol;
  if (Date.now() - cached.at < 15_000) return cached.sol;
  try {
    const lamports = await connection.getBalance(treasuryPub);
    cached = { sol: lamports / LAMPORTS_PER_SOL, at: Date.now() };
  } catch (e) {
    console.error("[solana] balance hiba:", e.message);
  }
  return cached.sol;
}

export function isValidAddress(addr) {
  try { new PublicKey(addr); return true; } catch { return false; }
}

/** Kuld SOL-t a potbol. Visszaad: { sig, simulated } */
export async function sendSol(toAddress, amountSol) {
  const to = new PublicKey(toAddress);
  if (!treasury) {
    return { sig: "SIMULATED-" + Date.now().toString(36), simulated: true };
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: treasury.publicKey,
      toPubkey: to,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    }),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [treasury]);
  cached.at = 0;
  return { sig, simulated: false };
}

// --- minimal base58 dekoder (Phantom export formatumhoz) ---
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(str) {
  const bytes = [0];
  for (const ch of str) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error("invalid base58");
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of str) { if (ch === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}
