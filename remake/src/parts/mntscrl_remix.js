// MNTSCRL, remixed: a moonlit hillside seen from under an oak.
// The text surface of the original (POS1..3.DAT) is, to ~5 px, a plane seen
// through a ~79 degree lens: fitting a homography to the per-pixel font
// coordinates and decomposing it (square-ish VGA pixels, principal point
// 160,100) gives f = 195 and the plane P(u,v) = T + u*R1 + v*R2 in camera
// space (x right, y down, z forward). The hill is that plane, rolled over at
// the ridge (v < 0) and given relief; the text scrolls along it at the
// original font coordinates. The branches are a procedural oak (limbs,
// twigs, lobed leaves) in front, swaying a little; the moon behind the
// viewer casts their shadows onto the hill through a shadow map.
import { GLSL_NOISE, getNoise } from '../gfx/remix.js';

const T = [-35.90394312, 10.01496445, 36.39643921];
const R1 = [0.41900401, -0.31251823, 0.61378721];
const R2 = [1.05883926, 0.3371672, -0.55110613];
const FX = 195, FY = 234;
const v3 = (a) => `vec3(${a.map((x) => x.toFixed(6)).join(', ')})`;
// towards the moon (behind the viewer, up and to the left)
const LIGHT = (() => { const l = [-0.38, -0.62, -0.69]; const n = Math.hypot(...l); return l.map((x) => x / n); })();

const PROJ = `
const float FX = ${FX.toFixed(1)}, FY = ${FY.toFixed(1)};
vec4 project(vec3 p){ return vec4(FX * p.x / 160.0, -FY * p.y / 100.0, (p.z - 1.0) / 300.0 * 2.0 * p.z - p.z, p.z); }
uniform mat3 uLB;      // light basis rows: x, y, dir
uniform vec4 uLR;      // light-space bounds: x0, y0, 1/w, 1/h
uniform vec2 uLZ;      // depth range: z0, 1/range
vec3 lightUV(vec3 p){ vec3 q = uLB * p; return vec3((q.x - uLR.x) * uLR.z, (q.y - uLR.y) * uLR.w, (q.z - uLZ.x) * uLZ.y); }
`;

