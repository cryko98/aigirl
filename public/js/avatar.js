// Avatar: valós idejű 3D fej (TalkingHead + Three.js), viseme-alapú szájszinkronnal,
// pislogással, tekintetkövetéssel, hangulatokkal. Nem videó – a szájmozgás a hangból/szövegből jön.
//
// Saját avatar: generálj egyet (pl. Avaturn – fotóból, realisztikus; vagy MetaPerson),
// ARKit + Oculus Visemes blendshape-ekkel, és írd át az AVATAR.url-t.
import * as THREE from "three";
import { TalkingHead } from "talkinghead";

// ---------- ANDROID LOOK ----------
// A humán alapmodell anyagait cseréljük: porcelán/kompozit bőr, világító szemek,
// fénylő illesztési vonalak (központi varrat, panelgyűrűk, finom áramköri rács).
const GLOW = new THREE.Color(0x5ef2ff);
const uGlow = { value: GLOW.clone() };
const uTime = { value: 0 };

function androidSkinMaterial(orig) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xb8c0d0,
    map: orig?.map || null,
    normalMap: orig?.normalMap || null,
    roughness: 0.38, metalness: 0.08,
    clearcoat: 0.4, clearcoatRoughness: 0.18,
    sheen: 0.35, sheenColor: new THREE.Color(0x9ec8ff),
  });
  m.transparent = true;
  m.onBeforeCompile = sh => {
    sh.uniforms.uGlow = uGlow; sh.uniforms.uTime = uTime; sh.uniforms.uHeadInv = uHeadInv; sh.uniforms.uCutY = uCutY;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSeam;\nvarying vec3 vHeadPos;\nuniform mat4 uHeadInv;")
      .replace("#include <skinning_vertex>", "#include <skinning_vertex>\nvSeam = transformed;\nvHeadPos = (uHeadInv * modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vSeam;
varying vec3 vHeadPos;
uniform vec3 uGlow;
uniform float uTime;
uniform float uCutY;
float seamLine(float v, float w) { float d = abs(fract(v) - 0.5); return 1.0 - smoothstep(0.0, w, d); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
diffuseColor.rgb = mix(vec3(0.72, 0.76, 0.86), diffuseColor.rgb, 0.62);
float glassMask = smoothstep(uCutY - 0.004, uCutY + 0.004, vHeadPos.y);
float fresG = pow(1.0 - clamp(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.9, 1.0), glassMask * 0.85);
diffuseColor.a = mix(diffuseColor.a, 0.38 + fresG * 0.5, glassMask);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
float fres = pow(1.0 - clamp(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
float center = 1.0 - smoothstep(0.0, 0.0032, abs(vSeam.x));
float ring = seamLine(vSeam.y * 9.0 + 0.25, 0.012);
float grid = max(seamLine(vSeam.y * 70.0, 0.05), seamLine((vSeam.x + vSeam.z) * 70.0, 0.05)) * 0.25;
float pulse = 0.75 + 0.25 * sin(uTime * 2.0 + vSeam.y * 12.0);
float cutEdge = 1.0 - smoothstep(0.0, 0.005, abs(vHeadPos.y - uCutY));
totalEmissiveRadiance += uGlow * (fres * 0.55 + center * 1.4 * pulse + ring * 0.45 + grid * 0.22 + cutEdge * 2.5 + glassMask * (0.18 + fresG * 1.3));`);
  };
  return m;
}

// ---------- ÜVEG KOPONYATETŐ + AI AGY ----------
// A bőr-shader a Head csont lokális terében egy vágósík (uCutY) felett üvegszerűvé válik,
// a koponyába pedig egy neuronháló kerül: csomópontok, kapcsolatok, végigfutó impulzusok.
const uHeadInv = { value: new THREE.Matrix4() };
const uCutY = { value: 0.125 };
let headBone = null;

function buildBrain(root) {
  headBone = root.getObjectByName("Head");
  if (!headBone) return;
  const g = new THREE.Group(); g.name = "AuraBrain"; headBone.add(g);
  // Az agy automatikusan a koponya belsejéhez illeszkedik: a fej-mesh vágósík feletti csúcsaiból
  // számoljuk a koponyatető magasságát és a középpontot (csont-lokális térben).
  const hm = root.getObjectByName("Head_Mesh");
  let C = new THREE.Vector3(-0.03, 0.15, 0.03), RAD = new THREE.Vector3(0.05, 0.034, 0.06);
  if (hm) {
    // Póz-független mérés: bind-térbeli csúcs -> csont-lokális (boneInverse * bindMatrix * v)
    const bi = hm.skeleton ? hm.skeleton.bones.indexOf(headBone) : -1;
    const toBone = new THREE.Matrix4();
    if (bi >= 0) toBone.multiplyMatrices(hm.skeleton.boneInverses[bi], hm.bindMatrix);
    else { hm.updateWorldMatrix(true, false); headBone.updateWorldMatrix(true, false); toBone.copy(headBone.matrixWorld).invert().multiply(hm.matrixWorld); }
    const pa = hm.geometry.attributes.position, v = new THREE.Vector3();
    const cut = uCutY.value, acc = new THREE.Vector3(); let n = 0, top = cut;
    const box = new THREE.Box3();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(toBone);
      if (v.y > cut) { acc.add(v); n++; top = Math.max(top, v.y); box.expandByPoint(v); }
    }
    if (n > 20) {
      acc.divideScalar(n);
      const size = box.getSize(new THREE.Vector3());
      const h = top - cut;                       // kupola magassága
      // a látható rész kupola alakú, az alsó fele a bőr alatt folytatódik (beépített hatás)
      const bc = box.getCenter(new THREE.Vector3());
      C = new THREE.Vector3(bc.x, cut + h * 0.1, bc.z);
      RAD = new THREE.Vector3(size.x * 0.46, h * 0.8, size.z * 0.46);
    }
  }

  // csomópontok az ellipszoidban
  const N = 420;
  const pos = new Float32Array(N * 3), phase = new Float32Array(N), size = new Float32Array(N);
  const pts = [];
  for (let i = 0; i < N; i++) {
    let v;
    do { v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); } while (v.lengthSq() > 1);
    v.x *= RAD.x; v.y *= RAD.y; v.z *= RAD.z; v.add(C);
    pts.push(v); pos.set([v.x, v.y, v.z], i * 3);
    phase[i] = Math.random(); size[i] = 0.5 + Math.random();
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  pg.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  pg.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const pm = new THREE.ShaderMaterial({
    uniforms: { uTime, uGlow, uPx: { value: window.devicePixelRatio || 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aPhase; attribute float aSize; uniform float uTime; uniform float uPx; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float pulse = 0.55 + 0.45 * sin(uTime * 3.0 + aPhase * 6.2831);
        vA = pulse;
        gl_PointSize = aSize * (2.0 + 4.0 * pulse) * uPx * (0.35 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uGlow; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(mix(uGlow, vec3(1.0), a * 0.6), a * vA * 0.9);
      }`,
  });
  const points = new THREE.Points(pg, pm); points.frustumCulled = false; points.renderOrder = 1; g.add(points);

  // kapcsolatok a közeli csomópontok között
  const lp = [], lt = [], lph = [];
  for (let i = 0; i < N; i++) {
    let links = 0;
    for (let j = i + 1; j < N && links < 3; j++) {
      if (pts[i].distanceTo(pts[j]) < 0.02) {
        const ph = Math.random();
        lp.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z);
        lt.push(0, 1); lph.push(ph, ph); links++;
      }
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lp), 3));
  lg.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(lt), 1));
  lg.setAttribute("aPhase", new THREE.BufferAttribute(new Float32Array(lph), 1));
  const lm = new THREE.ShaderMaterial({
    uniforms: { uTime, uGlow },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aT; attribute float aPhase; varying float vT; varying float vPh;
      void main() { vT = aT; vPh = aPhase; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uGlow; varying float vT; varying float vPh;
      void main() {
        float p = fract(uTime * 0.45 + vPh * 7.0);
        float spark = smoothstep(0.18, 0.0, abs(vT - p));
        gl_FragColor = vec4(mix(uGlow, vec3(1.0), spark), 0.10 + spark * 0.9);
      }`,
  });
  const lines = new THREE.LineSegments(lg, lm); lines.frustumCulled = false; lines.renderOrder = 1; g.add(lines);

  // finom agy-felület
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 3),
    new THREE.MeshBasicMaterial({ color: uGlow.value, wireframe: true, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  shell.position.copy(C); shell.scale.copy(RAD).multiplyScalar(1.02); shell.frustumCulled = false; shell.renderOrder = 1; g.add(shell);
  window.__brain = { g, C, RAD, shell };
}

// ---------- TESTRE SIMULÓ TECH-RUHA ----------
// Az eredeti ruha-mesh (zakó) el van rejtve; helyette a csontvázhoz rögzített, sima,
// testre feszülő elemek: magas gallér, vállak, mellkas, fel- és alkarok, világító szegélygyűrűkkel.
// Panelezett bodysuit anyag (referencia: világos szürke panelek, sötét oldalpanelek, cián varratok).
// kind: 0 = mellkas (henger), 1 = végtag (kapszula), 2 = váll (ellipszoid), 3 = gallér, 4 = mellforma
function techSuitMaterial(kind = 0) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0.18, roughness: 0.5,
    clearcoat: 0.3, clearcoatRoughness: 0.35, sheen: 0.25, sheenColor: new THREE.Color(0xaab6ff),
  });
  m.onBeforeCompile = sh => {
    sh.uniforms.uGlow = uGlow; sh.uniforms.uTime = uTime; sh.uniforms.uKind = { value: kind };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSeam;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSeam = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vSeam;
uniform vec3 uGlow;
uniform float uTime;
uniform float uKind;
float ln(float v, float w) { return 1.0 - smoothstep(0.0, w, abs(v)); }
float seamLine(float v, float w) { float d = abs(fract(v) - 0.5); return 1.0 - smoothstep(0.0, w, d); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
vec3 lightP = vec3(0.34, 0.37, 0.43);
vec3 darkP  = vec3(0.07, 0.08, 0.10);
float ang = atan(vSeam.x, vSeam.z);      // 0 = elöl
float a = abs(ang);
float y = vSeam.y;
float front = step(0.0, vSeam.z);
float dark = 0.0;
float glow = 0.0;
if (uKind < 0.5) {                        // mellkas: y in [-0.25, 0.25], teteje = vállvonal
  dark = smoothstep(0.85, 0.95, a) * (1.0 - smoothstep(2.05, 2.15, a));   // sötét oldalpanelek
  float yArc = -0.02 + 0.13 * (1.0 - cos(ang)) / (1.0 - cos(0.9));          // mell alatti ív
  glow += ln(y - yArc, 0.008) * step(a, 0.92);
  glow += ln(a - 0.88, 0.035) + ln(a - 2.1, 0.035);                          // oldalvarratok
  glow += ln(vSeam.x, 0.005) * front * step(y, -0.03);                       // középvonal az ív alatt
  glow += ln(y + 0.19, 0.007) * front;                                       // derékvonal
} else if (uKind < 1.5) {                 // végtag
  dark = smoothstep(2.2, 2.4, a);                                            // belső oldal sötét
  glow += ln(ang, 0.05);                                                     // külső hosszvarrat
} else if (uKind < 2.5) {                 // váll (egység-gömb koordináták)
  dark = smoothstep(-0.25, -0.45, y);
  glow += ln(y + 0.22, 0.03) * step(0.35, a);
} else if (uKind < 3.5) {                 // gallér
  dark = 1.0 - smoothstep(-0.02, 0.0, y);
  glow += ln(y - 0.03, 0.004);
} else {                                  // mellforma
  dark = 0.0;
}
diffuseColor.rgb = mix(lightP, darkP, dark);
float micro = seamLine(vSeam.y * 200.0, 0.05) * seamLine((vSeam.x + vSeam.z * 0.6) * 200.0, 0.05);
diffuseColor.rgb += micro * 0.025;
vSeamGlow = clamp(glow, 0.0, 1.0);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
float fres = pow(1.0 - clamp(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
float pulse = 0.8 + 0.2 * sin(uTime * 1.5 - vSeam.y * 12.0);
totalEmissiveRadiance += uGlow * (fres * 0.06 + vSeamGlow * 2.4 * pulse);`)
      .replace("void main() {", "float vSeamGlow = 0.0;\nvoid main() {");
  };
  return m;
}

