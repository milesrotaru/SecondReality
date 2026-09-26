// The horizon painting of ALKU / U2A / PAM, remade as a raymarched moonscape:
// a dark basalt mare running out to the horizon where the ship will land,
// cratered highlands on either side, a jagged ridge on the right (where the
// painting has its rock face), a far mountain range under a violet afterglow,
// and a starfield with the Milky Way.
//
// World: y up, units of the VISU camera space. The final camera (where the
// painting's scroll ends and U2A plays) sits at (0, CAM_H, 0) looking +z;
// the VISU projection (mulx/muly around addx/addy) is used as is, so the
// ships of U2A and the explosion of PAM land exactly where they did.
// ALKU's scroll becomes a slow pan: yaw and a little sideways travel.
import { GLSL_NOISE } from '../gfx/remix.js';

export const CAM_H = 600;

export const MOON_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec4 uProj;        // mulx, muly, addx, addy (VGA)
uniform vec3 uCam;         // camera position (world)
uniform float uYaw;        // radians, + turns right
uniform float uFade;       // scene brightness (the picture fade-in)
uniform float uTime;
// PAM: explosion
uniform vec3 uExp;         // centre (world)
uniform float uFlash;      // point light intensity
uniform float uBall;       // fireball radius (0 = none)
uniform float uBallHeat;   // fireball brightness
uniform float uRing;       // shock ring radius (0 = none)
uniform float uRingHeat;
${GLSL_NOISE}
const vec3 SUN = normalize(vec3(-0.78, 0.36, 0.55));    // low, behind the far range
const vec3 SUNC = vec3(1.0, 0.97, 1.1) * 1.6;
const vec3 FILL = normalize(vec3(0.4, 0.5, -0.75));     // faint earthshine from behind the camera
const vec3 FILLC = vec3(0.10, 0.13, 0.22);

