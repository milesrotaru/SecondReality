// RAYSCRL, remixed: Trug's raytraced picture, raytraced live. The strip's
// scatter tables say it is a flat card: a homography fitted to its directly
// seen part (2 px RMS) gives, for a camera of focal 256 (VGA pixels 1:1.2),
// the card as P(u,v) = L*(A*u + B*v + C) in camera space; the scale L places
// it so that it flies up from the spheres and over the viewer's head. The
// water (camera 100 above it, looking 22 degrees down) ripples outward from
// the picture's ring centre; the three glossy spheres rest where the picture
// has them; everything reflects everything, so the fire and the sword show in
// the balls and the water as they did in the precomputed tables.

export const RAY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uStrip;     // 400 x 34, premultiplied
uniform float uN;             // scroll events (continuous)
uniform vec4 uSph[3];
uniform vec3 uCA, uCB, uCC;   // card basis (already scaled)
uniform vec3 uRip;            // ripple centre (camera space)
uniform float uTime;
uniform vec2 uFade;
const float F = 256.0;
const float PITCH = 0.383972;   // 22 degrees
const float CAMH = 100.0;
const vec3 UP = vec3(0.0, -cos(PITCH), -sin(PITCH));
const vec3 L = normalize(vec3(-0.55, -0.8, -0.25));
vec3 sky(vec3 d){
  float u = dot(d, UP);
  vec3 c = mix(vec3(0.004, 0.006, 0.03), vec3(0.01, 0.015, 0.07), smoothstep(-0.1, 0.6, u));
  c += vec3(3.0, 3.1, 3.4) * pow(max(dot(d, L), 0.0), 300.0) * 4.0;
  // a second light ahead and high: its glints ride the ripples
  vec3 L2 = normalize(vec3(-0.02, -0.695, 0.72));
  c += vec3(2.4, 2.5, 3.0) * pow(max(dot(d, L2), 0.0), 1500.0) * 4.0 + vec3(0.05, 0.06, 0.14) * pow(max(dot(d, L2), 0.0), 60.0);
  c += vec3(0.12, 0.14, 0.3) * pow(max(dot(d, L), 0.0), 8.0);
  return c;
}
// card: returns (u, v, t) or t < 0
vec3 card(vec3 ro, vec3 rd){
  // solve u*A + v*B - t*rd = ro - C
  vec3 r = ro - uCC;
  vec3 c0 = uCA, c1 = uCB, c2 = -rd;
  float det = dot(c0, cross(c1, c2));
  if (abs(det) < 1e-9) return vec3(0.0, 0.0, -1.0);
  float u = dot(r, cross(c1, c2)) / det;
  float v = dot(c0, cross(r, c2)) / det;
  float t = dot(c0, cross(c1, r)) / det;
  return vec3(u, v, t);
}
vec4 cardTex(vec2 uv){
  if (uv.x < 0.0 || uv.x > 158.5 || uv.y < 0.0 || uv.y > 34.0) return vec4(0.0);
  float fx = min(uv.x + uN - 159.0, 390.0);
  if (fx < -0.5) return vec4(0.0);
  vec4 c = texture(uStrip, vec2((fx + 0.5) / 400.0, (uv.y) / 34.0));
  return c;
}
float ripple(vec3 p){
  vec3 q = p - uRip;
  float r = length(q - UP * dot(q, UP));
  return sin(r * 0.21 - uTime * 2.2) * 0.9 * exp(-r / 160.0) + sin(r * 0.09 - uTime * 1.1) * 0.5 * exp(-r / 300.0);
}
vec3 waterN(vec3 p){
  vec3 q = p - uRip;
  vec3 radial = q - UP * dot(q, UP);
  float r = length(radial);
  vec3 dir = r > 1e-3 ? radial / r : vec3(1.0, 0.0, 0.0);
  float dh = cos(r * 0.21 - uTime * 2.2) * 0.9 * 0.21 * exp(-r / 160.0) + cos(r * 0.09 - uTime * 1.1) * 0.5 * 0.09 * exp(-r / 300.0);
  return normalize(UP - dir * dh * 0.9);
}
void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec3 ro = vec3(0.0);
  vec3 rd = normalize(vec3((s.x - 160.0) / F, (s.y - 100.0) / (F * 1.2), 1.0));
  vec3 acc = vec3(0.0), thr = vec3(1.0);
  for (int bounce = 0; bounce < 4; bounce++) {
    float tBest = 1e9; int kind = 0; int si = -1;
    // water
    float dn = dot(rd, UP);
    if (dn < -1e-4) { float t = (-CAMH - dot(ro, UP)) / dn; if (t > 0.01 && t < tBest) { tBest = t; kind = 1; } }
    // spheres
    for (int i = 0; i < 3; i++) {
      vec3 oc = ro - uSph[i].xyz; float b = dot(oc, rd), c = dot(oc, oc) - uSph[i].w * uSph[i].w, h = b * b - c;
      if (h > 0.0) { float t = -b - sqrt(h); if (t > 0.01 && t < tBest) { tBest = t; kind = 2; si = i; } }
    }
    // the card (in front of whatever else was hit)
    vec3 cu = card(ro, rd);
    if (cu.z > 0.01 && cu.z < tBest) {
      vec4 tx = cardTex(cu.xy);
      if (tx.a > 0.001) {
        vec3 em = tx.rgb / max(tx.a, 1e-3);
        vec3 lin = pow(em, vec3(2.2));
        // fire glows; steel catches the light
        float fire = smoothstep(0.1, 0.5, lin.r - lin.b);
        acc += thr * tx.a * lin * (1.0 + 2.5 * fire);
        thr *= 1.0 - tx.a;
      }
    }
    if (kind == 0) { acc += thr * sky(rd); break; }
    vec3 p = ro + rd * tBest;
    if (kind == 1) {
      vec3 n = waterN(p);
      float Fr = 0.03 + 0.97 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
      vec3 body = vec3(0.004, 0.006, 0.035) * (0.4 + 0.6 * max(dot(n, L), 0.0));
      acc += thr * body * (1.0 - Fr);
      thr *= mix(vec3(0.3, 0.35, 0.6), vec3(1.0), Fr);
      ro = p + n * 0.05; rd = reflect(rd, n);
    } else {
      vec3 n = normalize(p - uSph[si].xyz);
      float Fr = 0.06 + 0.94 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
      vec3 alb = vec3(0.008, 0.012, 0.11);
      float ndl = max(dot(n, L), 0.0);
      acc += thr * alb * (ndl * 1.1 + 0.04);
      acc += thr * vec3(2.5) * pow(max(dot(reflect(rd, n), L), 0.0), 120.0);
      thr *= mix(vec3(0.25, 0.3, 0.7), vec3(1.0), Fr) * 0.8;
      ro = p + n * 0.05; rd = reflect(rd, n);
    }
    if (max(thr.r, max(thr.g, thr.b)) < 0.01) break;
  }
  // the original fades red at twice the rate (for pf := 0 to 3)
  vec3 c = acc;
  c *= vec3(min(1.0, uFade.x * 2.0), uFade.x, uFade.x);
  c *= vec3(max(0.0, 1.0 - uFade.y * 2.0), 1.0 - uFade.y, 1.0 - uFade.y);
  o = vec4(c, 1.0);
}`;

// card basis from the fitted homography (camera K: f=256, fy=307.2, c=(160,100))
export function cardBasis() {
  const H = [[-5.15158723, 2.0904608, 309.632827], [-3.08074559, -3.72333584, 257.483935], [-0.0248980203, 0.000170008591, 1.0]];
  const f = 256, fy = 307.2;
  const Kinv = (v) => [(v[0] - 160 * v[2]) / f, (v[1] - 100 * v[2]) / fy, v[2]];
  const col = (j) => Kinv([H[0][j], H[1][j], H[2][j]]);
  const lam = -60;
  return [col(0), col(1), col(2)].map((v) => v.map((x) => x * lam));
}

// spheres resting on the water, matching the picture's (x, y, pixel radius)
export function spheres() {
  const f = 256, fy = 307.2, p = 22 * Math.PI / 180, h = 100;
  const up = [0, -Math.cos(p), -Math.sin(p)];
  const out = [];
  for (const [sx, sy, pr] of [[252, 30, 66], [272, 170, 64], [254, 66, 14]]) {
    const d = [(sx - 160) / f, (sy - 100) / fy, 1];
    const dl = Math.hypot(...d);
    const du = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    // centre height above water = radius; radius ~ pixel radius * distance / f
    const t = -h / (du - pr * dl / f);
    const C = d.map((x) => x * t);
    out.push(C[0], C[1], C[2], pr * dl * t / f);
  }
  return new Float32Array(out);
}

export function rippleCentre() {
  const f = 256, fy = 307.2, p = 22 * Math.PI / 180, h = 100;
  const up = [0, -Math.cos(p), -Math.sin(p)];
  const d = [(155 - 160) / f, (100 - 100) / fy, 1];
  const du = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
  const t = -h / du;
  return d.map((x) => x * t);
}