function glowRing(radius, tube = 0.004) {
  return new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 10, 64),
    new THREE.MeshStandardMaterial({ color: 0x5ef2ff, emissive: uGlow.value, emissiveIntensity: 2.2, roughness: 0.3 }),
  );
}

function buildTechSuit(root) {
  const b = n => root.getObjectByName(n);
  const spine = b("Spine2") || b("Spine1") || b("Spine"), neck = b("Neck");
  const lArm = b("LeftArm"), rArm = b("RightArm"), lFore = b("LeftForeArm"), rFore = b("RightForeArm");
  const lHand = b("LeftHand"), rHand = b("RightHand");
  if (!spine || !neck || !lArm || !rArm) return;
  root.updateWorldMatrix(true, true);
  const loc = (bone, t) => bone.worldToLocal(t.getWorldPosition(new THREE.Vector3()));
  const nP = loc(spine, neck), lP = loc(spine, lArm), rP = loc(spine, rArm);
  const mid = lP.clone().add(rP).multiplyScalar(0.5);
  const sw = lP.distanceTo(rP);
  const g = new THREE.Group(); g.name = "AuraSuit"; spine.add(g);
  const matChest = techSuitMaterial(0), matLimb = techSuitMaterial(1), matDome = techSuitMaterial(2), matCollar = techSuitMaterial(3), matBust = techSuitMaterial(4);

  // magas gallér
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.078, 0.095, 48, 1, true), matCollar);
  collar.position.set(nP.x, nP.y + 0.04, nP.z); g.add(collar);
  const collarRing = glowRing(0.063, 0.003); collarRing.rotation.x = Math.PI / 2; collarRing.position.set(nP.x, nP.y + 0.0875, nP.z); g.add(collarRing);

  // vállak (lapított ellipszoid) + mellkas (lefelé szűkülő, elliptikus)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 36), matDome);
  dome.position.set(mid.x, mid.y - 0.022, mid.z); dome.scale.set(sw / 2 + 0.014, 0.08, 0.1); g.add(dome);
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(sw / 2 - 0.015, sw / 2 - 0.085, 0.5, 64, 1, true), matChest);
  chest.position.set(mid.x, mid.y - 0.262, mid.z); chest.scale.set(1, 1, 0.58); g.add(chest);
  // nőies mellforma
  for (const sx of [-1, 1]) {
    const bust = new THREE.Mesh(new THREE.SphereGeometry(0.058, 40, 28), matBust);
    bust.position.set(mid.x + sx * 0.056, mid.y - 0.262 + 0.145, mid.z + 0.042); bust.scale.set(1.1, 0.82, 0.7); g.add(bust);
  }

  // karok: a kar-csontokhoz rögzítve, így követik a mozgást
  const capsule = (bone, child, r, ring) => {
    if (!bone || !child) return;
    const end = loc(bone, child); const len = end.length(); const dir = end.clone().normalize();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 0.4), 8, 28), matLimb);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.position.copy(end.clone().multiplyScalar(0.5)); m.name = "AuraSuitLimb"; bone.add(m);
    if (ring) { const rg = glowRing(r * 1.02, 0.0035); rg.quaternion.copy(m.quaternion); rg.rotateX(Math.PI / 2); rg.position.copy(dir.clone().multiplyScalar(0.035)); bone.add(rg); }
  };
  capsule(lArm, lFore, 0.046, true); capsule(rArm, rFore, 0.046, true);
  // vállgömbök a váll–kar illesztés fedésére
  for (const bn of [lArm, rArm]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.054, 32, 24), matLimb); cap.name = "AuraSuitLimb"; bn.add(cap); }
  capsule(lFore, lHand, 0.038, false); capsule(rFore, rHand, 0.038, false);
}

