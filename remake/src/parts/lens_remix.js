// LNS&ZOOM, remixed. The face picture (palette 1..31 skin, 32..47 eyes,
// 48..63 bubbles) becomes a bronze-skinned relief: inflated from its
// silhouette plus the painting's own light as fine relief, eyes glowing.
// The bubbles are found as blobs and become real glass beads on the plate.
// The chevron wipe reveals the relief with a hot edge; the lens is a
// raytraced glass sphere on the original path (clouded glass clearing as
// the original's fade2 runs); the rotozoomer is the relief tiled on a plate
// (the original's 256-wide torus cut) under the same texture walk.
import { sdf, resample, blur } from '../gfx/sdf.js';
import { GLSL_NOISE, getNoise } from '../gfx/remix.js';

const GW = 640, GH = 480;    // world: x = px (0..320), y = py*1.2 (0..240); 2 cells/unit

const COMMON = `
uniform sampler2D uH;        // height (r), albedo-ish unused
uniform sampler2D uAlb;      // painting
uniform sampler2D uEye;      // eye glow mask (r)
float H(vec2 w){ return textureLod(uH, w / vec2(320.0, 240.0), 0.0).r; }
vec3 N(vec2 w){
  float e = 0.6;
  float hx = H(w + vec2(e, 0.0)) - H(w - vec2(e, 0.0));
  float hy = H(w + vec2(0.0, e)) - H(w - vec2(0.0, e));
  return normalize(vec3(-hx, -hy, -2.0 * e));   // plate faces -z (towards the viewer)
}
`;