float ridged(vec2 p, int oct){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 7; i++) { if (i >= oct) break; float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0); s += a * n * n; p = M2 * p * 2.1; a *= 0.5; }
  return s;
}
float mareMask(vec2 p){
  float w = 7000.0 + 0.36 * max(p.y, 0.0);
  float e = abs(p.x + 3000.0 * sin(p.y / 45000.0)) - w + (vnoise(p / 26000.0) - 0.5) * 16000.0;
  return smoothstep(5000.0, -3000.0, e);
}
// one crater per cell, kept inside its cell
float craters(vec2 p){
  vec2 c = floor(p), f = fract(p);
  vec2 h = hash22(c);
  float r = 0.10 + 0.25 * h.x * h.x;
  vec2 ctr = 0.5 + (h - 0.5) * (1.0 - 2.4 * r) * 0.9;
  float d = length(f - ctr) / r;
  // shallow bowl blending into a soft raised rim and ejecta skirt
  float bowl = (smoothstep(1.05, 0.0, d) * -0.55) * (1.0 - 0.35 * smoothstep(0.5, 0.0, d));
  float rim = exp(-pow((d - 1.0) * 2.4, 2.0)) * 0.22;
  // fade out before the cell border (no seams)
  vec2 e = abs(f - 0.5);
  float win = smoothstep(0.5, 0.4, max(e.x, e.y));
  return (bowl + rim) * r * step(0.42, h.y) * win;
}
int octFor(float t){ return int(clamp(9.0 - log2(max(t, 1.0) / 1500.0), 3.0, 8.0)); }
float terrainH(vec2 p, int oct){
  float m = mareMask(p);
  float hi = fbm2(p / 14000.0 + 3.0, oct);
  float h = mix((hi - 0.33) * 5600.0, (hi - 0.5) * 280.0 - 160.0, m);
  // the ridge on the right
  vec2 q = (p - vec2(34000.0, 62000.0)) / vec2(24000.0, 22000.0);
  float r = 1.0 - dot(q, q);
  if (r > 0.0) h += r * r * (0.35 + ridged(p / 7000.0, oct)) * 21000.0;
  // far mountain range
  float rho = length(p);
  if (rho > 620000.0) h += smoothstep(620000.0, 950000.0, rho) * (0.2 + ridged(p / 70000.0 + 7.0, max(oct - 2, 3))) * 52000.0;
  // rubble and undulation
  if (oct > 4) h += (fbm2(p / 1700.0 + 5.0, oct - 4) - 0.5) * mix(380.0, 70.0, m);
  // craters, two sizes (mostly visible on the mare)
  if (rho < 250000.0) {
    h += craters(p / 9000.0) * 9000.0 * 0.45;
    if (oct > 5) h += craters(p / 2100.0 + 11.0) * 2100.0 * 0.4;
  }
  return h;
}
vec3 terrainN(vec2 p, float t){
  float e = max(4.0, t * 0.0015);
  int oc = octFor(t) + 2;
  float h = terrainH(p, oc);
  return normalize(vec3(h - terrainH(p + vec2(e, 0.0), oc), e, h - terrainH(p + vec2(0.0, e), oc)));
}
float march(vec3 ro, vec3 rd, float tmax){
  float t = 50.0, lastD = 0.0, lastT = t;
  for (int i = 0; i < 220; i++) {
    vec3 p = ro + rd * t;
    float d = p.y - terrainH(p.xz, octFor(t));
    if (d < 0.0) {
      // refine between the last two samples
      float a = lastT, b = t;
      for (int k = 0; k < 6; k++) {
        float m = 0.5 * (a + b);
        vec3 q = ro + rd * m;
        if (q.y - terrainH(q.xz, octFor(m)) < 0.0) b = m; else a = m;
      }
      return 0.5 * (a + b);
    }
    lastT = t; lastD = d;
    t += max(d * 0.45, t * 0.0025);
    if (t > tmax || p.y > 60000.0 && rd.y > 0.0) break;
  }
  return -1.0;
}
float shadow(vec3 p, float t0){
  float s = 1.0, t = 30.0 + t0 * 0.002;
  for (int i = 0; i < 28; i++) {
    vec3 q = p + SUN * t;
    float d = q.y - terrainH(q.xz, 4);
    s = min(s, 12.0 * d / t);
    t += clamp(d * 0.6, 60.0 + t0 * 0.001, 20000.0);
    if (s < 0.0 || q.y > 60000.0) break;
  }
  return clamp(s, 0.0, 1.0);
}
vec3 skyGlow(vec3 rd){
  float el = rd.y;
  float az = max(dot(normalize(rd.xz), normalize(SUN.xz)), 0.0);
  return vec3(0.002, 0.003, 0.008) + vec3(0.12, 0.03, 0.16) * exp(-max(el, 0.0) * 30.0) * (0.25 + 1.0 * pow(az, 4.0))
    + vec3(0.012, 0.008, 0.03) * exp(-max(el, 0.0) * 6.0);
}
vec3 sky(vec3 rd){
  float el = rd.y;
  // violet afterglow toward the sun's azimuth, fading up
  float az = max(dot(normalize(rd.xz), normalize(SUN.xz)), 0.0);
  vec3 glow = vec3(0.12, 0.03, 0.16) * exp(-max(el, 0.0) * 30.0) * (0.25 + 1.0 * pow(az, 4.0));
  glow += vec3(0.012, 0.008, 0.03) * exp(-max(el, 0.0) * 6.0);
  vec3 c = vec3(0.002, 0.003, 0.008) + glow;
  // Milky Way: a tilted band of dust and faint stars
  vec3 bn = normalize(vec3(0.3, 0.8, -0.5));
  float band = exp(-pow(dot(rd, bn) * 3.2, 2.0));
  float dust = fbm3(rd * 6.0, 5);
  c += vec3(0.05, 0.05, 0.08) * band * smoothstep(0.35, 0.8, dust) * 0.9;
  c -= vec3(0.02) * band * smoothstep(0.55, 0.75, fbm3(rd * 14.0 + 3.0, 4)) ;
  // stars: jittered points on a cube-ish grid of directions
  vec3 a = abs(rd);
  vec2 uv = a.x > a.y && a.x > a.z ? rd.yz / a.x : (a.y > a.z ? rd.xz / a.y : rd.xy / a.z);
  float face = a.x > a.y && a.x > a.z ? sign(rd.x) : (a.y > a.z ? 2.0 * sign(rd.y) : 3.0 * sign(rd.z));
  for (int L = 0; L < 2; L++) {
    float sc = L == 0 ? 180.0 : 520.0;
    vec2 g = uv * sc, ci = floor(g);
    vec2 h = hash22(ci + face * 71.0 + float(L) * 13.0);
    float pr = L == 0 ? 0.025 : 0.06;
    if (h.x < pr) {
      vec2 sp = ci + 0.25 + 0.5 * hash22(ci + face * 9.0 + 5.0);
      float d = length(g - sp);
      float px = fwidth(g.x) + 1e-5;
      float mag = pow(hash12(ci + face * 3.0), 10.0) * (L == 0 ? 40.0 : 4.0) + (L == 0 ? 0.35 : 0.12);
      vec3 sc3 = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), h.y);
      c += sc3 * mag * exp(-d * d / (px * px * 0.6)) * (1.0 + band * 1.5) * 0.25;
    }
  }
  return c * smoothstep(-0.02, 0.01, el) + vec3(0.02, 0.01, 0.03) * smoothstep(0.01, -0.05, el);
}
// PAM light: flash + ring, per point
vec3 expLight(vec3 p, vec3 n){
  vec3 L = vec3(0.0);
  if (uFlash > 0.0) {
    vec3 d = uExp - p; float r2 = dot(d, d);
    L += vec3(1.0, 0.75, 0.5) * uFlash * max(dot(n, normalize(d)), 0.0) * 5e9 / (r2 + 1e8);
  }
  if (uRing > 0.0) {
    float rho = length(p.xz - uExp.xz);
    float w = 6000.0 + uRing * 0.06;
    L += vec3(0.6, 0.8, 1.2) * uRingHeat * 6.0 * exp(-pow((rho - uRing) / w, 2.0)) * (0.4 + 0.6 * max(n.y, 0.0));
    // the ground behind the ring still glows
    L += vec3(1.0, 0.45, 0.2) * uRingHeat * 0.6 * smoothstep(uRing, uRing * 0.3, rho) * step(rho, uRing);
  }
  return L;
}
// volumetric shock ring and fireball along a ray segment
vec3 expVolume(vec3 ro, vec3 rd, float tmax){
  vec3 acc = vec3(0.0);
  if (uRing > 0.0) {
    // intersect the ray (in the horizontal plane) with the annulus around the ring
    float w = 6000.0 + uRing * 0.06, wy = 2500.0 + uRing * 0.035;
    vec2 o2 = ro.xz - uExp.xz, d2 = rd.xz;
    float A = dot(d2, d2), B = dot(o2, d2);
    for (int side = 0; side < 2; side++) {
      float R = uRing + (side == 0 ? 3.0 : -3.0) * w;
      float Ri = max(uRing - 3.0 * w, 0.0), Ro = uRing + 3.0 * w;
      float Co = dot(o2, o2) - Ro * Ro, Ci = dot(o2, o2) - Ri * Ri;
      float disO = B * B - A * Co;
      if (disO <= 0.0) break;
      float sq = sqrt(disO), t0 = (-B - sq) / A, t1 = (-B + sq) / A;
      float disI = B * B - A * Ci;
      float a, b;
      if (disI > 0.0) { float si = sqrt(disI); if (side == 0) { a = t0; b = (-B - si) / A; } else { a = (-B + si) / A; b = t1; } }
      else { if (side == 1) break; a = t0; b = t1; }
      a = max(a, 0.0); b = min(b, tmax);
      if (b <= a) continue;
      const int NS = 20;
      float dt = (b - a) / float(NS);
      for (int i = 0; i < NS; i++) {
        float t = a + (float(i) + hash12(gl_FragCoord.xy + float(i))) * dt;
        vec3 p = ro + rd * t;
        float rho = length(p.xz - uExp.xz);
        float y = p.y - uExp.y;
        float dr = rho - uRing;
        // sharp leading front, long churning wake behind it
        float dens = exp(-pow(max(dr, 0.0) / (0.25 * w), 2.0) - pow(min(dr, 0.0) / w, 2.0) - pow(y / wy, 2.0));
        float ang = atan(p.z - uExp.z, p.x - uExp.x);
        dens *= 0.25 + 1.5 * fbm2(vec2(ang * 30.0, y / wy * 1.5 + rho / w * 0.8 - uTime * 0.7), 5);
        float hot = exp(-pow((dr + 0.1 * w) / (w * 0.22), 2.0));
        acc += dens * dt * mix(vec3(0.16, 0.19, 0.30), vec3(1.5, 1.6, 2.0), hot) * uRingHeat * 0.35 / w;
      }
    }
  }
  if (uBall > 0.0) {
    vec3 oc = ro - uExp; float b = dot(oc, rd), c = dot(oc, oc) - uBall * uBall, h = b * b - c;
    if (h > 0.0) {
      h = sqrt(h);
      float a = max(-b - h, 0.0), e = min(-b + h, tmax);
      const int NB = 16;
      float dt = (e - a) / float(NB);
      for (int i = 0; i < NB; i++) {
        float t = a + (float(i) + 0.5) * dt;
        vec3 p = ro + rd * t;
        float r = length(p - uExp) / uBall;
        float n = fbm3((p - uExp) / uBall * 3.0 + vec3(0.0, -uTime * 1.5, 0.0), 4);
        float dens = smoothstep(1.0, 0.3, r + (n - 0.5) * 0.6);
        vec3 col = mix(vec3(1.0, 0.35, 0.08), vec3(1.2, 1.1, 0.9), smoothstep(0.5, 0.0, r));
        acc += dens * col * uBallHeat * dt / uBall * 3.0;
      }
    }
  }
  return acc;
}

