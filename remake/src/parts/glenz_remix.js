// GLENZ, remixed: the same simulation (fall, jello squash, bounce, the big
// glenz growing around the small one, the wipe and the red phase) drawn as
// raytraced glass. Both solids are convex, so each is traced exactly as the
// intersection of its face planes (from the simulated vertices every frame);
// three wavelengths give dispersion. The board becomes a brushed-metal slab
// with coloured transmission shadows; the original's row wipe dissolves its
// tiles front-ward.

export const REMIX_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec4 uPA[25]; uniform float uTA[25]; uniform int uNA;   // small glenz planes (n, d): inside when dot(n,p) <= d
uniform vec4 uPB[24]; uniform float uTB[24]; uniform int uNB;   // big glenz
uniform vec4 uSphA, uSphB;     // bounding spheres (c, r)
uniform float uH;              // board top (world y, down positive)
uniform float uBoard;          // board present
uniform float uWipeZ;          // tiles beyond this depth have dissolved
uniform float uRed;            // red phase
uniform float uBoardL;         // board light (the original's palette fade)
uniform float uTime;
const float FAR = 1e9;
const vec3 LDIR = normalize(vec3(-0.45, -1.0, -0.35));   // key light (towards light), y down
const float BX = 4400.0, BZ0 = 4400.0, BZ1 = 13200.0, BTH = 260.0;

float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

bool convA(vec3 ro, vec3 rd, out float tn, out float tf, out int fn, out int ff){
  tn = -FAR; tf = FAR; fn = -1; ff = -1;
  for (int i = 0; i < 25; i++) {
    if (i >= uNA) break;
    float dn = dot(uPA[i].xyz, rd), dist = uPA[i].w - dot(uPA[i].xyz, ro);
    if (abs(dn) < 1e-9) { if (dist < 0.0) return false; continue; }
    float t = dist / dn;
    if (dn < 0.0) { if (t > tn) { tn = t; fn = i; } } else { if (t < tf) { tf = t; ff = i; } }
  }
  return tn <= tf && tf > 0.0;
}
bool convB(vec3 ro, vec3 rd, out float tn, out float tf, out int fn, out int ff){
  tn = -FAR; tf = FAR; fn = -1; ff = -1;
  for (int i = 0; i < 24; i++) {
    if (i >= uNB) break;
    float dn = dot(uPB[i].xyz, rd), dist = uPB[i].w - dot(uPB[i].xyz, ro);
    if (abs(dn) < 1e-9) { if (dist < 0.0) return false; continue; }
    float t = dist / dn;
    if (dn < 0.0) { if (t > tn) { tn = t; fn = i; } } else { if (t < tf) { tf = t; ff = i; } }
  }
  return tn <= tf && tf > 0.0;
}
bool sphHit(vec3 ro, vec3 rd, vec4 s){
  vec3 oc = ro - s.xyz; float b = dot(oc, rd), c = dot(oc, oc) - s.w * s.w;
  return b * b - c > 0.0 && (b < 0.0 || c < 0.0);
}

vec3 tintA(int f){ return uTA[f] > 0.5 ? vec3(0.30, 0.55, 1.0) : vec3(0.92, 0.95, 1.0); }
vec3 tintB(int f){ return uTB[f] > 0.5 ? vec3(1.0, 0.16, 0.10) : vec3(1.0, 0.72, 0.68); }

// environment: dark studio, overhead softbox, faint horizon; red in the red phase
vec3 env(vec3 d){
  vec3 base = mix(vec3(0.006, 0.005, 0.009), vec3(0.02, 0.003, 0.002), uRed);
  float up = -d.y;
  vec3 c = base + vec3(0.02, 0.018, 0.03) * smoothstep(-0.1, 0.4, up) * (1.0 - uRed);
  // softbox above and slightly behind the camera line
  vec2 q = vec2(d.x / max(up, 1e-3), d.z / max(up, 1e-3));
  float box = up > 0.0 ? smoothstep(0.9, 0.7, abs(q.x + 0.35)) * smoothstep(0.8, 0.6, abs(q.y - 0.1)) : 0.0;
  c += box * mix(vec3(3.2, 3.0, 3.6), vec3(4.0, 0.6, 0.35), uRed);
  // key light glint
  c += pow(max(dot(d, LDIR), 0.0), 900.0) * mix(vec3(40.0), vec3(40.0, 8.0, 5.0), uRed);
  return c;
}

