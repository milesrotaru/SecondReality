// PLZPART, remixed.
//  - The plasma is a slab of molten glass lit from within: the same two
//    plasmas (blended as the CRT did), palette-mapped, give the emission and
//    the relief; a clear coat reflects a studio. The original's "drop"
//    (line compare) makes the slab fall away, hinged at its lower edge.
//  - The cube is a bevelled glass box on the original spline path, its faces
//    the original's animated sine-plasma panels, over a dark mirror floor
//    that catches its reflection and its coloured light.

const PLASMA_COMMON = `
const float TAU = 6.283185307179586;
float P(float a){ a *= TAU / 4096.0; return sin(a) * 55.0 + sin(a * 6.0) * 5.0 + sin(a * 21.0) * 4.0 + 64.0; }
float L16(float a){ a *= TAU / 4096.0; return (sin(a) * 55.0 + sin(a * 4.0) * 5.0 + sin(a * 17.0) * 3.0 + 64.0) * 16.0; }
float L4(float a){ a *= TAU / 4096.0; return (sin(a) * 55.0 + sin(a * 5.0) * 8.0 + sin(a * 15.0) * 2.0 + 64.0) * 8.0; }
float plz(vec4 c, float cc, float y){
  float v = P(c.x + 8.0 * cc + L16(c.y + y + 4.0 * (80.0 - cc)))
          + P(c.z + 2.0 * y + 4.0 * (80.0 - cc) + L4(c.w + 16.0 * cc + y));
  return mod(v, 256.0);
}
vec3 pal(sampler2D t, float i){
  float a = floor(i);
  vec3 c0 = texelFetch(t, ivec2(int(a) & 255, 0), 0).rgb;
  vec3 c1 = texelFetch(t, ivec2((int(a) + 1) & 255, 0), 0).rgb;
  return mix(c0, c1, i - a);
}
`;

