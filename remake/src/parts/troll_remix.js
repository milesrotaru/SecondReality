// The troll (TROLL.UP, Pixel), remixed as a small diorama. The picture's
// palette separates its layers (armour 16..31, skin 32..47, sky 48..63,
// rock 64..71 + 88..95, mountains 72..87), so each becomes a solid: the
// troll an inflated relief carrying the painting as its surface (armour
// metallic, skin waxy), the rock a rough slab, the mountains a relief far
// behind, the sky a painted dome with drifting cloud. A drifting camera
// gives parallax. TECHNO slides it in; PANIC switches it off.
import { sdf, resample, blur } from '../gfx/sdf.js';
import { GLSL_NOISE, getNoise } from '../gfx/remix.js';

const GW = 800, GH = 600;
const HX = 800 / 3, HY = 200;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uF;      // troll sdf, troll height, rock sdf, rock height
uniform sampler2D uG;      // mountain sdf, mountain height, armour weight, -
uniform sampler2D uAlb;    // painting (dilated per layer)
uniform float uShift;      // picture's left edge on screen (VGA px)
uniform float uFlash;
uniform float uTime;
uniform vec2 uDrift;
${GLSL_NOISE}
const vec2 HALF = vec2(${HX.toFixed(4)}, ${HY.toFixed(1)});
const float D = 1500.0;
const float MZ = 260.0;     // mountains' back plane
const float SKYZ = 700.0;
const vec3 KEY = normalize(vec3(-0.55, 0.55, -0.62));
const vec3 KEYC = vec3(1.9, 1.6, 1.3);
const vec3 RIM = normalize(vec3(0.75, 0.25, 0.6));
const vec3 RIMC = vec3(1.2, 0.9, 2.2);
vec2 uvOf(vec2 p){ return vec2((p.x + HALF.x) / (2.0 * HALF.x), (HALF.y - p.y) / (2.0 * HALF.y)); }
float boxOut(vec2 p){ return length(max(abs(p) - HALF, 0.0)); }
// m: 1 troll, 2 rock, 3 mountains
float map(vec3 p, out int m){
  vec2 uv = uvOf(p.xy);
  vec4 f = textureLod(uF, uv, 0.0);
  vec4 g = textureLod(uG, uv, 0.0);
  float ob = boxOut(p.xy);
  float dt = max(f.r + ob, max(p.z, -max(f.g, 0.0) - p.z) * 0.6);
  float rh = max(f.a, 0.0);
  float dr = max(f.b + ob, max(p.z - 12.0, -(12.0 + rh) + 12.0 - p.z) * 0.6);
  float mh = max(g.g, 0.0);
  float dm = max(g.r + ob, max(p.z - MZ, (MZ - mh) - p.z) * 0.6);
  float d = dt; m = 1;
  if (dr < d) { d = dr; m = 2; }
  if (dm < d) { d = dm; m = 3; }
  return d;
}
float mapD(vec3 p){ int m; return map(p, m); }
vec3 normal(vec3 p){
  vec2 k = vec2(1.2, -1.2);
  return normalize(k.xyy * mapD(p + k.xyy) + k.yyx * mapD(p + k.yyx) + k.yxy * mapD(p + k.yxy) + k.xxx * mapD(p + k.xxx));
}
float softShadow(vec3 p, vec3 l){
  float s = 1.0, t = 2.0;
  for (int i = 0; i < 36; i++) {
    float d = mapD(p + l * t);
    s = min(s, 8.0 * d / t);
    t += clamp(d, 1.0, 40.0);
    if (s < 0.01 || t > 500.0) break;
  }
  return clamp(s, 0.0, 1.0);
}
float ao(vec3 p, vec3 n){
  float a = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) { float h = float(i) * 6.0; a += w * (h - mapD(p + n * h)); w *= 0.6; }
  return clamp(1.0 - a * 0.02, 0.0, 1.0);
}
vec3 skyCol(vec3 rd, vec2 pp){
  // the painting's lavender-to-violet sky, deeper up top, drifting cloud
  float h = clamp(pp.y / 400.0 + 0.5, 0.0, 1.0);
  vec3 c = mix(vec3(0.34, 0.33, 0.62), vec3(0.08, 0.04, 0.16), pow(h, 0.8));
  float cl = fbm2(pp / vec2(160.0, 55.0) + vec2(uTime * 0.03, 0.0), 5);
  c += vec3(0.22, 0.18, 0.32) * smoothstep(0.5, 0.85, cl) * (1.0 - h * 0.6);
  return c * 0.9;
}
void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 400.0);
  float px = s.x - uShift;
  if (px < 0.0 || px >= 320.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 ro = vec3(uDrift, -D);
  vec3 tgt = vec3((px - 160.0) * 5.0 / 3.0, 200.0 - s.y, 0.0);
  vec3 rd = normalize(tgt - vec3(0.0, 0.0, -D));
  // the drifting camera keeps the z=0 plane registered (shear the ray)
  rd = normalize(tgt - ro);
  float t = max((-(90.0) - ro.z) / rd.z, 0.0);
  float tEnd = (MZ + 1.0 - ro.z) / rd.z;
  bool hit = false; int m = 0;
  for (int i = 0; i < 240; i++) {
    vec3 p = ro + rd * t;
    float d = map(p, m);
    if (d < 0.02) { hit = true; break; }
    t += d * 0.8;
    if (t > tEnd) break;
  }
  vec3 col;
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = normal(p);
    vec3 v = -rd;
    vec2 uv = uvOf(p.xy);
    vec3 alb = pow(texture(uAlb, uv).rgb, vec3(2.2));
    // the painting's brushwork as fine relief (brighter = raised)
    vec2 tx = 1.0 / vec2(textureSize(uAlb, 0));
    float l0 = dot(texture(uAlb, uv).rgb, vec3(0.3, 0.5, 0.2));
    float lx = dot(texture(uAlb, uv + vec2(tx.x, 0.0)).rgb, vec3(0.3, 0.5, 0.2));
    float ly = dot(texture(uAlb, uv + vec2(0.0, tx.y)).rgb, vec3(0.3, 0.5, 0.2));
    // (none right at the silhouette, where the painting has its dark outline)
    float hgt = m == 1 ? texture(uF, uv).g : (m == 2 ? texture(uF, uv).a : texture(uG, uv).g);
    float bump = (m == 1 ? 1.2 : 2.0) * smoothstep(1.0, 8.0, hgt);
    n = normalize(n + vec3(-(lx - l0), (ly - l0), 0.0) * bump);
    // painted crevices hold shadow
    float cavity = smoothstep(0.05, 0.3, l0);
    float metal = 0.0, rough = 0.5, sss = 0.0;
    if (m == 1) {
      float arm = texture(uG, uv).b;
      // waxy skin, worn metal (scuffs vary the roughness)
      float scuff = fbm2(p.xy * vec2(0.9, 0.25) + 3.0, 4);
      metal = arm * 0.85; rough = mix(0.62, mix(0.22, 0.5, scuff), arm); sss = 1.0 - arm;
    } else if (m == 2) {
      rough = 0.9;
      alb *= 0.8 + 0.4 * fbm2(p.xy / 7.0, 4);
    } else {
      rough = 0.7;
    }
    float sh = softShadow(p + n * 0.8, KEY);
    float a = ao(p, n);
    float nl = dot(n, KEY);
    vec3 F0 = mix(vec3(0.04), alb, metal);
    vec3 h = normalize(KEY + v);
    float r2 = rough * rough;
    float nh = max(dot(n, h), 0.0), dd = nh * nh * (r2 * r2 - 1.0) + 1.0;
    float Dg = r2 * r2 / (3.14159 * dd * dd);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
    float wrap = max((nl + 0.3 * sss) / (1.0 + 0.3 * sss), 0.0);
    // the painting already carries its light: keep it as the base and let the
    // 3D light modulate it (shadows, turning away), plus sheen on the metal
    float lit = mix(0.45, 1.0, wrap * sh);
    col = alb * lit * 1.05 * (1.0 - metal * 0.5) + KEYC * sh * Dg * F * max(nl, 0.0) * mix(0.05, 0.3, metal);
    col *= mix(0.7, 1.0, cavity);
    // purple rim from the sky behind
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * max(dot(n, RIM), 0.0);
    col += RIMC * rim * (0.35 + metal) * smoothstep(1.0, 6.0, hgt);
    col += alb * vec3(0.1, 0.09, 0.16) * a * (0.5 + 0.5 * n.y);
    vec3 Fv = F0 + (1.0 - F0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    col += mix(vec3(0.25, 0.22, 0.35), vec3(0.6, 0.55, 0.9), n.y * 0.5 + 0.5) * Fv * a * (0.15 + metal * 0.9) * smoothstep(1.0, 6.0, hgt);
    // warm subsurface glow through thin skin edges
    col += alb * vec3(1.0, 0.45, 0.2) * sss * max(-nl, 0.0) * 0.25;
    if (m == 3) col = mix(col, skyCol(rd, p.xy) * 1.1, 0.22);
  } else {
    vec3 ps = ro + rd * ((SKYZ - ro.z) / rd.z);
    col = skyCol(rd, ps.xy);
  }
  col += vec3(uFlash);
  o = vec4(col, 1.0);
}`;

let shared = null;

export class TrollScene {
  static get(R, A) { return shared || (shared = new TrollScene(R, A)); }

  constructor(R, A) {
    const gl = R.gl;
    const pic = A.pic('techno.troll');
    const W = pic.w, H = pic.h, pix = pic.pix, pal = pic.pal, N = W * H;
    const inR = (c, a, b) => c >= a && c <= b;
    const troll = new Float32Array(N), arm = new Float32Array(N), rock = new Float32Array(N), mtn = new Float32Array(N), lum = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const c = pix[i];
      troll[i] = inR(c, 16, 47) ? 1 : 0;
      arm[i] = inR(c, 16, 31) ? 1 : 0;
      rock[i] = inR(c, 64, 71) || inR(c, 88, 95) ? 1 : 0;
      mtn[i] = inR(c, 72, 87) ? 1 : 0;
      lum[i] = (pal[c * 3] + pal[c * 3 + 1] + pal[c * 3 + 2]) / 189;
    }
    const up = (m) => resample(m, W, H, GW, GH);
    const bin = (f) => { const b = new Uint8Array(GW * GH); for (let i = 0; i < b.length; i++) b[i] = f[i] >= 0.5 ? 1 : 0; return b; };
    const cell = (2 * HX) / GW;
    const lumG = blur(up(lum), GW, GH, 1, 2);
    const inflate = (mask, R0, Hm, detail) => {
      const S = sdf(bin(blur(up(mask), GW, GH, 1, 2)), GW, GH);
      const Hh = new Float32Array(GW * GH);
      for (let i = 0; i < GW * GH; i++) {
        const d = -S[i] * cell;
        if (d <= 0) { Hh[i] = -1; continue; }
        const k = Math.min(1, d / R0);
        Hh[i] = Hm * Math.sqrt(1 - (1 - k) * (1 - k)) + (lumG[i] - 0.5) * detail * k;
      }
      for (let i = 0; i < S.length; i++) S[i] *= cell;
      return [S, Hh];
    };
    const [TS, TH] = inflate(troll, 46, 58, 14);
    const [RS, RH] = inflate(rock, 30, 40, 18);
    const [MS, MH] = inflate(mtn, 50, 90, 30);
    const armG = blur(up(arm), GW, GH, 1, 1);
    const f1 = new Float32Array(GW * GH * 4), f2 = new Float32Array(GW * GH * 4);
    for (let i = 0; i < GW * GH; i++) {
      f1[i * 4] = TS[i]; f1[i * 4 + 1] = TH[i]; f1[i * 4 + 2] = RS[i]; f1[i * 4 + 3] = RH[i];
      f2[i * 4] = MS[i]; f2[i * 4 + 1] = MH[i]; f2[i * 4 + 2] = armG[i]; f2[i * 4 + 3] = 0;
    }
    const ft = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.FLOAT, filter: gl.LINEAR };
    this.f1 = R.texture(GW, GH, { ...ft, data: f1 });
    this.f2 = R.texture(GW, GH, { ...ft, data: f2 });
    // albedo: each layer's colours dilated a few pixels outward so edges
    // never pick up the neighbouring layer
    const rgba = new Uint8Array(N * 4);
    const layer = new Int8Array(N);
    for (let i = 0; i < N; i++) {
      const c = pix[i];
      layer[i] = troll[i] ? 1 : rock[i] ? 2 : mtn[i] ? 3 : 0;
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(pal[c * 3 + k] * 255 / 63);
      rgba[i * 4 + 3] = 255;
    }
    for (let it = 0; it < 4; it++) {
      const src = rgba.slice(), lay = layer.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (lay[i]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X;
          if (lay[j]) { for (let k = 0; k < 3; k++) rgba[i * 4 + k] = src[j * 4 + k]; layer[i] = lay[j]; break; }
        }
      }
    }
    this.alb = R.texture(W, H, { data: rgba, filter: gl.LINEAR });
    this.prog = R.fsProgram(FS);
    this.noise = getNoise(R);
  }

  draw(R, { shift = 0, flash = 0, time = 0 } = {}) {
    const drift = [Math.sin(time * 0.31) * 70, Math.sin(time * 0.23 + 1.3) * 30];
    this.prog.use().tex('uF', this.f1).tex('uG', this.f2).tex('uAlb', this.alb).tex('uNoise', this.noise)
      .f('uShift', shift).f('uFlash', flash).f('uTime', time).f('uDrift', ...drift);
    R.drawFullscreen();
  }
}