export const FACE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${COMMON}
${GLSL_NOISE}
uniform vec4 uBub[12]; uniform int uNB;       // bead centre (world), radius
uniform vec4 uLens;                           // lens centre (world xy), z, radius (0 = none)
uniform float uClear;                         // lens clarity 0..1
uniform vec3 uTint;
uniform float uSteps;                         // wipe progress (<0: no wipe)
uniform float uTime;
uniform vec3 uLight;
const float D = 700.0;
const float HMAX = 60.0;
// the original's wipe: two cursors per row
vec2 span(float y, float yc){
  float st = 170.0 + (100.0 - yc) * 50.0 / 64.0;
  float a1 = float((23 + int(y) / 5) & ~7) / 64.0;
  float a2 = float((-(23 + (199 - int(y)) / 5)) & ~7) / 64.0;
  return vec2(st + a2 * uSteps, st + a1 * uSteps + 1.0);
}
float wipeMask(vec2 p, out float edge){
  edge = 0.0;
  if (uSteps < 0.0) return 1.0;
  float y = clamp(floor(p.y), 0.0, 199.0), yc = p.y - 0.5;
  vec2 s = span(y, yc);
  float w = 1.5;
  float m = smoothstep(s.x - w, s.x + w, p.x) * (1.0 - smoothstep(s.y - w, s.y + w, p.x));
  if (y > 0.0) { vec2 u = span(y - 1.0, yc - 1.0); m = max(m, 1.0 - smoothstep(u.y - 320.0 - w, u.y - 320.0 + w, p.x)); }
  if (y < 199.0) { vec2 d = span(y + 1.0, yc + 1.0); m = max(m, smoothstep(d.x + 320.0 - w, d.x + 320.0 + w, p.x)); }
  edge = exp(-pow(min(abs(p.x - s.x), abs(p.x - s.y)) / 3.0, 2.0)) * step(uSteps, 470.0);
  return m;
}
// relief intersection from above the plate
bool relief(vec3 ro, vec3 rd, out vec3 hit){
  float t0 = (-HMAX - ro.z) / rd.z, t1 = (0.5 - ro.z) / rd.z;
  float t = max(t0, 0.0), dt = (t1 - t) / 64.0;
  float lt = t;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    if (p.z >= -H(p.xy)) {
      float a = lt, b = t;
      for (int k = 0; k < 6; k++) { float m = 0.5 * (a + b); vec3 q = ro + rd * m; if (q.z >= -H(q.xy)) b = m; else a = m; }
      hit = ro + rd * b; return true;
    }
    lt = t; t += dt;
  }
  hit = ro + rd * t1; return false;
}
vec3 env(vec3 r){
  vec3 c = vec3(0.01, 0.012, 0.02) + vec3(0.05, 0.04, 0.03) * max(-r.z, 0.0);
  c += vec3(2.2, 1.9, 1.6) * pow(max(dot(r, normalize(uLight)), 0.0), 60.0);
  c += vec3(0.25, 0.35, 0.6) * pow(max(dot(r, normalize(vec3(0.7, 0.4, -0.6))), 0.0), 8.0) * 0.4;
  return c;
}
vec3 shadePlate(vec3 p, vec3 rd, float lit){
  vec2 w = p.xy;
  vec2 uv = w / vec2(320.0, 240.0);
  float h = H(w);
  vec3 alb = pow(texture(uAlb, uv).rgb, vec3(2.2));
  if (h <= 0.01) {
    // black lacquered plate with a faint grain
    return vec3(0.004, 0.004, 0.006) + env(reflect(rd, vec3(0.0, 0.0, -1.0))) * 0.04 * lit;
  }
  vec3 n = N(w);
  vec3 L = normalize(uLight);
  float ndl = max(dot(n, L), 0.0);
  vec3 v = -rd;
  vec3 hh = normalize(L + v);
  // bronze skin: the painting's colour as base, lit gently, with a metal sheen
  vec3 c = alb * (0.45 + 1.1 * ndl) * lit;
  c += mix(alb, vec3(1.0), 0.3) * pow(max(dot(n, hh), 0.0), 50.0) * 1.2 * lit;
  c += alb * env(reflect(rd, n)) * 0.6 * lit;
  float eye = texture(uEye, uv).r;
  c += vec3(2.4, 1.5, 0.25) * eye * (0.8 + 0.2 * sin(uTime * 3.0));
  return c;
}
// glass bead or lens: returns colour, updates alpha
vec3 glassSphere(vec3 ro, vec3 rd, vec4 S, float clear, vec3 tint, float lit, out float hitT){
  hitT = -1.0;
  vec3 oc = ro - S.xyz; float b = dot(oc, rd), c = dot(oc, oc) - S.w * S.w, h = b * b - c;
  if (h < 0.0) return vec3(0.0);
  float t = -b - sqrt(h);
  if (t < 0.0) return vec3(0.0);
  hitT = t;
  vec3 p = ro + rd * t, n = normalize(p - S.xyz);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  vec3 r1 = refract(rd, n, 1.0 / 1.5);
  vec3 oc2 = p - S.xyz; float b2 = dot(oc2, r1);
  float t2 = -b2 + sqrt(max(b2 * b2 - (dot(oc2, oc2) - S.w * S.w), 0.0));
  vec3 q = p + r1 * t2, n2 = normalize(q - S.xyz);
  vec3 r2 = refract(r1, -n2, 1.5);
  if (dot(r2, r2) < 1e-4) r2 = reflect(r1, -n2);
  vec3 hp; relief(q, r2, hp);
  vec3 through = shadePlate(hp, r2, lit);
  vec3 milky = tint * (0.4 + 0.6 * max(dot(n, normalize(uLight)), 0.0)) * lit;
  vec3 col = mix(milky, through * mix(vec3(1.0), tint * 1.6 + 0.3, 0.5), clear);
  col += env(reflect(rd, n)) * F * 2.0;
  // rim of light inside the glass
  col += tint * pow(1.0 - max(dot(-rd, n), 0.0), 3.0) * 0.4 * lit;
  return col;
}
void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec3 ro = vec3(160.0, 120.0, -D);
  vec3 tg = vec3(s.x, s.y * 1.2, 0.0);
  vec3 rd = normalize(tg - ro);
  float edge;
  float m = wipeMask(s, edge);
  vec3 hp;
  relief(ro, rd, hp);
  vec3 col = shadePlate(hp, rd, m);
  float bestT = length(hp - ro);
  // beads
  for (int i = 0; i < 12; i++) {
    if (i >= uNB) break;
    float tt;
    vec3 c = glassSphere(ro, rd, uBub[i], 0.55, vec3(0.45, 0.55, 0.9), m, tt);
    if (tt > 0.0 && tt < bestT) { col = c; bestT = tt; }
  }
  // the lens, and its shadow/caustic on the plate
  if (uLens.w > 0.0) {
    float tt;
    vec3 c = glassSphere(ro, rd, vec4(uLens.xy, uLens.z, uLens.w), uClear, uTint, 1.0, tt);
    if (tt > 0.0 && tt < bestT) { col = c; bestT = tt; }
    else {
      // projected along the light: shade ring with a focused hot spot
      vec3 L = normalize(uLight);
      vec3 p = ro + rd * bestT;
      vec3 d = p - vec3(uLens.xy, uLens.z);
      vec3 perp = d - L * dot(d, L);
      float r = length(perp) / uLens.w;
      if (dot(d, L) < 0.0) {
        col *= mix(1.0, 0.55 + 0.45 * smoothstep(0.7, 1.0, r), step(r, 1.05) * uClear);
        col += uTint * 3.0 * exp(-r * r * 30.0) * uClear;
      }
    }
  }
  col += vec3(1.6, 0.9, 0.4) * edge * 2.0;
  o = vec4(col, 1.0);
}`;

// the rotozoomer: the relief tiled on a plate, same texture walk
export const ROTO_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${GLSL_NOISE}
uniform sampler2D uTH, uTA, uTE;   // tile: height, albedo, eyes (256 x 220, repeating in x)
uniform vec4 uPath;
uniform vec2 uFade;
uniform float uTime;
float Ht(vec2 T){ return texture(uTH, T / vec2(256.0, 256.0)).r; }
void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * vec2(320.0, 200.0);
  float c = p.x * 0.5 + 0.5, r = p.y * 0.5 + 0.5;
  float K = 307.0 / 262144.0, J = 1.0 / 1024.0;
  vec2 T = uPath.xy + r * K * uPath.zw + c * J * vec2(uPath.w, -uPath.z);
  // texture-space derivatives give the local scale; normals from the height tile
  vec2 dTx = dFdx(T), dTy = dFdy(T);
  float e = 0.7;
  float hx = Ht(T + vec2(e, 0.0)) - Ht(T - vec2(e, 0.0));
  float hy = Ht(T + vec2(0.0, e)) - Ht(T - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx, -hy, -2.0 * e));
  // screen-aligned light that circles slowly
  vec2 ax = normalize(vec2(uPath.w, -uPath.z)), ay = normalize(uPath.zw);
  float a = uTime * 0.4;
  vec2 ls = vec2(cos(a), sin(a));
  vec3 L = normalize(vec3(ax * ls.x + ay * ls.y, -1.1));
  vec3 alb = pow(textureGrad(uTA, T / vec2(256.0, 256.0), dTx / 256.0, dTy / 256.0).rgb, vec3(2.2));
  float h = Ht(T);
  vec3 col;
  if (h <= 0.01) col = vec3(0.005, 0.005, 0.008);
  else {
    float ndl = max(dot(n, L), 0.0);
    vec3 hh = normalize(L + vec3(0.0, 0.0, -1.0));
    col = alb * (0.45 + 1.1 * ndl) + mix(alb, vec3(1.0), 0.3) * pow(max(dot(n, hh), 0.0), 50.0) * 1.2;
  }
  col += vec3(2.4, 1.5, 0.25) * textureGrad(uTE, T / vec2(256.0, 256.0), dTx / 256.0, dTy / 256.0).r;
  col += vec3(uFade.x) * 1.5;
  o = vec4(col, 1.0);
}`;