export const SLAB_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec4 uK, uL;
uniform sampler2D uPal;
uniform float uDrop;      // lines dropped (line compare - 60)
uniform float uTime;
${PLASMA_COMMON}
// plasma colour (linear) at plasma coordinates (column cc 0..80, line y 0..280)
vec3 plasma(float cc, float y){
  vec3 a = pal(uPal, plz(uK, cc, y)), b = pal(uPal, plz(uL, cc, y));
  return (pow(a, vec3(2.2)) + pow(b, vec3(2.2))) * 0.5;
}
float hgt(vec3 c){ return dot(c, vec3(0.35, 0.45, 0.2)); }
void main(){
  // screen in 320x400 units; the slab spans lines 60..340 at rest
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 400.0);
  // camera 900 units in front; world: x = s.x-160, y = (s.y-200)*0.6 (400-line rows)
  vec3 ro = vec3(0.0, 0.0, -900.0);
  vec3 rd = normalize(vec3(s.x - 160.0, (s.y - 200.0) * 0.6, 900.0));
  // the slab: hinged at its bottom edge (line 340), tipping back as it drops
  float k = clamp(uDrop / 280.0, 0.0, 1.5);
  float ang = 0.28 + k * k * 1.3 + 0.03 * sin(uTime * 0.5);
  float yb = (340.0 - 200.0) * 0.6 + uDrop * 0.6 * 0.35;   // hinge slides down too
  vec3 hinge = vec3(0.0, yb, 0.0);
  float c = cos(ang), sn = sin(ang);
  // plane through the hinge, rotated about x: normal
  vec3 n0 = vec3(0.0, -sn, -c);
  float t = dot(hinge - ro, n0) / dot(rd, n0);
  vec3 col = vec3(0.0);
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    vec3 q = p - hinge;
    // in-plane coordinates: along the tipped y axis
    vec3 ey = vec3(0.0, c, -sn);
    float ly = dot(q, ey);                 // <= 0 above the hinge
    float line = 280.0 + ly / 0.6;         // plasma line 0..280
    float cc = (p.x + 160.0 + 1.0 - 2.0) / 4.0;
    if (line >= 0.0 && line <= 280.0 && abs(p.x) <= 160.0) {
      vec3 e = plasma(cc, line);
      // relief from brightness (finite differences in plasma space)
      float h0 = hgt(e);
      float hx = hgt(plasma(cc + 0.35, line)), hy = hgt(plasma(cc, line + 1.2));
      vec3 nl = normalize(vec3(-(hx - h0) * 70.0, -(hy - h0) * 40.0, -1.0));
      // local (x, along-slab, towards-camera) -> world
      vec3 n = normalize(nl.x * vec3(1.0, 0.0, 0.0) + nl.y * ey - nl.z * n0);
      vec3 v = -rd;
      vec3 r = reflect(rd, n);
      // studio: two long softboxes and a dark room
      vec3 env = vec3(0.02) + vec3(0.10, 0.10, 0.13) * smoothstep(0.0, -0.8, r.y)
               + vec3(1.6, 1.5, 1.4) * smoothstep(0.965, 0.995, dot(r, normalize(vec3(-0.3, -0.35, -1.0))))
               + vec3(0.6, 0.7, 1.0) * smoothstep(0.95, 0.99, dot(r, normalize(vec3(0.45, 0.05, -1.0))));
      float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
      col = e * 1.15 * (1.0 - 0.5 * k) + env * (0.35 + F * 1.5);
      // edges of the slab catch light
      float edge = min(min(line, 280.0 - line) * 0.6, 160.0 - abs(p.x));
      col += e * 0.8 * exp(-edge / 1.5);
    }
  }
  o = vec4(col, 1.0);
}`;

export const CUBE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform mat3 uM;          // cube rotation (local -> camera)
uniform vec3 uT;          // cube centre (camera space, y down)
uniform vec4 uAx[6], uAy[6];   // per face: texcoord = (dot(Ax.xyz,p)+Ax.w, dot(Ay.xyz,p)+Ay.w)
uniform int uBlk[6];
uniform float uDD;
uniform vec3 uLs;         // light direction (camera space)
uniform float uFade;
const float TAU = 6.283185307179586;
const float B = 125.0, RAD = 16.0;
float S(float a){ return 127.0 * sin(a * TAU / 512.0); }
vec3 blockPal(float k, int blk){
  k = clamp(k, 0.0, 63.0);
  float h = max(k - 32.0, 0.0);
  vec3 c;
  if (blk == 0) c = k < 32.0 ? vec3(0.0, 0.0, 2.0 * k) : vec3(2.0 * h, 2.0 * h, 63.0);
  else if (blk == 1) c = k < 32.0 ? vec3(2.0 * k, 0.0, 0.0) : vec3(63.0, 2.0 * h, 0.0);
  else c = k < 32.0 ? vec3(k, 0.0, k * 2.0 / 3.0) : vec3(31.0 - h, 2.0 * h, 21.0);
  return pow(c / 63.0, vec3(2.2));
}
vec3 panel(int f, vec3 lp){
  vec2 T = vec2(dot(uAx[f].xyz, lp) + uAx[f].w, dot(uAy[f].xyz, lp) + uAy[f].w);
  float tx = T.x + S((T.y + uDD) * 8.0) / 3.0;
  float k = S(T.y * 4.0 + S(tx * 2.0)) / 4.0 + 32.0;
  return blockPal(k, uBlk[f]);
}
float sdBox(vec3 p){ vec3 q = abs(p) - vec3(B - RAD); return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - RAD; }
int faceOf(vec3 lp){
  vec3 a = abs(lp);
  if (a.z >= a.x && a.z >= a.y) return lp.z > 0.0 ? 0 : 1;
  if (a.x >= a.y) return lp.x > 0.0 ? 2 : 4;
  return lp.y > 0.0 ? 5 : 3;
}
vec3 env(vec3 r){
  return vec3(0.004) + vec3(1.4, 1.35, 1.3) * smoothstep(0.92, 0.99, dot(r, normalize(vec3(-0.4, -0.7, -0.5))))
       + vec3(0.5, 0.6, 0.9) * smoothstep(0.85, 0.97, dot(r, normalize(vec3(0.8, -0.3, -0.4)))) * 0.6;
}
// hit the cube along a ray (camera space); returns t or -1, with colour
float cube(vec3 ro, vec3 rd, out vec3 col, out vec3 glow){
  mat3 Mi = transpose(uM);
  vec3 lo = Mi * (ro - uT), ld = Mi * rd;
  // bounding sphere
  float b = dot(lo, ld), c = dot(lo, lo) - 3.0 * B * B, h = b * b - c;
  col = vec3(0.0); glow = vec3(0.0);
  if (h < 0.0) return -1.0;
  float t = max(-b - sqrt(h), 0.0), tf = -b + sqrt(h);
  for (int i = 0; i < 64; i++) {
    vec3 p = lo + ld * t;
    float d = sdBox(p);
    if (d < 0.05) {
      vec2 e = vec2(0.5, 0.0);
      vec3 nl = normalize(vec3(sdBox(p + e.xyy) - sdBox(p - e.xyy), sdBox(p + e.yxy) - sdBox(p - e.yxy), sdBox(p + e.yyx) - sdBox(p - e.yyx)));
      int f = faceOf(p);
      vec3 em = panel(f, p);
      vec3 n = uM * nl;
      vec3 v = -rd;
      float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
      // the panel sits under a glass layer: emission, the original's face
      // light as a soft key, reflections, and bright bevels
      float key = 0.55 + 0.45 * max(dot(n, normalize(uLs)), 0.0);
      vec3 ap = abs(p);
      float bevel = smoothstep(B - RAD * 1.4, B - 1.0, max(max(min(ap.x, ap.y), min(ap.y, ap.z)), min(ap.x, ap.z)));
      col = em * 1.6 * key * (1.0 - bevel * 0.7) + env(reflect(rd, n)) * (F + bevel * 0.8);
      glow = em;
      return t;
    }
    t += d;
    if (t > tf) break;
  }
  return -1.0;
}
void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec3 rd = normalize(vec3((s.x - 160.0) / 256.0, (s.y - 99.0) / 213.0, 1.0));
  vec3 ro = vec3(0.0);
  vec3 col, glow;
  float t = cube(ro, rd, col, glow);
  if (t < 0.0) {
    col = vec3(0.0);
    // mirror floor below the path
    const float FY = 430.0;
    if (rd.y > 0.0) {
      float tf = FY / rd.y;
      vec3 p = rd * tf;
      vec3 rr = vec3(rd.x, -rd.y, rd.z);
      vec3 rc, rg;
      float t2 = cube(p, rr, rc, rg);
      float F = 0.08 + 0.9 * pow(1.0 - rd.y, 5.0);
      vec3 base = vec3(0.004, 0.004, 0.006);
      // pooled light from the cube's faces (a soft area light at its centre)
      vec3 dl = uT - p;
      float dist = length(dl);
      vec3 avg = panel(0, vec3(0.0, 0.0, B)) + panel(2, vec3(B, 0.0, 0.0)) + panel(3, vec3(0.0, -B, 0.0));
      base += avg * 0.35 * 1.5e5 / (dist * dist + 3e4) * max(-dl.y / dist, 0.0);
      col = base + (t2 > 0.0 ? rc * 0.55 : vec3(0.0)) * F * exp(-tf / 6000.0);
      col *= exp(-tf / 9000.0);
    }
  }
  o = vec4(col * uFade, 1.0);
}`;