void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec3 dc = vec3((s.x - uProj.z - 0.5) / uProj.x, -(s.y - uProj.w - 0.5) / uProj.y, 1.0);
  float cy = cos(uYaw), sy = sin(uYaw);
  vec3 rd = normalize(vec3(dc.x * cy + dc.z * sy, dc.y, -dc.x * sy + dc.z * cy));
  vec3 ro = uCam;
  float tmax = 2.5e6;
  float t = march(ro, rd, tmax);
  vec3 col;
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    vec3 n = terrainN(p.xz, t);
    // fine regolith relief up close
    if (t < 20000.0) {
      vec3 g = vnoised(p.xz / 70.0) + 0.5 * vnoised(p.xz / 23.0 + 3.0);
      n = normalize(n + vec3(-g.y, 0.0, -g.z) * 0.2 * smoothstep(20000.0, 3000.0, t));
    }
    // regolith: blue-grey, darker basalt on the mare, fine grain up close
    float m = mareMask(p.xz);
    float grain = fbm2(p.xz / 90.0, t < 20000.0 ? 4 : 1);
    vec3 alb = mix(vec3(0.17, 0.18, 0.24), vec3(0.085, 0.09, 0.125), m) * (0.75 + 0.5 * grain);
    alb *= 0.85 + 0.3 * vnoise(p.xz / 3000.0);
    float sh = shadow(p + n * 20.0, t);
    float ndl = max(dot(n, SUN), 0.0);
    // lunar regolith scatters back toward the light: a touch of Lommel-Seeliger
    float mu = max(dot(n, -rd), 0.05);
    float ls = mix(ndl, ndl / (ndl + mu + 1e-3), 0.3);
    col = alb * SUNC * ls * sh;
    col += alb * FILLC * max(dot(n, FILL), 0.0);
    col += alb * vec3(0.05, 0.03, 0.09) * (0.5 + 0.5 * n.y);     // skyglow
    col += alb * expLight(p, n);
    // haze toward the horizon glow
    float fog = 1.0 - exp(-t / 900000.0);
    col = mix(col, skyGlow(normalize(vec3(rd.x, 0.004, rd.z))) * 0.7, fog);
  } else {
    col = sky(rd);
    t = tmax;
  }
  col *= uFade;
  col += expVolume(ro, rd, t);
  o = vec4(col, 1.0);
}`;

import { getNoise } from '../gfx/remix.js';
import { cameraMul } from '../gfx/visu.js';

// VISU camera of U2A (fov 8704, window 0,25..319,174)
export const PROJ = (() => { const [mx, my] = cameraMul(8704, 160); return [mx, my, 159, 99]; })();

let shared = null;
export class Moon {
  static get(R) { return shared || (shared = new Moon(R)); }
  constructor(R) {
    this.prog = R.fsProgram(MOON_FS);
    this.noise = getNoise(R);
  }
  // o: { yaw, cam:[x,y,z], fade, time, exp:[x,y,z], flash, ball, ballHeat, ring, ringHeat }
  draw(R, o) {
    const gl = R.gl;
    const e = o.exp || [0, 0, 0];
    // letterbox rows 25..174 as in the original
    R.scissorVGA(0, 25, 320, 150);
    this.prog.use().tex('uNoise', this.noise)
      .f('uProj', ...PROJ).f('uCam', ...(o.cam || [0, CAM_H, 0])).f('uYaw', o.yaw || 0)
      .f('uFade', o.fade ?? 1).f('uTime', o.time || 0)
      .f('uExp', ...e).f('uFlash', o.flash || 0).f('uBall', o.ball || 0).f('uBallHeat', o.ballHeat || 0)
      .f('uRing', o.ring || 0).f('uRingHeat', o.ringHeat || 0);
    R.drawFullscreen();
    gl.disable(gl.SCISSOR_TEST);
  }
}