float edgeGlow(vec3 p, int face, bool isA){
  float m = FAR;
  for (int i = 0; i < 25; i++) {
    if (isA) { if (i >= uNA) break; if (i == face) continue; m = min(m, abs(uPA[i].w - dot(uPA[i].xyz, p))); }
    else { if (i >= uNB) break; if (i == face) continue; m = min(m, abs(uPB[i].w - dot(uPB[i].xyz, p))); }
  }
  return m;
}

// board: returns hit t and fills colour/normal-ish info
bool boardHit(vec3 ro, vec3 rd, out float t, out vec3 n){
  t = FAR; n = vec3(0.0, -1.0, 0.0);
  if (uBoard < 0.5) return false;
  if (rd.y > 1e-5) {
    float th = (uH - ro.y) / rd.y;
    vec3 p = ro + rd * th;
    if (th > 0.0 && abs(p.x) < BX && p.z > BZ0 && p.z < BZ1) {
      // dissolved tiles
      vec2 cell = floor(vec2(p.x, p.z) / 1100.0);
      float jit = hash(cell + 7.0) * 900.0;
      if (p.z + jit < uWipeZ + 900.0) { t = th; return true; }
    }
  }
  // front edge (thickness)
  if (rd.z > 1e-5) {
    float te = (BZ0 - ro.z) / rd.z;
    vec3 p = ro + rd * te;
    if (te > 0.0 && abs(p.x) < BX && p.y > uH && p.y < uH + BTH && BZ0 < uWipeZ + 200.0) { t = te; n = vec3(0.0, 0.0, -1.0); return true; }
  }
  return false;
}

// transmission of a shadow ray through the glass (coloured shadows)
vec3 shadowT(vec3 p){
  vec3 T = vec3(1.0);
  float tn, tf; int fn, ff;
  if (uNA > 0 && sphHit(p, LDIR, uSphA) && convA(p, LDIR, tn, tf, fn, ff) && tn > 0.0) T *= tintA(fn) * tintA(ff) * 0.72;
  if (uNB > 0 && sphHit(p, LDIR, uSphB) && convB(p, LDIR, tn, tf, fn, ff) && tn > 0.0) T *= tintB(fn) * tintB(ff) * 0.8;
  return T;
}

vec3 boardShade(vec3 p, vec3 n, vec3 rd){
  vec2 cell = floor(vec2(p.x, p.z) / 1100.0);
  float chk = mod(cell.x + cell.y, 2.0);
  vec3 a = pow(vec3(22.0, 16.0, 22.0) / 63.0, vec3(2.2)), b = pow(vec3(14.0, 10.0, 15.0) / 63.0, vec3(2.2));
  vec3 alb = mix(a, b, chk);
  // brushed streaks (the original board's diagonal strokes)
  float streak = hash(vec2(floor((p.x + p.z * 0.7) / 18.0), cell.x * 3.0 + cell.y));
  alb *= 0.8 + 0.35 * streak;
  if (n.z < -0.5) alb = pow(vec3(30.0, 24.0, 34.0) / 63.0, vec3(2.2));
  alb = mix(alb, alb * vec3(1.6, 0.25, 0.2), uRed);
  float ndl = max(dot(n, LDIR), 0.0);
  vec3 lit = alb * (0.05 + 1.6 * ndl * shadowT(p + n * 2.0));
  // tile seams
  vec2 f = fract(vec2(p.x, p.z) / 1100.0);
  float seam = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  lit *= mix(0.55, 1.0, smoothstep(0.0, 0.012, seam)) * uBoardL;
  // glowing edge on dissolving tiles
  float jit = hash(cell + 7.0) * 900.0;
  float edge = uWipeZ + 900.0 - (p.z + jit);
  if (uWipeZ < 20000.0) lit += vec3(1.6, 0.7, 1.9) * 3.0 * smoothstep(250.0, 0.0, edge);
  return lit;
}

