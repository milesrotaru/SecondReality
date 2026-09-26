// LNS&ZOOM (Psi) - the bald face: a chevron wipe reveals it, a glass lens
// bounces across it, then the whole picture becomes a rotozoomer.
// LENS/MAIN.C + ASM.ASM + CALC.C.
// HD: the lens refraction is evaluated analytically per pixel from the formula
// CALC.C baked into its offset tables; the hand-drawn lens regions (glass,
// highlight arc, bright spot) are smoothed and thresholded so their outlines
// stay clean at any resolution; the rotozoomer samples the picture bicubically
// with a continuous texture walk instead of 2x4-pixel blocks.
import { FPS } from '../demo.js';
import { GLSL_BICUBIC } from '../gfx/common.js';
import { palToRGBA } from '../gfx/gl.js';
import { LensScene } from './lens_remix.js';

const COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${GLSL_BICUBIC}
vec2 vga(){ return vec2(vUv.x, 1.0 - vUv.y) * vec2(320.0, 200.0); }
`;

// part 1: two cursors per row copy picture pixels outwards (6 steps/frame)
const WIPE_FS = COMMON + `
uniform sampler2D uBack;
uniform float uSteps;
// cursor span of row y after s steps; right cursor may spill into row y+1,
// left cursor into row y-1 (they write through the linear framebuffer)
vec2 span(float y, float yc){
  float st = 170.0 + (100.0 - yc) * 50.0 / 64.0;
  float a1 = float((23 + int(y) / 5) & ~7) / 64.0;
  float a2 = float((-(23 + (199 - int(y)) / 5)) & ~7) / 64.0;
  return vec2(st + a2 * uSteps, st + a1 * uSteps + 1.0);
}
void main(){
  vec2 p = vga();
  float y = clamp(floor(p.y), 0.0, 199.0);
  float yc = p.y - 0.5;
  float w = fwidth(p.x) * 0.5;
  vec2 s = span(y, yc);
  float m = smoothstep(s.x - w, s.x + w, p.x) * (1.0 - smoothstep(s.y - w, s.y + w, p.x));
  if (y > 0.0) { vec2 u = span(y - 1.0, yc - 1.0); m = max(m, 1.0 - smoothstep(u.y - 320.0 - w, u.y - 320.0 + w, p.x)); }
  if (y < 199.0) { vec2 d = span(y + 1.0, yc + 1.0); m = max(m, smoothstep(d.x + 320.0 - w, d.x + 320.0 + w, p.x)); }
  vec3 c = clamp(texBicubic(uBack, p / vec2(320.0, 200.0)).rgb, 0.0, 1.0);
  o = vec4(c * m, 1.0);
}`;

// part 2: the lens. Refraction from CALC.C: d' = d * 250 / (59^2+50^2 - |d|^2)^0.69
// with y scaled 9/8; three tint layers (palette 64+/128+/192+ = picture + tint).
const LENS_FS = COMMON + `
uniform sampler2D uBack, uMask;
uniform vec2 uC;          // lens centre (VGA pixels)
uniform vec3 uT1, uT2, uT3; // tints
uniform float uA;         // fade2 level 0..31 (picture shows through the glass)
vec3 back(vec2 p){ return clamp(texBicubic(uBack, p / vec2(320.0, 200.0)).rgb, 0.0, 1.0); }
void main(){
  vec2 p = vga();
  vec3 c = back(p);
  vec2 d = p - uC;
  vec2 mu = (d + vec2(76.5, 58.5)) / vec2(152.0, 116.0);
  if (all(greaterThan(mu, vec2(0.0))) && all(lessThan(mu, vec2(1.0)))) {
    vec3 f = texture(uMask, mu).rgb;
    vec3 w = max(fwidth(f), vec3(1e-3));
    vec3 lv = smoothstep(0.5 - w, 0.5 + w, f);
    if (lv.x > 0.0) {
      float now = max(5981.0 - (d.x * d.x + d.y * d.y * 1.265625), 1.0);
      vec2 src = uC + d * (250.0 / pow(now, 0.69));
      vec3 s = back(src);
      vec3 tint = mix(mix(uT1, uT2, lv.y), uT3, lv.z);
      vec3 g = min(s + tint, vec3(1.0)) - s * (31.0 - uA) / 31.0;
      c = mix(c, g, lv.x);
    }
  }
  o = vec4(c, 1.0);
}`;

// part 3: rotozoomer over a 256x256 torus cut from the picture
// (rotpic[x+y*256] = back[x+32 + (y*10/11-18)*320]); 160x100 samples in the
// original, row step scaled 307/256 for the tweaked mode's aspect.
const ROT_FS = COMMON + `
uniform sampler2D uRot;
uniform vec4 uPath;   // x, y, xa, ya
uniform vec2 uFade;   // flash add, white mix
void main(){
  vec2 p = vga();
  float c = p.x * 0.5 + 0.5, r = p.y * 0.5 + 0.5;   // (col+1), (row+1)
  float K = 307.0 / 262144.0, J = 1.0 / 1024.0;
  vec2 T = uPath.xy + r * K * uPath.zw + c * J * vec2(uPath.w, -uPath.z);
  float yy = T.y - 256.0 * floor(T.y / 256.0);
  vec2 uv = vec2(T.x / 256.0, (yy * 10.0 / 11.0 - 18.0) / 200.0);
  vec2 k = vec2(1.0 / 256.0, 10.0 / 11.0 / 200.0);   // LOD from the unwrapped walk
  vec3 col = clamp(texBicubicGrad(uRot, uv, dFdx(T) * k, dFdy(T) * k).rgb, 0.0, 1.0);
  col = min(col + uFade.x, vec3(1.0));
  col = mix(col, vec3(1.0), uFade.y);
  o = vec4(col, 1.0);
}`;

// binary level fields -> 4x upsampled, gaussian-smoothed RGB (R: glass, G: arc, B: spot)
function smoothMask(mask, w, h, k = 4, sigma = 0.85) {
  const W = w * k, H = h * k;
  const out = new Uint8Array(W * H * 4);
  const rad = Math.ceil(sigma * k * 3);
  const g = []; let gs = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * (sigma * k) ** 2)); g.push(v); gs += v; }
  for (let i = 0; i < g.length; i++) g[i] /= gs;
  for (let lvl = 1; lvl <= 3; lvl++) {
    const a = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = mask[Math.floor(y / k) * w + Math.floor(x / k)];
      a[y * W + x] = v >= lvl && v <= 3 ? 1 : 0;
    }
    const b = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) { const xx = Math.min(W - 1, Math.max(0, x + i)); s += a[y * W + xx] * g[i + rad]; }
      b[y * W + x] = s;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) { const yy = Math.min(H - 1, Math.max(0, y + i)); s += b[yy * W + x] * g[i + rad]; }
      out[(y * W + x) * 4 + lvl - 1] = Math.round(s * 255);
    }
  }
  for (let i = 0; i < W * H; i++) out[i * 4 + 3] = 255;
  return { data: out, w: W, h: H };
}

export default {
  name: 'Lens',
  credit: 'Psi',

  init(R, A) {
    const gl = R.gl;
    const pic = A.pic('lens.back');
    const rgba = palToRGBA(pic.pix, pic.pal);
    this.backTex = R.texture(320, 200, { data: rgba, filter: gl.LINEAR });
    this.A = A;
    // torus source: columns 32..287 of the picture, repeating horizontally
    const crop = new Uint8Array(256 * 200 * 4);
    for (let y = 0; y < 200; y++) crop.set(rgba.subarray((y * 320 + 32) * 4, (y * 320 + 288) * 4), y * 256 * 4);
    this.rotTex = R.texture(256, 200, { data: crop, filter: gl.LINEAR, mipmap: true, wrapS: gl.REPEAT, wrapT: gl.CLAMP_TO_EDGE });
    const mm = A.meta('lens.mask');
    const sm = smoothMask(A.bytes('lens.mask'), mm.w, mm.h);
    this.maskTex = R.texture(sm.w, sm.h, { data: sm.data, filter: gl.LINEAR });
    this.tints = [0, 1, 2].map((i) => mm.tints.slice(i * 3, i * 3 + 3).map((v) => v / 63));
    this.path1 = A.i16('lens.path1');
    this.path2 = A.i16('lens.path2');
    this.wipe = R.fsProgram(WIPE_FS);
    this.lens = R.fsProgram(LENS_FS);
    this.rot = R.fsProgram(ROT_FS);
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    // part1: wait musplus >= -6, waitb, setmframe(0), 300 frames (wipe in the first 80)
    this.t1 = P.until(t0 + F(5), (p) => p.musplus >= -6) + F(1); // + exe load
    // wait musplus >= -20, waitb; part2: 720 frames of lens
    this.t2 = P.until(this.t1 + F(300), (p) => p.musplus >= -20) + F(1);
    // part3: rotpic90 build + waitb + tweak mode; exits at musplus > -4 or frame 2000
    this.t3 = this.t2 + F(721);
    this.tEnd = Math.min(this.t3 + F(2000), P.until(this.t3, (p) => p.musplus > -4));
    return this.tEnd + F(2);
  },

  // remix: see lens_remix.js
  renderRemix(R, t, post) {
    const F = (x) => x * FPS;
    if (!this.scene) this.scene = new LensScene(R, this.A);
    const S = this.scene;
    const light = [-0.55 + 0.25 * Math.sin(t * 0.3), -0.65, -1.0];
    let fade = [0, 0, 0, 0];
    post.begin({ samples: 1 });
    if (t < this.t2) {
      S.drawFace(R, { steps: Math.min(480, Math.max(0, 6 * F(t - this.t1))), time: t, light });
    } else if (t < this.t3) {
      const uf = F(t - this.t2);
      const k = Math.min(714, Math.max(0, uf));
      const i = Math.min(713, Math.floor(k)), fr = k - i;
      const P1 = this.path1;
      const x = P1[i * 2] + (P1[i * 2 + 2] - P1[i * 2]) * fr;
      const y = P1[i * 2 + 1] + (P1[i * 2 + 3] - P1[i * 2 + 1]) * fr;
      const a = Math.min(31, Math.max(0, (uf - 32) / 2));
      const tint = this.tints[0].map((v) => Math.max(0.15, v));
      S.drawFace(R, { lens: [x + 0.5, (y + 0.5) * 1.2, -80, 68], clear: a / 31, tint, time: t, light });
    } else if (t >= this.tEnd) {
      fade = [1, 1, 1, 1];
    } else {
      const f = F(t - this.t3);
      if (f >= 1) {
        const k = Math.min(1999, f);
        const i = Math.min(1998, Math.floor(k)), fr = k - i;
        const P2 = this.path2, v = [];
        for (let j = 0; j < 4; j++) v.push(P2[i * 4 + j] + (P2[i * 4 + 4 + j] - P2[i * 4 + j]) * fr);
        const flash = f < 16 ? Math.max(0, (15 - f) * 5) / 63 : 0;
        const white = f > 1872 ? Math.min(63, (f - 1872) / 2) / 63 : 0;
        S.drawRoto(R, { path: v, fade: [flash, 0], time: t });
        fade = [1, 1, 1, white];
      }
    }
    post.end(t, { exposure: 1.0, bloom: 0.08, grain: 0.02, vignette: 0.3, fade });
    return true;
  },

  render(R, t) {
    const F = (x) => x * FPS;
    if (t < this.t2) {
      const s = Math.min(480, Math.max(0, 6 * F(t - this.t1)));
      this.wipe.use().tex('uBack', this.backTex).f('uSteps', s);
      R.drawFullscreen();
      return;
    }
    if (t < this.t3) {
      const uf = F(t - this.t2);
      const k = Math.min(714, Math.max(0, uf));
      const i = Math.min(713, Math.floor(k)), fr = k - i;
      const P1 = this.path1;
      const x = P1[i * 2] + (P1[i * 2 + 2] - P1[i * 2]) * fr;
      const y = P1[i * 2 + 1] + (P1[i * 2 + 3] - P1[i * 2 + 1]) * fr;
      const a = Math.min(31, Math.max(0, (uf - 32) / 2));
      this.lens.use().tex('uBack', this.backTex).tex('uMask', this.maskTex)
        .f('uC', x + 0.5, y + 0.5).f('uT1', ...this.tints[0]).f('uT2', ...this.tints[1]).f('uT3', ...this.tints[2]).f('uA', a);
      R.drawFullscreen();
      return;
    }
    if (t >= this.tEnd) {
      const gl = R.gl;
      gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.clearColor(0, 0, 0, 1);
      return;
    }
    const f = F(t - this.t3);
    if (f < 1) {
      const gl = R.gl;
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const k = Math.min(1999, f);
    const i = Math.min(1998, Math.floor(k)), fr = k - i;
    const P2 = this.path2, v = [];
    for (let j = 0; j < 4; j++) v.push(P2[i * 4 + j] + (P2[i * 4 + 4 + j] - P2[i * 4 + j]) * fr);
    const flash = f < 16 ? Math.max(0, (15 - f) * 5) / 63 : 0;
    const white = f > 1872 ? Math.min(63, (f - 1872) / 2) / 63 : 0;
    this.rot.use().tex('uRot', this.rotTex).f('uPath', ...v).f('uFade', flash, white);
    R.drawFullscreen();
  },
};