export const HILL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uFont, uCov, uShadow;
uniform float uScroll, uText, uHill, uSky, uTime;
${GLSL_NOISE}
${PROJ}
const vec3 T0 = ${v3(T)};
const vec3 R1 = ${v3(R1)};
const vec3 R2 = ${v3(R2)};
const vec3 L = ${v3(LIGHT)};
vec3 N0, E1, E2; float S1, S2;
// signed height above the hill (along the outward normal)
vec2 plane(vec3 p){ vec3 q = p - T0; return vec2(dot(q, R1) / S1, dot(q, R2) / S2); }
float hillH(vec2 uv){
  float roll = uv.y < 0.0 ? -0.018 * uv.y * uv.y : 0.0;       // over the ridge
  float rel = (fbm2(uv / vec2(40.0, 22.0) + 3.0, 5) - 0.5) * 4.0;
  return roll + rel * smoothstep(-40.0, 10.0, uv.y);
}
float sdHill(vec3 p){ vec2 uv = plane(p); return dot(p - T0, N0) - hillH(uv); }
float shadowAt(vec3 p){
  vec3 l = lightUV(p);
  if (any(lessThan(l.xy, vec2(0.0))) || any(greaterThan(l.xy, vec2(1.0)))) return 1.0;
  vec2 ts = 1.0 / vec2(textureSize(uShadow, 0));
  float s = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++)
    s += texture(uShadow, l.xy + vec2(i, j) * ts * 1.6).r < l.z - 0.002 ? 0.0 : 1.0;
  return s / 25.0;
}
vec3 sky(vec3 rd){
  float up = -rd.y;
  vec3 c = mix(vec3(0.012, 0.02, 0.06), vec3(0.002, 0.004, 0.02), smoothstep(-0.2, 0.9, up));
  // moon glow bleeding over from behind the viewer, upper left
  c += vec3(0.05, 0.08, 0.18) * pow(max(dot(rd, normalize(vec3(-0.9, -0.5, 0.2))), 0.0), 4.0);
  vec2 g = rd.xy / rd.z * 220.0;
  vec2 ci = floor(g); vec2 h = hash22(ci);
  if (h.x < 0.02) { vec2 sp = ci + 0.2 + 0.6 * hash22(ci + 5.0); float d = length(g - sp); c += vec3(0.8, 0.85, 1.0) * pow(hash12(ci + 1.0), 6.0) * 3.0 * exp(-d * d * 3.0); }
  return c;
}
void main(){
  S1 = dot(R1, R1); S2 = dot(R2, R2);
  N0 = normalize(cross(R1, R2));
  if (dot(N0, -T0) < 0.0) N0 = -N0;        // outward: towards the viewer
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec3 rd = normalize(vec3((s.x - 160.0) / FX, (s.y - 100.0) / FY, 1.0));
  vec3 col = sky(rd) * uSky;
  // march the hill
  // start the march where the ray meets a plane lifted above the relief
  float dn = dot(rd, N0);
  float t = 5.0; bool hit = false;
  if (dn < 0.0) t = max(t, (dot(T0, N0) + 8.0) / dn);
  for (int i = 0; i < 140; i++) {
    vec3 p = rd * t;
    float d = sdHill(p);
    if (d < 0.01 * t * 0.02 + 0.005) { hit = true; break; }
    t += max(d * 0.8, 0.02);
    if (t > 900.0) break;
  }
  if (hit) {
    vec3 p = rd * t;
    float e = 0.02 * t * 0.05 + 0.01;
    vec3 n = normalize(vec3(sdHill(p + vec3(e, 0, 0)) - sdHill(p - vec3(e, 0, 0)), sdHill(p + vec3(0, e, 0)) - sdHill(p - vec3(0, e, 0)), sdHill(p + vec3(0, 0, e)) - sdHill(p - vec3(0, 0, e))));
    vec2 uv = plane(p);
    // frosted meadow: pale blue, streaked, with the moonlight's soft falloff
    float g1 = fbm2(uv * vec2(0.8, 1.6) + 7.0, 5), g2 = vnoise(uv * vec2(6.0, 14.0));
    vec3 alb = vec3(0.13, 0.19, 0.38) * (0.62 + 0.55 * g1) * (0.95 + 0.1 * g2);
    float sh = shadowAt(p + n * 0.05);
    float ndl = max(dot(n, L), 0.0);
    vec3 moon = vec3(0.75, 0.85, 1.25) * 1.7;
    vec3 c = alb * (moon * ndl * sh + vec3(0.03, 0.05, 0.1));
    // sparkle of frost
    c += vec3(0.8, 0.9, 1.2) * step(0.994, hash12(floor(uv * vec2(14.0, 28.0)))) * ndl * sh * 0.5;
    // the text, glowing on the slope at the original's font coordinates
    if (uText > 0.5 && uv.y >= -0.5 && uv.y <= 30.5) {
      float fx = uv.x + uScroll;
      vec2 ft = vec2((fx + 0.5) / 640.0, (uv.y + 0.5) / 31.0);
      float cov = (fx < 0.0 || fx > 639.0) ? 0.0 : texture(uCov, ft).r;
      float w = max(fwidth(cov), 1e-3);
      float a = smoothstep(0.5 - w, 0.5 + w, cov);
      float F = texture(uFont, ft).r * 255.0 / max(cov, 0.02) / 7.0;
      vec3 tc = mix(vec3(0.25, 0.17, 0.4), vec3(0.62, 0.5, 0.78), clamp(F, 0.0, 1.0));
      c = mix(c, tc * (0.45 + 0.75 * sh), a);
      c += tc * 0.15 * smoothstep(0.1, 0.5, cov);
    }
    // ground mist thickening toward the ridge
    c = mix(c, vec3(0.05, 0.08, 0.16), smoothstep(-2.0, -25.0, uv.y) * 0.6);
    col = c * uHill;
  }
  o = vec4(col, 1.0);
}`;

export const LEAF_VS = `#version 300 es
layout(location=0) in vec2 aCorner;       // x: 0..1 along the midrib, y: -1..1 (a 5x2 grid)
layout(location=1) in vec3 aC;            // leaf base
layout(location=2) in vec3 aA;            // midrib vector
layout(location=3) in vec4 aS;            // lateral half-width vector, tint
uniform float uTime;
uniform int uShadowPass;
${PROJ}
out vec2 vL;
out vec3 vN;
out vec3 vP;
out float vTint;
out float vAO;
void main(){
  // flutter: a small rotation about the stem, per leaf phase
  float ph = dot(aC, vec3(1.3, 2.1, 0.7));
  float fl = sin(uTime * 2.3 + ph) * 0.18 + sin(uTime * 0.7 + ph * 0.3) * 0.1;
  vec3 A = aA, S = aS.xyz;
  vec3 ax = normalize(A);
  S = S * cos(fl) + cross(ax, S) * sin(fl);
  vec3 N = normalize(cross(A, S));
  float len = length(A), wid = length(S);
  // cupped across the midrib, tip curling back
  float x = aCorner.x, y = aCorner.y;
  float cup = 0.22 * wid, curl = 0.18 * len * (0.5 + fract(ph * 7.1));
  vec3 p = aC + A * x + S * y + N * (cup * y * y - curl * x * x);
  vec3 dx = A - N * (2.0 * curl * x), dy = S + N * (2.0 * cup * y);
  p.x += sin(uTime * 0.6 + p.y * 0.08) * 0.08 * (p.z * 0.05);
  vL = aCorner;
  vN = normalize(cross(dx, dy));
  vP = p;
  vTint = aS.w;
  // leaves deep inside a cluster (low tint hash) sit in more shade
  vAO = 0.55 + 0.45 * fract(aS.w * 13.7);
  if (uShadowPass == 1) { vec3 l = lightUV(p); gl_Position = vec4(l.xy * 2.0 - 1.0, l.z * 2.0 - 1.0, 1.0); }
  else gl_Position = project(p);
}`;

export const LEAF_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vL;
in vec3 vN;
in vec3 vP;
in float vTint;
in float vAO;
out vec4 o;
uniform sampler2D uShadow;
uniform int uShadowPass;
uniform float uLit;
${PROJ}
const vec3 L = ${v3(LIGHT)};
float shadowAt(vec3 p){
  vec3 l = lightUV(p);
  vec2 ts = 1.0 / vec2(textureSize(uShadow, 0));
  float s = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++)
    s += texture(uShadow, l.xy + vec2(i, j) * ts) .r < l.z - 0.004 ? 0.0 : 1.0;
  return s / 9.0;
}
// oak leaf outline: half-width along the midrib, rounded lobes with deep
// sinuses, lobes on the two sides slightly offset, a rounded tip
float halfWidth(float x, float side){
  float env = pow(max(sin(3.14159 * pow(clamp(x, 0.0, 1.0), 0.8)), 0.0), 0.6);
  float ph = x * 4.5 + (side > 0.0 ? 0.25 : 0.0);
  float lobe = 0.5 + 0.5 * pow(abs(cos(ph * 3.14159)), 0.55);
  return env * mix(0.42, 1.0, lobe) * 0.95;
}
void main(){
  float x = vL.x;
  float w = halfWidth(x, vL.y);
  float d = abs(vL.y) - w;
  float aa = fwidth(d) + 1e-3;
  float a = clamp(0.5 - d / aa, 0.0, 1.0);
  if (x < 0.07) a = max(a * step(0.07, x), (1.0 - smoothstep(0.05, 0.08, abs(vL.y))) * step(0.0, x));  // stem
  if (a < 0.02) discard;
  if (uShadowPass == 1) { o = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); return; }
  vec3 n = normalize(vN);
  vec3 v = normalize(-vP);
  bool back = dot(n, v) < 0.0;
  if (back) n = -n;
  // veins: midrib and side veins toward each lobe, as relief and colour
  float mid = exp(-abs(vL.y) * 30.0);
  float sv = exp(-abs(fract(x * 4.5 + abs(vL.y) * 0.9) - 0.5) * 16.0) * step(abs(vL.y), w * 0.85) * (1.0 - mid);
  vec3 tint = mix(mix(vec3(0.025, 0.07, 0.02), vec3(0.06, 0.12, 0.03), vTint), vec3(0.11, 0.12, 0.03), step(0.9, fract(vTint * 7.3)) * 0.7);
  // darker towards the edges, lighter veins; the underside is paler
  vec3 alb = tint * (0.8 + 0.35 * smoothstep(w, 0.0, abs(vL.y))) * (1.0 + 0.6 * mid + 0.35 * sv);
  if (back) alb = alb * vec3(1.2, 1.3, 1.1) + vec3(0.01, 0.015, 0.01);
  n = normalize(n + (dFdx(sv) * vec3(1.0, 0.0, 0.0) + dFdy(sv) * vec3(0.0, 1.0, 0.0)) * 0.3);
  float sh = shadowAt(vP + n * 0.03);
  float ndl = dot(n, L);
  vec3 moon = vec3(0.75, 0.85, 1.25) * 1.1;
  vec3 c = alb * (moon * max(ndl, 0.0) * sh + vec3(0.02, 0.03, 0.06) * vAO);
  // light through the leaf, and a waxy sheen
  c += alb * vec3(0.9, 1.4, 0.5) * max(-ndl, 0.0) * sh * 0.8;
  vec3 h = normalize(L + v);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  c += moon * (0.05 + F * 0.3) * pow(max(dot(n, h), 0.0), 30.0) * sh;
  c *= mix(0.7, 1.0, vAO);
  o = vec4(c * uLit, a);
}`;