// one wavelength through the scene
float trace(vec3 ro, vec3 rd, float ior, int ch){
  vec3 thr = vec3(1.0), acc = vec3(0.0);
  bool inA = false, inB = false, bounced = false;
  float dist = 0.0;
  for (int k = 0; k < 7; k++) {
    float tA = FAR, tB = FAR, tFl = FAR; int fA = -1, fB = -1; bool exA = false, exB = false;
    float tn, tf; int fn, ff;
    if (uNA > 0 && (inA || sphHit(ro, rd, uSphA)) && convA(ro, rd, tn, tf, fn, ff)) {
      if (tn > 1.0) { tA = tn; fA = fn; } else if (tf > 1.0) { tA = tf; fA = ff; exA = true; }
    }
    if (uNB > 0 && (inB || sphHit(ro, rd, uSphB)) && convB(ro, rd, tn, tf, fn, ff)) {
      if (tn > 1.0) { tB = tn; fB = fn; } else if (tf > 1.0) { tB = tf; fB = ff; exB = true; }
    }
    vec3 bn; bool fl = boardHit(ro, rd, tFl, bn);
    float t = min(tA, min(tB, tFl));
    if (t >= FAR * 0.5) { acc += thr * env(rd); break; }
    vec3 p = ro + rd * t;
    dist += t;
    if (t == tFl) {
      // lacquered board: diffuse here, then one glossy bounce that picks up
      // the glass and the studio (slightly roughened by the brush strokes)
      acc += thr * boardShade(p, bn, rd);
      if (bounced) break;
      bounced = true;
      float fr = 0.05 + 0.6 * pow(1.0 - max(dot(-rd, bn), 0.0), 5.0);
      thr *= fr * uBoardL * mix(vec3(0.9, 0.85, 1.0), vec3(1.0, 0.4, 0.35), uRed);
      rd = normalize(reflect(rd, bn) + vec3(hash(p.xz) - 0.5, 0.0, hash(p.zx) - 0.5) * 0.012);
      ro = p + bn * 2.0;
      continue;
    }
    bool isA = t == tA;
    int f = isA ? fA : fB;
    bool exiting = isA ? exA : exB;
    vec3 n = isA ? uPA[f].xyz : uPB[f].xyz;              // outward
    vec3 tint = isA ? tintA(f) : tintB(f);
    float cosi = abs(dot(rd, n));
    float F = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
    // edges catch the light: a thin hot line (about a pixel wide at any
    // distance) with a soft falloff; seen through glass they are dimmer
    float e = edgeGlow(p, f, isA), w = dist * 0.0016;
    vec3 glow = (isA ? vec3(0.55, 0.8, 1.6) : vec3(1.8, 0.4, 0.28))
      * (1.6 * smoothstep(w, 0.0, e) + 0.12 * smoothstep(6.0 * w, 0.0, e)) * (k == 0 ? 1.0 : 0.3);
    if (!exiting) {
      acc += thr * (env(reflect(rd, n)) * F + glow);
      thr *= (1.0 - F) * tint;
      vec3 r = refract(rd, n, 1.0 / ior);
      rd = r;
    } else {
      vec3 r = refract(rd, -n, ior);
      if (dot(r, r) < 1e-6) { rd = reflect(rd, -n); }
      else { thr *= tint; rd = r; acc += thr * glow * 0.4; }
    }
    if (isA) inA = !exiting; else inB = !exiting;
    ro = p + rd * 2.0;
  }
  return ch == 0 ? acc.r : (ch == 1 ? acc.g : acc.b);
}

void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec3 rd = normalize(vec3((s.x - 160.0) / 256.0, (s.y - 130.0) / 213.0, 1.0));
  vec3 ro = vec3(0.0);
  vec3 c = vec3(trace(ro, rd, 1.47, 0), trace(ro, rd, 1.50, 1), trace(ro, rd, 1.535, 2));
  o = vec4(c, 1.0);
}`;