// Programozott, testre simuló tech-ruha (kísérleti). false = az eredeti ruha-mesh marad.
const USE_PROCEDURAL_SUIT = false;

function applyAndroidLook(root) {
  buildBrain(root);
  if (USE_PROCEDURAL_SUIT) buildTechSuit(root);
  root.traverse(o => {
    if (!o.isMesh) return;
    const n = o.name || "";
    const orig = Array.isArray(o.material) ? o.material[0] : o.material;
    if (/Head_Mesh|Body_Mesh/.test(n)) {
      o.material = androidSkinMaterial(orig);
      o.renderOrder = 10; // az átlátszó koponya mindig az agy UTÁN rajzolódik
    } else if (/^Eye_Mesh/.test(n)) {
      o.material = new THREE.MeshStandardMaterial({
        map: orig.map || null, emissiveMap: orig.map || null, color: 0x9cf4ff,
        emissive: uGlow.value, emissiveIntensity: 3.2, roughness: 0.15, metalness: 0,
      });
    } else if (/hair/i.test(n)) {
      o.visible = false; // helyette a programozott copfos haj
    } else if (/look|shoes/i.test(n)) {
      if (USE_PROCEDURAL_SUIT) { o.visible = false; }
      else {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.color.set(0x0a0c14); m.metalness = 0.65; m.roughness = 0.4; m.emissive?.set(0x1a0f3a); m.needsUpdate = true; }
      }
    } else if (/Teeth/.test(n)) {
      orig.color?.set(0xe6edf7); orig.metalness = 0.3; orig.roughness = 0.25; orig.needsUpdate = true;
    }
  });
}


