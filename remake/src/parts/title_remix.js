// The title picture, remixed as a small ice sculpture scene. The picture's
// palette separates its layers cleanly (creature 16..31, letter faces
// 32..48, extrusion 49..58, frost 71..79), so the masks are cut from the
// original art: the letters become bevelled, extruded frosted-ice solids
// (the parts the creature covers are filled back in by a closing), the
// creature an inflated ice relief carrying the picture's own shading, the
// frost a drifting mist layer; all standing on a white card.
// Used by BEGLOGO (fade from white) and by GLENZ's opening, where the
// original's closing curtains are exactly a rotation of the picture about
// row 267 (of 400): here the card really tilts away.
import { sdf, edt, resample, blur } from '../gfx/sdf.js';
import { GLSL_NOISE, getNoise } from '../gfx/remix.js';

const GW = 800, GH = 600;              // field grid: 1.5 cells per world unit
const HX = 800 / 3, HY = 200;          // half extent in world units (533 x 400)
export const PIVOT_Y = 200 - 267;      // tilt axis (world y)

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uF;      // letters sdf, creature sdf, creature height, frost
uniform sampler2D uAlb;    // picture colours
uniform float uTilt;       // radians, top away from the viewer
uniform float uCard;       // card brightness (1 = white, the original's grey mix below)
uniform float uKey;        // key light strength
uniform float uTime;
${GLSL_NOISE}
const vec2 HALF = vec2(${HX.toFixed(4)}, ${HY.toFixed(1)});
const float PIV = ${PIVOT_Y.toFixed(1)};
const float D = 1500.0;
const float LZ = 22.0;      // letter depth
const float CB = 8.0;       // creature back plane (in front of the letters)
const float CARDZ = 34.0;   // the white card behind
const vec3 LD = normalize(vec3(-0.45, 0.62, -0.64));   // towards the key light
vec4 field(vec2 p){
  vec2 uv = vec2((p.x + HALF.x) / (2.0 * HALF.x), (HALF.y - p.y) / (2.0 * HALF.y));
  return textureLod(uF, uv, 0.0);
}
float boxOut(vec2 p){ return length(max(abs(p) - HALF, 0.0)); }
// scene in the card's local frame; m: 1 letters, 2 creature
float map(vec3 p, out int m){
  vec4 f = field(p.xy);
  float ob = boxOut(p.xy);
  vec2 e = vec2(f.r + 3.0 + ob, abs(p.z + LZ * 0.5) - LZ * 0.5);
  float dl = min(max(e.x, e.y), 0.0) + length(max(e, 0.0)) - 3.0;
  float h = max(f.b, 0.0);
  float zf = -(CB + h);
  float dc = max(f.g + ob, max(p.z + CB, zf - p.z) * 0.6);
  m = dl < dc ? 1 : 2;
  return min(dl, dc);
}
float mapD(vec3 p){ int m; return map(p, m); }
vec3 normal(vec3 p){
  vec2 k = vec2(0.6, -0.6);
  return normalize(k.xyy * mapD(p + k.xyy) + k.yyx * mapD(p + k.yyx) + k.yxy * mapD(p + k.yxy) + k.xxx * mapD(p + k.xxx));
}
float softShadow(vec3 p, vec3 l){
  float s = 1.0, t = 1.5;
  for (int i = 0; i < 40; i++) {
    float d = mapD(p + l * t);
    s = min(s, 10.0 * d / t);
    t += clamp(d, 0.8, 30.0);
    if (s < 0.01 || t > 400.0) break;
  }
  return clamp(s, 0.0, 1.0);
}
float ao(vec3 p, vec3 n){
  float a = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) { float h = float(i) * 5.0; a += w * (h - mapD(p + n * h)); w *= 0.6; }
  return clamp(1.0 - a * 0.025, 0.0, 1.0);
}
vec3 env(vec3 r){
  // white studio: bright overhead, soft horizon, a big softbox on the left
  float up = r.y * 0.5 + 0.5;
  vec3 c = mix(vec3(0.55, 0.58, 0.66), vec3(1.25, 1.28, 1.35), up);
  c += vec3(2.5) * smoothstep(0.75, 0.95, dot(r, normalize(vec3(-0.6, 0.5, -0.6))));
  return c * mix(0.25, 1.0, uCard);
}
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }
void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 400.0);
  vec3 rdW = normalize(vec3((s.x - 160.0) * 5.0 / 3.0, 200.0 - s.y, D));
  vec3 roW = vec3(0.0, 0.0, -D);
  // world -> card frame: rotate about the pivot line
  mat3 Rw = rotX(uTilt);         // card -> world
  mat3 Rl = transpose(Rw);
  vec3 pv = vec3(0.0, PIV, 0.0);
  vec3 ro = Rl * (roW - pv) + pv, rd = Rl * rdW;
  vec3 L = Rl * LD;
  // bound: the slab z in [-(CB+60), CARDZ]
  float t0 = (-(CB + 70.0) - ro.z) / rd.z, t1 = (CARDZ - ro.z) / rd.z;
  if (t0 > t1) { float tt = t0; t0 = t1; t1 = tt; }
  t0 = max(t0, 0.0);
  vec3 col = vec3(0.0);
  float t = t0; bool hit = false; int m = 0;
  if (t1 > 0.0) {
    for (int i = 0; i < 160; i++) {
      vec3 p = ro + rd * t;
      float d = map(p, m);
      if (d < 0.05 * (1.0 + t / 2000.0)) { hit = true; break; }
      t += d;
      if (t > t1) break;
    }
  }
  float frost = 0.0;
  // the frost mist lies in a layer just in front of the creature
  float tf = (-(CB + 26.0) - ro.z) / rd.z;
  if (tf > 0.0 && (!hit || tf < t)) {
    vec3 pf = ro + rd * tf;
    if (boxOut(pf.xy) <= 0.0) {
      float n = fbm2(pf.xy / 18.0 + vec2(uTime * 0.25, 0.0), 4);
      frost = field(pf.xy).a * (0.6 + 0.8 * n);
    }
  }
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = normal(p);
    vec3 v = -rd;
    float sh = softShadow(p + n * 0.8, L);
    float a = ao(p, n);
    vec3 alb;
    float rough;
    if (m == 1) {
      alb = vec3(0.22, 0.30, 0.78);
      rough = 0.25;
    } else {
      vec2 uv = vec2((p.x + HALF.x) / (2.0 * HALF.x), (HALF.y - p.y) / (2.0 * HALF.y));
      alb = pow(texture(uAlb, uv).rgb, vec3(2.4)) * vec3(0.62, 0.72, 0.95);
      rough = 0.35;
    }
    float nl = dot(n, L);
    // frosted ice: wrapped diffuse (light scattered inside), soft spec, Fresnel env
    float wrap = max((nl + 0.35) / 1.35, 0.0);
    vec3 diff = alb * (wrap * sh * uKey * 1.9 + 0.22 * a * env(n) * 0.6);
    vec3 h = normalize(L + v);
    float spec = pow(max(dot(n, h), 0.0), 2.0 / (rough * rough * rough) ) * (1.0 / (rough * 6.0));
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    // light passing through thin parts
    float thin = m == 1 ? 0.35 : 0.2;
    vec3 trans = alb * vec3(0.7, 0.85, 1.0) * max(-nl, 0.0) * thin * uKey;
    col = diff + trans + spec * sh * uKey * 1.6 + env(reflect(-v, n)) * F * a * 0.8;
  } else {
    // the card
    float tc = (CARDZ - ro.z) / rd.z;
    vec3 pc = ro + rd * tc;
    if (tc > 0.0 && all(lessThan(abs(pc.xy), HALF * 1.06))) {
      vec3 n = vec3(0.0, 0.0, -1.0);
      float sh = softShadow(pc + n * 0.5, L);
      float lit = max(dot(n, L), 0.0) * sh * uKey * 1.25 + 0.55;
      col = vec3(0.96, 0.97, 1.0) * lit * uCard;
    }
  }
  col = mix(col, vec3(1.1, 1.15, 1.25) * mix(0.3, 1.0, uCard), clamp(frost, 0.0, 1.0) * 0.55);
  o = vec4(col, 1.0);
}`;

let shared = null;

export class TitleScene {
  static get(R, A) { return shared || (shared = new TitleScene(R, A)); }

  constructor(R, A) {
    const gl = R.gl;
    const pic = A.pic('beg.title');
    const W = pic.w, H = pic.h, pix = pic.pix, pal = pic.pal;
    const N = W * H;
    const face = new Uint8Array(N), crea = new Uint8Array(N), frost = new Float32Array(N), lum = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const c = pix[i];
      face[i] = c >= 32 && c <= 48 ? 1 : 0;
      crea[i] = c >= 16 && c <= 31 ? 1 : 0;
      frost[i] = c >= 71 && c <= 79 ? 1 : 0;
      lum[i] = (pal[c * 3] + pal[c * 3 + 1] + pal[c * 3 + 2]) / 189;
    }
    // fill the letter parts hidden behind the creature: closing (radius 8)
    const dOut = edt(face, W, H);
    const dil = new Uint8Array(N);
    for (let i = 0; i < N; i++) dil[i] = dOut[i] <= 8 ? 1 : 0;
    const inv = new Uint8Array(N);
    for (let i = 0; i < N; i++) inv[i] = dil[i] ? 0 : 1;
    const dIn = edt(inv, W, H);
    const letters = new Float32Array(N);
    for (let i = 0; i < N; i++) letters[i] = face[i] || (crea[i] && dIn[i] > 8) ? 1 : 0;
    // to the square world grid
    const up = (m) => resample(m, W, H, GW, GH);
    const bin = (f) => { const b = new Uint8Array(GW * GH); for (let i = 0; i < b.length; i++) b[i] = f[i] >= 0.5 ? 1 : 0; return b; };
    const cell = (2 * HX) / GW; // world units per cell
    // smooth the pixel steps away before thresholding
    const L = sdf(bin(blur(up(letters), GW, GH, 2, 2)), GW, GH);
    const cm = bin(blur(up(Float32Array.from(crea)), GW, GH, 1, 2));
    const C = sdf(cm, GW, GH);
    // creature height: inflated from its silhouette, plus the picture's shading
    const lumG = blur(up(lum), GW, GH, 1, 2);
    const Hh = new Float32Array(GW * GH);
    const R0 = 34;
    for (let i = 0; i < GW * GH; i++) {
      const d = -C[i] * cell;
      if (d <= 0) { Hh[i] = -1; continue; }
      const k = Math.min(1, d / R0);
      Hh[i] = 42 * Math.sqrt(1 - (1 - k) * (1 - k)) + (lumG[i] - 0.75) * 16 * k;
    }
    const F = blur(up(frost), GW, GH, 4, 3);
    const data = new Float32Array(GW * GH * 4);
    for (let i = 0; i < GW * GH; i++) {
      data[i * 4] = L[i] * cell;
      data[i * 4 + 1] = C[i] * cell;
      data[i * 4 + 2] = Hh[i];
      data[i * 4 + 3] = Math.min(1, F[i] * 1.6);
    }
    this.field = R.texture(GW, GH, { internal: gl.RGBA16F, format: gl.RGBA, type: gl.FLOAT, data, filter: gl.LINEAR });
    // albedo: the picture colours, lifted a little inside the creature
    const rgba = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      const c = pix[i];
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(pal[c * 3 + k] * 255 / 63);
      rgba[i * 4 + 3] = 255;
    }
    this.alb = R.texture(W, H, { data: rgba, filter: gl.LINEAR });
    this.prog = R.fsProgram(FS);
    this.noise = getNoise(R);
  }

  draw(R, { tilt = 0, card = 1, key = 1, time = 0 } = {}) {
    this.prog.use().tex('uF', this.field).tex('uAlb', this.alb).tex('uNoise', this.noise)
      .f('uTilt', tilt).f('uCard', card).f('uKey', key).f('uTime', time);
    R.drawFullscreen();
  }
}