export const BRANCH_VS = `#version 300 es
layout(location=0) in vec2 aCorner;      // x: 0..1 along, y: -1..1 across
layout(location=1) in vec4 aP0;          // start, radius
layout(location=2) in vec4 aP1;          // end, radius
uniform float uTime;
uniform int uShadowPass;
${PROJ}
out vec3 vP;
out float vS;
out vec3 vAx;
void main(){
  vec3 p0 = aP0.xyz, p1 = aP1.xyz;
  vec3 ax = p1 - p0;
  vec3 c = mix(p0, p1, aCorner.x);
  float r = mix(aP0.w, aP1.w, aCorner.x);
  vec3 view = uShadowPass == 1 ? -${v3(LIGHT)} : normalize(c);
  vec3 side = normalize(cross(ax, view));
  vec3 p = c + side * r * aCorner.y * 1.05;
  p.x += sin(uTime * 0.6 + p.y * 0.08) * 0.08 * (p.z * 0.05);
  vP = p; vS = aCorner.y; vAx = normalize(ax);
  if (uShadowPass == 1) { vec3 l = lightUV(p); gl_Position = vec4(l.xy * 2.0 - 1.0, l.z * 2.0 - 1.0, 1.0); }
  else gl_Position = project(p);
}`;

export const BRANCH_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vP;
in float vS;
in vec3 vAx;
out vec4 o;
uniform int uShadowPass;
uniform float uLit;
${GLSL_NOISE}
const vec3 L = ${v3(LIGHT)};
void main(){
  if (uShadowPass == 1) { o = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); return; }
  vec3 v = normalize(-vP);
  vec3 side = normalize(cross(vAx, v));
  vec3 n = normalize(side * vS + v * sqrt(max(1.0 - vS * vS, 0.0)));
  float bark = fbm2(vec2(dot(vP, vAx) * 3.0, vS * 2.0), 4);
  vec3 alb = vec3(0.035, 0.026, 0.02) * (0.5 + 0.9 * bark);
  vec3 moon = vec3(0.75, 0.85, 1.25) * 2.4;
  vec3 c = alb * (moon * max(dot(n, L), 0.0) * 0.8 + vec3(0.02, 0.025, 0.05));
  c += vec3(0.25, 0.3, 0.5) * pow(1.0 - max(dot(n, v), 0.0), 4.0) * 0.15;
  o = vec4(c * uLit, 1.0);
}`;

// ---- the oak ----
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; s ^= s >>> 13; return (s >>> 0) / 4294967296; };
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a) => { const l = Math.hypot(...a) || 1; return mul(a, 1 / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rotate(v, axis, ang) {
  const k = norm(axis), c = Math.cos(ang), s = Math.sin(ang);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const cr = cross(k, v);
  return [v[0] * c + cr[0] * s + k[0] * d * (1 - c), v[1] * c + cr[1] * s + k[1] * d * (1 - c), v[2] * c + cr[2] * s + k[2] * d * (1 - c)];
}

export function buildOak() {
  const R = rng(1993);
  const branches = [], leaves = [];
  const leaf = (base, dir, size) => {
    const side = norm(cross(dir, [R() - 0.5, R() - 0.5, R() - 0.5]));
    leaves.push([...base, ...mul(dir, size), ...mul(side, size * 0.5), R()]);
  };
  const grow = (p, dir, len, r, depth) => {
    const segs = 6;
    let q = p, d = norm(dir);
    const pts = [p];
    for (let i = 0; i < segs; i++) {
      // gentle wander and a slight droop
      d = norm(add(rotate(d, [R() - 0.5, R() - 0.5, R() - 0.5], (R() - 0.5) * 0.35), [0, 0.04, 0]));
      const nq = add(q, mul(d, len / segs));
      const r0 = r * (1 - i / segs * 0.6), r1 = r * (1 - (i + 1) / segs * 0.6);
      branches.push([...q, r0, ...nq, r1]);
      q = nq; pts.push(q);
    }
    if (depth >= 3) {
      // leaf clusters along the twig and a rosette at the tip
      for (let i = 2; i <= segs; i++) {
        const b = pts[i];
        const n = i === segs ? 6 : 2;
        for (let k = 0; k < n; k++) {
          const ld = norm(add(rotate(d, [R() - 0.5, R() - 0.5, R() - 0.5], 0.6 + R() * 1.4), [0, -0.2, 0]));
          leaf(b, ld, 0.9 + R() * 0.6);
        }
      }
      return;
    }
    const kids = depth === 0 ? 4 : (depth === 1 ? 3 : 2);
    for (let k = 0; k < kids; k++) {
      const at = 0.3 + 0.65 * (k + R() * 0.5) / kids;
      const i = Math.min(segs, Math.round(at * segs));
      const b = pts[i];
      const cd = rotate(d, cross(d, [R() - 0.5, R() - 0.5, R() - 0.5]), 0.5 + R() * 0.6);
      grow(b, cd, len * (0.45 + R() * 0.2), r * (0.45 + (1 - at) * 0.2), depth + 1);
    }
  };
  // three limbs entering from the lower right, reaching up and left
  grow([15, 15, 9.5], [-0.55, -0.72, 0.28], 17, 0.6, 0);
  grow([5, 17, 12], [-0.12, -0.92, 0.3], 15, 0.52, 0);
  grow([19, 3, 11], [-0.55, -0.55, 0.5], 14, 0.48, 0);
  return { branches: new Float32Array(branches.flat()), leaves: new Float32Array(leaves.flat()) };
}

export { LIGHT, T, R1, R2 };
export const getNoiseTex = getNoise;
