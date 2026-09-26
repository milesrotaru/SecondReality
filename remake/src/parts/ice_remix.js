// The "ice kingdom" card of JPLOGO (and U2E's opening), remixed as a small
// raymarched scene: a cluster of hexagonal ice spires on a snowdrift, a big
// low moon, aurora curtains and falling snow, a warm light glowing inside
// the tallest spire. Rendered into a texture at the card's aspect (185 x 400
// of a 320 x 400 screen), which the original's jelly physics then drops and
// wobbles.
import { GLSL_NOISE, getNoise } from '../gfx/remix.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uTime;
${GLSL_NOISE}
const vec3 MOONDIR = normalize(vec3(-0.18, 0.42, 1.0));
float hex2(vec2 p, float r){
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  vec2 d = p - vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(d) * sign(p.y - r);
}
// hexagonal ice spire along y, base at y=0, pyramid tip
float sdHex(vec3 p, float r, float h, float tip){
  float dxz = hex2(p.xz, r);
  float rr = clamp((dxz + r) / r, 0.0, 1.0);
  float top = p.y - (h + tip * (1.0 - rr));
  return max(max(dxz, -p.y), top * 0.6);
}
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float spires(vec3 p, out float glow){
  float d = 1e9; glow = 0.0;
  // (x, z, radius, height, tilt)
  vec4 S[9] = vec4[9](vec4(0.0, 0.0, 0.55, 5.2), vec4(-1.3, 0.4, 0.4, 3.4), vec4(1.2, 0.3, 0.42, 3.8),
    vec4(-0.6, -0.9, 0.3, 2.3), vec4(0.7, -1.0, 0.33, 2.6), vec4(-2.3, 1.2, 0.3, 2.0),
    vec4(2.2, 1.0, 0.28, 2.2), vec4(-1.9, -0.4, 0.22, 1.4), vec4(1.8, -0.5, 0.25, 1.6));
  for (int i = 0; i < 9; i++) {
    vec3 q = p - vec3(S[i].x, -0.2, S[i].y);
    float tilt = (S[i].x) * 0.07;
    q.xy = rot(q.xy, tilt);
    q.xz = rot(q.xz, float(i) * 0.7);
    float di = sdHex(q, S[i].z, S[i].w, S[i].z * 2.0);
    if (di < d) { d = di; glow = i == 0 ? 1.0 : 0.0; }
  }
  return d;
}
float ground(vec3 p){ return p.y + 0.3 - 0.35 * fbm2(p.xz * 0.35 + 2.0, 4) + 0.02 * length(p.xz); }
float map(vec3 p, out int m, out float glow){
  float a = spires(p, glow), b = ground(p);
  m = a < b ? 1 : 2;
  return min(a, b * 0.7);
}
float mapD(vec3 p){ int m; float g; return map(p, m, g); }
vec3 normal(vec3 p){
  vec2 e = vec2(0.003, 0.0);
  return normalize(vec3(mapD(p + e.xyy) - mapD(p - e.xyy), mapD(p + e.yxy) - mapD(p - e.yxy), mapD(p + e.yyx) - mapD(p - e.yyx)));
}
vec3 skyCol(vec3 rd){
  float y = rd.y;
  vec3 c = mix(vec3(0.05, 0.08, 0.16), vec3(0.004, 0.01, 0.035), smoothstep(-0.05, 0.6, y));
  // moon
  float md = dot(rd, MOONDIR);
  c += vec3(1.8, 1.9, 2.1) * smoothstep(0.99925, 0.9996, md) * (0.85 + 0.15 * fbm2(rd.xy * 90.0, 3));
  c += vec3(0.15, 0.18, 0.28) * pow(max(md, 0.0), 300.0) + vec3(0.03, 0.045, 0.08) * pow(max(md, 0.0), 12.0);
  // aurora: curtains folding across the upper sky
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    vec2 q = rd.xz / max(rd.y + 0.15, 0.05);
    float band = q.x * 0.6 + sin(q.y * 1.3 + fk * 2.0 + uTime * 0.15) * 0.8 + fbm2(vec2(q.y * 0.5, uTime * 0.05 + fk), 3) * 1.6;
    float curtain = exp(-pow((band - fk * 0.9 + 0.8) * 2.2, 2.0));
    float rays = 0.5 + 0.5 * fbm2(vec2(band * 6.0, q.y * 0.3 + uTime * 0.1), 3);
    c += mix(vec3(0.05, 0.9, 0.5), vec3(0.4, 0.2, 0.9), fk / 2.0) * curtain * rays * smoothstep(0.05, 0.4, rd.y) * 0.45;
  }
  // stars
  vec2 g = floor(rd.xy / max(rd.z, 0.2) * 260.0);
  c += vec3(0.8, 0.85, 1.0) * step(0.992, hash12(g)) * pow(hash12(g + 7.0), 3.0) * smoothstep(0.1, 0.5, rd.y) * 1.5;
  return c;
}
void main(){
  // card aspect: 185 x 400 on a 320 x 400 screen shown 4:3 -> 0.578 * 4/3 = 0.771
  vec2 uv = vUv - 0.5;
  uv.x *= 0.771;
  vec3 ro = vec3(1.2 * sin(uTime * 0.12), 1.0, -17.0);
  vec3 ta = vec3(0.0, 3.6, 0.0);
  vec3 f = normalize(ta - ro), r = normalize(cross(vec3(0.0, 1.0, 0.0), f)), u = cross(f, r);
  vec3 rd = normalize(f * 1.45 + r * uv.x + u * uv.y);
  float t = 0.0; int m = 0; float glow = 0.0; bool hit = false;
  for (int i = 0; i < 120; i++) {
    vec3 p = ro + rd * t;
    float d = map(p, m, glow);
    if (d < 0.0015 * t) { hit = true; break; }
    t += d;
    if (t > 40.0) break;
  }
  vec3 col = skyCol(rd);
  if (hit) {
    vec3 p = ro + rd * t, n = normal(p), v = -rd;
    vec3 L = MOONDIR;
    float ndl = max(dot(n, L), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    if (m == 1) {
      // ice: reflect the sky, glow from within (thickness-ish via view angle)
      vec3 refl = skyCol(reflect(rd, n));
      vec3 inner = vec3(0.12, 0.35, 0.55) * (0.3 + 0.9 * pow(1.0 - abs(dot(n, v)), 2.0));
      vec3 warm = vec3(1.6, 0.8, 0.3) * glow * exp(-max(p.y - 0.3, 0.0) * 0.9) * (0.85 + 0.15 * sin(uTime * 2.0));
      // bright facet edges
      col = inner * (0.25 + 0.8 * ndl) + refl * (0.35 + F) + warm * 0.5;
      col += vec3(1.2, 1.3, 1.5) * pow(max(dot(reflect(-L, n), v), 0.0), 80.0) * 2.0;
    } else {
      // snow: bright, bluish shadows, sparkle
      float sh = 1.0, st = 0.05;
      for (int k = 0; k < 24; k++) { float d = mapD(p + n * 0.01 + L * st); sh = min(sh, 8.0 * d / st); st += clamp(d, 0.03, 0.5); if (sh < 0.01) break; }
      sh = clamp(sh, 0.0, 1.0);
      vec3 snow = vec3(0.75, 0.82, 1.0);
      col = snow * (vec3(0.12, 0.16, 0.3) + vec3(1.2, 1.25, 1.4) * ndl * sh * 0.8);
      col += vec3(1.5) * step(0.997, hash12(floor(p.xz * 80.0))) * ndl * sh;
      // warm light spilling from the spire
      col += vec3(0.6, 0.3, 0.1) * exp(-length(p.xz) * 0.8) * 0.4;
    }
    col = mix(col, vec3(0.05, 0.08, 0.16), 1.0 - exp(-t * 0.02));
  }
  // falling snow
  for (int k = 0; k < 3; k++) {
    float z = 2.0 + float(k) * 2.5;
    vec2 q = uv * (6.0 + z * 2.0) + vec2(sin(uTime * 0.3 + float(k)) * 0.5, uTime * (0.6 - float(k) * 0.12));
    vec2 ci = floor(q), fq = fract(q) - 0.5;
    vec2 j = hash22(ci + float(k) * 13.0) - 0.5;
    float d = length(fq - j * 0.7);
    col += vec3(0.8, 0.85, 1.0) * smoothstep(0.06 - float(k) * 0.012, 0.0, d) * step(0.6, hash12(ci + 3.0)) * 0.6;
  }
  o = vec4(col, 1.0);
}`;

// jelly: the original's slide and spring, sampling the rendered card
export const JELLY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPic;
uniform float uScroll;
uniform vec2 uY;
uniform float uXsc;
uniform vec3 uWhite;       // fade towards white (U2E), x = amount
const float PI = 3.14159265;
vec3 pic(float u, float v){ return texture(uPic, vec2(u / 185.0, 1.0 - v / 400.0)).rgb; }
void main(){
  vec2 p = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 400.0);
  float fw = fwidth(p.x) * 0.5, fh = fwidth(p.y) * 0.5;
  vec3 c = vec3(0.0);
  if (uScroll >= 0.0) {
    float m = p.y + uScroll;
    float cov = (1.0 - smoothstep(400.0 - fh, 400.0 + fh, m)) * smoothstep(68.0 - fw, 68.0 + fw, p.x) * (1.0 - smoothstep(253.0 - fw, 253.0 + fw, p.x));
    if (cov > 0.0) c = pic(p.x - 68.0, m) * cov;
  } else {
    float y1 = uY.x, y2 = uY.y;
    float covy = smoothstep(y1 - fh, y1 + fh, p.y) * (1.0 - smoothstep(y2 - fh, y2 + fh, p.y));
    if (covy > 0.0) {
      float b = (p.y - y1) * 400.0 / (y2 - y1);
      float a = clamp(184.0 + 255.0 * sin(clamp(b, 0.0, 400.0) * 32.0 / 25.0 * PI / 512.0) * uXsc / 64.0, 140.0, 244.0);
      float le = 160.0 - a * 0.5, ri = 160.0 + a * 0.5 + 1.0;
      float cov = covy * smoothstep(le - fw, le + fw, p.x) * (1.0 - smoothstep(ri - fw, ri + fw, p.x));
      if (cov > 0.0) c = pic((p.x - le) * 185.0 / (a + 1.0), b) * cov;
    }
  }
  c = mix(c, vec3(uWhite.y), uWhite.x);
  o = vec4(c, 1.0);
}`;

let shared = null;
export class IceCard {
  static get(R) { return shared || (shared = new IceCard(R)); }
  constructor(R) {
    this.prog = R.fsProgram(FS);
    this.jelly = R.fsProgram(JELLY_FS);
    this.noise = getNoise(R);
  }
  // render the card into its own HDR texture (height follows the screen)
  render(R, t) {
    const gl = R.gl;
    const h = Math.max(200, Math.min(1400, R.vh)), w = Math.round(h * 185 / 400 * 1.6667 * 0.75 * 1.0);
    if (!this.tgt || this.tgt.h !== h) this.tgt = R.target(w, h, { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT });
    const prev = R.cur;
    R.bindTarget(this.tgt);
    this.prog.use().tex('uNoise', this.noise).f('uTime', t);
    R.drawFullscreen();
    R.bindTarget(prev);
    return this.tgt;
  }
}
