# AURA — The Guardian

Egyszekciós, teljesen angol nyelvű Solana memecoin oldal: egy valós időben renderelt 3D android női AI-fej (üveg koponyatető, látható neuron-agy) (TalkingHead + Three.js, viseme-alapú szájszinkronnal), alatta chat, mellette a reward pot. A felhasználók megpróbálják meggyőzni AURA-t, hogy küldjön nekik SOL-t — de ez szándékosan nagyon nehéz, és a szerver kemény limitekkel védi a potot.

## Indítás

```bash
npm install
npm start
```

Megnyitás: http://localhost:3000

API-kulcsok nélkül is teljesen működik:
- **AI**: beépített „mock” őrszem (elutasít, lassan épülő bizalom, prompt-injection büntetés)
- **Hang**: a böngésző beépített Web Speech API-ja, becsült szó-időzítéssel vezérelt szájszinkron
- **Kifizetés**: szimulált (naplózza, nem küld tranzakciót)

## Beállítás (.env)

| Változó | Mire való |
|---|---|
| `ANTHROPIC_API_KEY` | Claude bekapcsolása (a persona a `server/guardian.js`-ben). Modell: `ANTHROPIC_MODEL` (alap: `claude-opus-5-5`). |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Valódi női hang, időbélyeges TTS → pontos lipsync. |
| `TREASURY_PUBLIC_KEY` | A pot publikus címe (megjelenik az oldalon, ebből olvassa az egyenleget). |
| `TREASURY_SECRET_KEY` | A pot privát kulcsa (base58 vagy JSON tömb). Csak a szerveren! Ha üres → szimulált kifizetés. |
| `SOLANA_RPC_URL` | RPC endpoint (mainnet alap; devnet-hez `https://api.devnet.solana.com`). |
| `DEMO_POT_SOL` | Csak megjelenítés, ha nincs treasury. |

### Kifizetési limitek (a szerver kényszeríti ki, az AI nem írhatja felül)

`MAX_PAYOUT_SOL`, `MAX_POT_SHARE`, `MAX_PER_WALLET_SOL`, `MAX_WINS_PER_WALLET`, `MIN_TURNS_BEFORE_PAYOUT`, `PAYOUT_COOLDOWN_MIN`, `DAILY_PAYOUT_CAP_SOL`, `GLOBAL_WIN_CHANCE_SCALER`, `MESSAGE_RATE_LIMIT` — lásd `.env.example`. A logika: `server/policy.js`.

Folyamat: a modell csak *javasol* (`release`, `amount_sol`, `trust_delta`), a `policy.js` minden plafonnal levágja, majd egy bizalom-alapú „sors” dobás dönt. Nyerés után a bizalom visszaesik.

## Avatar (a karakter)

A karakter egy **emberszerű android nő**, teljes egészében kódból építve (`public/js/avatar.js`):
- Alap: a TalkingHead példa-avatarja (`public/assets/avatar/avaturn.glb`, ARKit + Oculus viseme blendshape-ekkel → szájszinkron, pislogás, mimika). A haj- és ruhamesh-ek el vannak rejtve / átszínezve.
- **Android bőr**: saját shader – porcelán/kompozit bőr, Fresnel-derengés, központi varrat, panelgyűrűk, finom áramköri rács; a fénylés színe a hangulattal változik.
- **Kopasz fej, átlátszó koponyatető**: a bőr-shader a `Head` csont lokális terében egy vágósík (`uCutY`) felett üveggé válik, világító illesztési gyűrűvel.
- **AI-agy a kupolában**: betöltéskor a koponya csúcsaiból (póz-függetlenül, a skeleton bind-mátrixaival) kiszámolt ellipszoidban ~420 neuron, kapcsolatok és végigfutó impulzusok (Points + LineSegments, saját shaderek), a fejcsonthoz rögzítve, így együtt mozog a fejjel.
- **Szemek**: világítanak (emissive), színük a hangulattal változik.
- Finomhangolás: `uCutY` (üveg magassága), `buildBrain()` (agy méret/sűrűség), `androidSkinMaterial()` (bőr), TalkingHead fények a `createAvatar()` opcióiban.
- `public/assets/avatar/face.png`: AI-generált referencia-portré (poszter a betöltés alatt).
- A példa-avatar csak nem kereskedelmi használatra licencelt: éles indulás előtt cseréld saját GLB-re (Avaturn/MetaPerson, ARKit + Oculus Visemes), az android-átalakítás ugyanúgy ráfut.
- Hangulatok (`neutral, intrigued, amused, impressed, warm, cold, suspicious`) a modell válaszából jönnek, és a mimikát, a derengés színét és a gesztusokat vezérlik.

## Struktúra

```
server/
  index.js     Express API (/api/state, /api/session, /api/chat, /api/tts)
  guardian.js  AURA persona + Claude strukturált kimenet / mock mód
  policy.js    Kemény kifizetési szabályok
  solana.js    Egyenleg + SOL transfer
  tts.js       ElevenLabs időbélyeges TTS → szó-időzítés
  store.js     JSON tároló (data/state.json) – élesben cseréld DB-re
public/
  index.html, css/style.css
  js/app.js    UI, chat, pot, wallet (Phantom), HUD
  js/avatar.js TalkingHead 3D fej, lipsync, hangulat, tekintetkövetés
  js/voice.js  Hang (ElevenLabs / böngésző) + lipsync adat
  js/neural.js Neurális háttér-animáció
```

## Éles üzem előtt

- Cseréld a linkeket a fejlécben (X, TG, DEX) és az avatar modellt.
- A `TREASURY_SECRET_KEY` csak környezeti változóként, soha a repóban. Érdemes külön „hot” walletet használni kis egyenleggel, és a limiteket konzervatívan tartani.
- Rate limit + Cloudflare/Turnstile ajánlott a `/api/chat` elé.
- A JSON tároló helyett SQLite/Postgres.