export class LensScene {
  constructor(R, A) {
    const gl = R.gl;
    const pic = A.pic('lens.back');
    const W = 320, Hh = 200, pix = pic.pix, pal = pic.pal, N = W * Hh;
    const face = new Float32Array(N), eye = new Float32Array(N), bub = new Uint8Array(N), lum = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const c = pix[i];
      face[i] = c >= 1 && c <= 47 ? 1 : 0;
      eye[i] = c >= 32 && c <= 47 ? Math.min(1, (c - 32) / 12) : 0;
      bub[i] = c >= 48 && c <= 63 ? 1 : 0;
      lum[i] = (pal[c * 3] + pal[c * 3 + 1] + pal[c * 3 + 2]) / 189;
    }
    // world grid 640x480 over 320x240 units (VGA rows stretched 1.2)
    const up = (m) => resample(m, W, Hh, GW, GH);
    const cell = 0.5;
    const fm = blur(up(face), GW, GH, 1, 2);
    const bin = new Uint8Array(GW * GH);
    for (let i = 0; i < bin.length; i++) bin[i] = fm[i] >= 0.5 ? 1 : 0;
    const S = sdf(bin, GW, GH);
    const L = blur(up(lum), GW, GH, 2, 2);
    const height = new Float32Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) {
      const d = -S[i] * cell;
      if (d <= 0) { height[i] = 0; continue; }
      const k = Math.min(1, d / 55);
      height[i] = 46 * Math.sqrt(1 - (1 - k) * (1 - k)) + (L[i] - 0.45) * 22 * Math.min(1, d / 6);
      height[i] = Math.max(0.02, height[i]);
    }
    this.hTex = R.texture(GW, GH, { internal: gl.R16F, format: gl.RED, type: gl.FLOAT, data: height, filter: gl.LINEAR });
    const rgba = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) { const c = pix[i]; for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(pal[c * 3 + k] * 255 / 63); rgba[i * 4 + 3] = 255; }
    // push face colours out over the edge so the silhouette never samples black
    const lay = Uint8Array.from(face);
    for (let it = 0; it < 3; it++) {
      const src = rgba.slice(), l0 = lay.slice();
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (l0[i]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= Hh) continue;
          const j = Y * W + X; if (l0[j]) { for (let k = 0; k < 3; k++) rgba[i * 4 + k] = src[j * 4 + k]; lay[i] = 1; break; }
        }
      }
    }
    this.aTex = R.texture(W, Hh, { data: rgba, filter: gl.LINEAR });
    const eyeB = blur(eye, W, Hh, 1, 1);
    const e8 = new Uint8Array(N); for (let i = 0; i < N; i++) e8[i] = Math.min(255, eyeB[i] * 300);
    this.eTex = R.texture(W, Hh, { internal: gl.R8, format: gl.RED, data: e8, filter: gl.LINEAR });
    // bubble blobs -> beads (connected components)
    const lab = new Int32Array(N).fill(-1);
    const beads = [];
    for (let i = 0; i < N; i++) {
      if (!bub[i] || lab[i] >= 0) continue;
      const st = [i]; lab[i] = beads.length;
      let n = 0, sx = 0, sy = 0;
      while (st.length) {
        const j = st.pop(); const x = j % W, y = (j / W) | 0;
        n++; sx += x; sy += y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= Hh) continue;
          const k = Y * W + X; if (bub[k] && lab[k] < 0) { lab[k] = beads.length; st.push(k); }
        }
      }
      if (n > 12) { const r = Math.sqrt(n * 1.2 / Math.PI); beads.push([sx / n + 0.5, (sy / n + 0.5) * 1.2, -r * 0.9, r]); }
    }
    this.beads = new Float32Array(48);
    beads.slice(0, 12).forEach((b, i) => this.beads.set(b, i * 4));
    this.nb = Math.min(12, beads.length);
    // beads as domes (for the tiled plate, where they are part of the relief)
    const hb = Float32Array.from(height);
    for (let i = 0; i < this.nb; i++) {
      const bx = this.beads[i * 4], by = this.beads[i * 4 + 1], br = this.beads[i * 4 + 3];
      for (let gy = Math.max(0, Math.floor((by - br) * 2)); gy < Math.min(GH, Math.ceil((by + br) * 2)); gy++)
        for (let gx = Math.max(0, Math.floor((bx - br) * 2)); gx < Math.min(GW, Math.ceil((bx + br) * 2)); gx++) {
          const dx = gx / 2 - bx, dy = gy / 2 - by, d2 = br * br - dx * dx - dy * dy;
          if (d2 > 0) hb[gy * GW + gx] = Math.max(hb[gy * GW + gx], Math.sqrt(d2) * 0.9);
        }
    }
    // rotozoom tile: rotpic[x + y*256] = back[x+32 + (y*10/11-18)*320]
    const tH = new Float32Array(256 * 256), tA = new Uint8Array(256 * 256 * 4), tE = new Uint8Array(256 * 256);
    for (let y = 0; y < 256; y++) {
      const sy = y * 10 / 11 - 18;
      for (let x = 0; x < 256; x++) {
        const sx = x + 32;
        const syc = Math.max(0, Math.min(199, sy));
        const gx = Math.min(GW - 1, Math.round(sx * 2)), gy = Math.min(GH - 1, Math.max(0, Math.round(syc * 2.4)));
        tH[y * 256 + x] = sy < 0 || sy > 199 ? 0 : hb[gy * GW + gx];
        const si = Math.round(syc) * W + sx;
        for (let k = 0; k < 4; k++) tA[(y * 256 + x) * 4 + k] = sy < 0 || sy > 199 ? (k === 3 ? 255 : 0) : rgba[si * 4 + k];
        tE[y * 256 + x] = sy < 0 || sy > 199 ? 0 : e8[si];
      }
    }
    const rep = { wrap: gl.REPEAT };
    this.tH = R.texture(256, 256, { internal: gl.R16F, format: gl.RED, type: gl.FLOAT, data: tH, filter: gl.LINEAR, ...rep });
    this.tA = R.texture(256, 256, { data: tA, filter: gl.LINEAR, mipmap: true, ...rep });
    this.tE = R.texture(256, 256, { internal: gl.R8, format: gl.RED, data: tE, filter: gl.LINEAR, ...rep });
    this.face = R.fsProgram(FACE_FS);
    this.roto = R.fsProgram(ROTO_FS);
    this.noise = getNoise(R);
  }

  drawFace(R, o) {
    this.face.use().tex('uH', this.hTex).tex('uAlb', this.aTex).tex('uEye', this.eTex).tex('uNoise', this.noise)
      .fv('uBub', this.beads, 4).i('uNB', this.nb)
      .f('uLens', ...(o.lens || [0, 0, 0, 0])).f('uClear', o.clear ?? 1).f('uTint', ...(o.tint || [0.5, 0.6, 1]))
      .f('uSteps', o.steps ?? -1).f('uTime', o.time || 0).f('uLight', ...(o.light || [-0.5, -0.6, -1]));
    R.drawFullscreen();
  }

  drawRoto(R, o) {
    this.roto.use().tex('uTH', this.tH).tex('uTA', this.tA).tex('uTE', this.tE).tex('uNoise', this.noise)
      .f('uPath', ...o.path).f('uFade', ...o.fade).f('uTime', o.time);
    R.drawFullscreen();
  }
}