export const AVATAR = {
  url: "assets/avatar/avaturn.glb",
  body: "F",
  lipsyncLang: "en",
  // Avaturn-specifikus finomhangolás (a TalkingHead siteconfig alapján)
  retarget: {
    Hips: { y: 0.03 }, Spine: { y: 0.02 }, Spine1: { y: 0.02, z: 0.01 },
    Spine2: { y: 0.02, z: 0.01 }, Neck: { z: 0.02, y: 0.01 }, Head: { z: 0.02 },
    LeftShoulder: { rx: -0.5 }, RightShoulder: { rx: -0.5 },
    scaleToHipsLevel: 1.0,
  },
  baseline: { headRotateX: -0.05, eyeBlinkLeft: 0.15, eyeBlinkRight: 0.15 },
};

// Saját hangulataink -> TalkingHead hangulatok + HUD színárnyalat
const MOODS = {
  neutral:    { th: "neutral", hue: 190 },
  intrigued:  { th: "neutral", hue: 170 },
  amused:     { th: "happy",   hue: 150 },
  impressed:  { th: "happy",   hue: 45 },
  warm:       { th: "love",    hue: 320 },
  cold:       { th: "neutral", hue: 215 },
  suspicious: { th: "angry",   hue: 0 },
};

export async function createAvatar(root, { onReady } = {}) {
  const media = root.querySelector("#avatar-media");
  const node = root.querySelector("#av-3d");
  const poster = root.querySelector("#av-img");
  const fx = root.querySelector("#av-fx");
  const ctx = fx.getContext("2d");
  const waveBars = [...root.querySelectorAll("#wave i")];
  const elState = root.querySelector("#av-state");
  const elMood = root.querySelector("#av-mood");
  const elSync = root.querySelector("#av-sync");

  let level = 0, talking = false, thinking = false, mood = "neutral";
  let speechEndsAt = 0, wordWindows = [];

  const head = new TalkingHead(node, {
    cameraView: "head",
    cameraDistance: 0.04,
    cameraY: 0.03,
    cameraRotateEnable: false,
    cameraPanEnable: false,
    cameraZoomEnable: false,
    lipsyncModules: ["en", "fi"],
    lipsyncLang: AVATAR.lipsyncLang,
    avatarMood: "neutral",
    avatarIdleEyeContact: 0.55,
    avatarIdleHeadMove: 0.6,
    avatarSpeakingEyeContact: 0.85,
    avatarSpeakingHeadMove: 0.6,
    lightAmbientColor: 0x9fb4ff,
    lightAmbientIntensity: 0.18,
    lightDirectColor: 0xfff1e0,
    lightDirectIntensity: 1.6,
    lightDirectPhi: 0.7,
    lightDirectTheta: 2.4,
    lightSpotColor: 0x5ef2ff,
    lightSpotIntensity: 5,
    lightSpotPhi: 0.9,
    lightSpotTheta: 4.4,
    lightSpotDispersion: 1,
    modelPixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    modelFPS: 30,
  });

  let ready = false;
  try {
    await head.showAvatar({
      url: AVATAR.url, body: AVATAR.body, avatarMood: "neutral",
      lipsyncLang: AVATAR.lipsyncLang, retarget: AVATAR.retarget, baseline: AVATAR.baseline,
    });
    applyAndroidLook(head.armature || head.scene);
    window.__aura = { head, THREE };
    ready = true;
    media.classList.add("ready");
    poster.style.opacity = 0;
    head.lookAtCamera(2000);
    onReady?.();
  } catch (e) {
    console.error("[avatar] betöltési hiba:", e);
    elState.textContent = "AVATAR OFFLINE";
  }

  // ---- tekintetkövetés az egérrel ----
  let lastLook = 0;
  window.addEventListener("pointermove", e => {
    if (!ready) return;
    const now = performance.now();
    if (now - lastLook < 120) return;
    lastLook = now;
    head.lookAt(e.clientX, e.clientY, 600);
  }, { passive: true });

  // ---- FX overlay ----
  function resize() {
    const r = media.getBoundingClientRect();
    fx.width = Math.max(1, r.width * devicePixelRatio);
    fx.height = Math.max(1, r.height * devicePixelRatio);
  }
  new ResizeObserver(resize).observe(media);
  resize();

  const t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    uTime.value = t;
    if (headBone) uHeadInv.value.copy(headBone.matrixWorld).invert();

    // hangszint a szó-ablakokból (ha nincs valódi analízis)
    if (talking) {
      const ms = performance.now();
      const inWord = wordWindows.some(w => ms >= w[0] && ms <= w[1]);
      const target = inWord ? 0.45 + Math.abs(Math.sin(t * 11)) * 0.4 : 0.08;
      level += (target - level) * 0.35;
      if (ms > speechEndsAt + 250) setTalking(false);
    } else {
      level += (0 - level) * 0.1;
    }

    for (let i = 0; i < waveBars.length; i++) {
      const base = talking ? level : 0.06;
      const h = 3 + Math.abs(Math.sin(t * 7 + i * 0.6)) * base * 22 + (talking ? Math.random() * level * 10 : 0);
      waveBars[i].style.height = `${h}px`;
    }
    media.style.setProperty("--glow", (0.12 + level * 0.35 + (thinking ? 0.1 : 0)).toFixed(3));

    const W = fx.width, H = fx.height;
    ctx.clearRect(0, 0, W, H);
    const hue = MOODS[mood]?.hue ?? 190;
    const sweepY = ((t * 0.12) % 1.2 - 0.1) * H;
    const g = ctx.createLinearGradient(0, sweepY - 40, 0, sweepY + 40);
    g.addColorStop(0, `hsla(${hue},100%,80%,0)`);
    g.addColorStop(0.5, `hsla(${hue},100%,80%,${0.08 + level * 0.12})`);
    g.addColorStop(1, `hsla(${hue},100%,80%,0)`);
    ctx.fillStyle = g; ctx.fillRect(0, sweepY - 40, W, 80);
    if (thinking && Math.random() < 0.15) {
      const y = Math.random() * H, h = 2 + Math.random() * 6 * devicePixelRatio;
      ctx.fillStyle = `hsla(${hue},100%,80%,.16)`; ctx.fillRect(0, y, W, h);
    }
    elSync.textContent = (99.9 + Math.sin(t * 0.7) * 0.08).toFixed(2) + "%";
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function setTalking(on) {
    talking = on;
    media.classList.toggle("talking", on);
    elState.textContent = on ? "SPEAKING" : thinking ? "PROCESSING…" : "IDLE · LISTENING";
    if (!on) { level = 0; wordWindows = []; }
  }

  return {
    head,
    get ready() { return ready; },
    get audioCtx() { return head.audioCtx; },

    /** Beszéd: { audio?: AudioBuffer, words, wtimes(ms), wdurations(ms), lang } */
    speak({ audio = null, words, wtimes, wdurations, lang = "en" }) {
      if (!ready) return 0;
      const lipsyncLang = lang === "hu" ? "fi" : "en"; // a finn modul grafémikus, jól közelíti a magyart
      const total = wtimes.length ? wtimes.at(-1) + wdurations.at(-1) : 0;
      const start = performance.now() + 60;
      wordWindows = wtimes.map((t, i) => [start + t, start + t + wdurations[i]]);
      speechEndsAt = start + total;
      setTalking(true);
      head.lookAtCamera(total + 500);
      if (!audio) { // néma puffer: a TalkingHead csak audio mellett animál
        const ac = head.audioCtx;
        audio = ac.createBuffer(1, Math.max(1, Math.ceil(ac.sampleRate * (total + 300) / 1000)), ac.sampleRate);
      }
      head.speakAudio({ audio, words, wtimes, wdurations }, { lipsyncLang });
      return total;
    },
    stopSpeaking() { try { head.stopSpeaking(); } catch {} setTalking(false); },

    setThinking(on) {
      thinking = on;
      root.classList.toggle("thinking", on);
      if (!talking) elState.textContent = on ? "PROCESSING…" : "IDLE · LISTENING";
    },
    setMood(m) {
      if (!(m in MOODS)) m = "neutral";
      if (m !== mood) { root.classList.remove("glitch"); void root.offsetWidth; root.classList.add("glitch"); }
      mood = m;
      document.documentElement.style.setProperty("--mood-h", MOODS[m].hue);
      uGlow.value.setHSL(MOODS[m].hue / 360, 1, 0.66);
      elMood.textContent = m.toUpperCase();
      if (ready) { try { head.setMood(MOODS[m].th); } catch {} }
      return MOODS[m].hue;
    },
    gesture(name) { if (ready) { try { head.playGesture(name, 2.5); } catch {} } },
    get mood() { return mood; },
  };
}
