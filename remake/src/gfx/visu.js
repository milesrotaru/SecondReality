// HD renderer for Psi's VISU vector engine (VISU/*.ASM, VISU/C/U2A.C):
// same fixed-point scene data, animation stream, camera, projection and
// light model, drawn with a depth buffer, MSAA and per-pixel shading.

const UNIT = 16384;
// VISU/ADRAW.ASM newlight (camera space), |L| ~= UNIT
const LIGHT = [12118 / UNIT, 10603 / UNIT, 3030 / UNIT];
// VISU/AVISTAN.INC: 256/tan(angle), 256 entries per 90 degrees
const AVISTAN = [32767, 32767, 20859, 13905, 10428, 8341, 6950, 5956, 5210, 4631, 4166, 3787, 3470, 3202, 2972, 2773, 2599, 2445, 2308, 2185, 2075, 1975, 1884, 1801,
  1725, 1655, 1591, 1531, 1475, 1423, 1374, 1329, 1286, 1246, 1209, 1173, 1140, 1108, 1077, 1049, 1022, 996, 971, 947, 925, 903, 882, 862, 843, 825, 808, 791, 774, 759, 744, 729, 715, 701, 688, 675,
  663, 651, 640, 628, 618, 607, 597, 587, 577, 568, 558, 549, 541, 532, 524, 516, 508, 500, 493, 486, 478, 471, 465, 458, 451, 445, 439, 433, 427, 421, 415, 409, 404, 398, 393, 388,
  383, 378, 373, 368, 363, 358, 354, 349, 345, 340, 336, 332, 328, 323, 319, 315, 311, 308, 304, 300, 296, 293, 289, 285, 282, 278, 275, 272, 268, 265, 262, 259, 256, 252, 249, 246,
  243, 240, 237, 234, 232, 229, 226, 223, 220, 218, 215, 212, 210, 207, 204, 202, 199, 197, 194, 192, 189, 187, 185, 182, 180, 177, 175, 173, 171, 168, 166, 164, 162, 159, 157, 155,
  153, 151, 149, 147, 145, 142, 140, 138, 136, 134, 132, 130, 128, 126, 124, 123, 121, 119, 117, 115, 113, 111, 109, 107, 106, 104, 102, 100, 98, 96, 95, 93, 91, 89, 88, 86,
  84, 82, 81, 79, 77, 75, 74, 72, 70, 69, 67, 65, 64, 62, 60, 59, 57, 55, 54, 52, 50, 49, 47, 46];
function avistan(i) {
  if (i < AVISTAN.length) return AVISTAN[i];
  // table tail (entries 228..255) continues towards 0: 256/tan(i*90/256 deg)
  return Math.max(1, Math.round(256 / Math.tan((i * 90 / 256) * Math.PI / 180)));
}

// vid_cameraangle(): projmulx/projmuly for a given fov (0..65535 = 360deg)
export function cameraMul(fov, halfWidth = 160, aspect = 225) {
  let bx = fov >> 1;
  if (bx < 8 * 64) bx = 8 * 64;
  if (bx >= 16384) bx = 16383;
  const idx = bx >> 6;
  const mulx = (halfWidth * avistan(idx)) >> 8;
  const muly = (mulx * aspect) >> 8;
  return [mulx, muly];
}

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aVN;
layout(location=2) in vec3 aFN;
layout(location=3) in vec4 aMisc; // color, flags, rank, face-dist-sign-helper
uniform mat3 uM;      // rotation (object*camera), already divided by UNIT
uniform vec3 uT;      // translation in camera space
uniform vec4 uProj;   // mulx, muly, addx, addy (VGA pixel space)
uniform vec2 uNearFar;
uniform vec2 uScreen; // virtual screen size (320,200)
out vec3 vN;
out vec3 vFN;
out vec3 vPos;
out vec3 vObj;
flat out float vColor;
flat out float vFlags;
flat out float vRank;
flat out float vFacing;
void main(){
  vec3 p = uM * aPos + uT;
  vPos = p;
  vObj = aPos;
  vN = uM * aVN;
  vFN = uM * aFN;
  vColor = aMisc.x; vFlags = aMisc.y; vRank = aMisc.z;
  vFacing = dot(vFN, p);
  float z = p.z;
  // screen = add + v*mul/z  (pixel centres at +0.5)
  float xc = ((uProj.z + 0.5) * 2.0 / uScreen.x - 1.0) * z + p.x * uProj.x * 2.0 / uScreen.x;
  float yc = (1.0 - (uProj.w + 0.5) * 2.0 / uScreen.y) * z - p.y * uProj.y * 2.0 / uScreen.y;
  float zc = ((z - uNearFar.x) / (uNearFar.y - uNearFar.x) * 2.0 - 1.0) * z;
  gl_Position = vec4(xc, yc, zc, z);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vFN;
in vec3 vPos;
flat in float vColor;
flat in float vFlags;
flat in float vRank;
flat in float vFacing;
uniform sampler2D uPal;   // 256x1 palette
uniform vec3 uLight;
uniform vec2 uNearFar;
uniform float uBias;      // per-object depth bias (draw order)
uniform float uLevelAdd;  // optional brightness tweak
out vec4 o;
vec3 pal(float i){ return texelFetch(uPal, ivec2(int(clamp(i, 0.0, 255.0)), 0), 0).rgb; }
void main(){
  int fl = int(vFlags + 0.5);
  bool twoSided = (fl & 0x200) != 0;
  if (!twoSided && vFacing >= 0.0) discard;
  int shade = (fl >> 10) & 3;
  bool gouraud = (fl & 0x1000) != 0;
  float level = 1.0;
  if (shade != 0) {
    vec3 n = gouraud ? normalize(vN) : normalize(vFN);
    float b = clamp(128.0 + 128.0 * dot(n, uLight), 0.0, 255.0);
    level = b / float(1 << (6 - shade)) + uLevelAdd;
    level = clamp(level, 1.0, 30.0);
    float maxl = shade == 1 ? 7.0 : (shade == 2 ? 15.0 : 30.0);
    level = min(level, maxl);
  }
  float ci = vColor + level;
  float i0 = floor(ci);
  vec3 c = mix(pal(i0), pal(i0 + 1.0), ci - i0);
  o = vec4(c, 1.0);
  // log depth: uniform precision over 512..1e7
  float d = log2(max(vPos.z, 1.0) / uNearFar.x) / log2(uNearFar.y / uNearFar.x);
  gl_FragDepth = clamp(d - uBias, 0.0, 1.0);
}`;

// Remix shading: the palette ramp gives the albedo, lighting is physical-ish
// (GGX specular, Fresnel, hemisphere ambient, a point light, fog), linear HDR.
export const REMIX_FS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vFN;
in vec3 vPos;
in vec3 vObj;
flat in float vColor;
flat in float vFlags;
flat in float vRank;
flat in float vFacing;
uniform sampler2D uPal;
uniform vec2 uNearFar;
uniform float uBias;
uniform float uLights;              // hull lights (object-space grid) amount
uniform vec3 uThrust;               // camera-space direction engines point to (0 = none)
uniform vec3 uKey, uKeyC;           // towards the key light (camera space, y down), colour
uniform vec3 uSkyC, uGndC;          // hemisphere ambient / reflections
uniform vec3 uFogC; uniform float uFogD;
uniform vec3 uPt, uPtC;             // point light (camera space)
uniform float uRough, uMetal;
uniform mat3 uCamInv;               // camera -> world rotation
uniform vec3 uCamW;                 // camera position (world)
uniform mat4 uL;                    // world -> light clip
uniform sampler2D uShadow;
uniform float uShadowOn;
uniform vec3 uUp;                   // world up (in the uCamInv frame)
out vec4 o;
float shadowAt(vec3 cpos, vec3 n){
  if (uShadowOn < 0.5) return 1.0;
  vec3 w = uCamInv * cpos + uCamW;
  vec4 l = uL * vec4(w, 1.0);
  vec3 q = l.xyz * 0.5 + 0.5;
  if (any(lessThan(q.xy, vec2(0.0))) || any(greaterThan(q.xy, vec2(1.0)))) return 1.0;
  vec2 ts = 1.0 / vec2(textureSize(uShadow, 0));
  float bias = 0.0015;
  float s = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++)
    s += texture(uShadow, q.xy + vec2(i, j) * ts * 1.5).r < q.z - bias ? 0.0 : 1.0;
  return s / 9.0;
}
vec3 pal(float i){ return texelFetch(uPal, ivec2(int(clamp(i, 0.0, 255.0)), 0), 0).rgb; }
vec3 env(vec3 r){ return mix(uGndC, uSkyC, smoothstep(-0.25, 0.35, dot(uCamInv * r, uUp))); }
void main(){
  int fl = int(vFlags + 0.5);
  bool twoSided = (fl & 0x200) != 0;
  if (!twoSided && vFacing >= 0.0) discard;
  int shade = (fl >> 10) & 3;
  bool gouraud = (fl & 0x1000) != 0;
  float maxl = shade == 1 ? 7.0 : (shade == 2 ? 15.0 : 30.0);
  vec3 base = shade == 0 ? pal(vColor) : pal(vColor + floor(maxl * 0.62));
  vec3 alb = pow(base, vec3(2.2));
  vec3 n = normalize(gouraud ? vN : vFN);
  if (dot(n, vPos) > 0.0) n = -n;
  vec3 v = normalize(-vPos);
  float nv = max(dot(n, v), 1e-3);
  float a = uRough * uRough;
  vec3 F0 = mix(vec3(0.04), alb, uMetal);
  vec3 col = vec3(0.0);
  float sh = shadowAt(vPos + n * 8.0, n);
  for (int k = 0; k < 2; k++) {
    vec3 L = k == 0 ? uKey : normalize(uPt - vPos);
    vec3 C = k == 0 ? uKeyC * sh : uPtC * 1e8 / (dot(uPt - vPos, uPt - vPos) + 1e6);
    float nl = max(dot(n, L), 0.0);
    if (nl <= 0.0) continue;
    vec3 h = normalize(L + v);
    float nh = max(dot(n, h), 0.0);
    float d = nh * nh * (a * a - 1.0) + 1.0;
    float D = a * a / (3.14159 * d * d);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
    float G = 0.5 / (nl * (nv * (1.0 - a) + a) + nv * (nl * (1.0 - a) + a));
    col += C * nl * ((1.0 - F) * alb * (1.0 - uMetal) / 3.14159 + D * G * F);
  }
  vec3 Fv = F0 + (1.0 - F0) * pow(1.0 - nv, 5.0);
  col += alb * (1.0 - uMetal) * mix(uGndC, uSkyC, 0.5 + 0.5 * dot(uCamInv * n, uUp)) * 0.5;
  col += env(reflect(-v, n)) * Fv * (1.0 - a * 0.7);
  // hull lights: sparse warm dots on a grid in object space, engines glow
  if (uLights > 0.0) {
    vec3 q = vObj / 180.0;
    vec3 c = floor(q), f = fract(q) - 0.5;
    float h = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float px = length(fwidth(q)) + 1e-4;
    float r = 0.1;
    float dot3 = mix(smoothstep(r + px, r - px, length(f)), 3.14159 * r * r, smoothstep(r * 0.5, r * 2.5, px));
    col += step(0.92, h) * dot3 * mix(vec3(3.0, 1.9, 1.0), vec3(1.2, 1.8, 3.0), step(0.95, h)) * uLights;
  }
  if (dot(uThrust, uThrust) > 0.0) {
    float e = smoothstep(0.75, 0.95, dot(n, uThrust));
    col += e * vec3(0.9, 1.6, 4.0) * (0.6 + 0.4 * fract(sin(dot(floor(vObj / 60.0), vec3(1.3, 7.1, 3.7))) * 999.0));
  }
  col = mix(col, uFogC, 1.0 - exp(-vPos.z * uFogD));
  o = vec4(col, 1.0);
  float dd = log2(max(vPos.z, 1.0) / uNearFar.x) / log2(uNearFar.y / uNearFar.x);
  gl_FragDepth = clamp(dd - uBias, 0.0, 1.0);
}`;

const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat3 uO; uniform vec3 uOp; uniform mat4 uL;
void main(){ vec3 w = uO * aPos + uOp; gl_Position = uL * vec4(w, 1.0); }`;
const SHADOW_FS = `#version 300 es
precision highp float;
out vec4 o;
void main(){ o = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); }`;

export class VisuScene {
  constructor(R, A, key, opts = {}) {
    this.R = R;
    const gl = R.gl;
    const sc = A.json(key + '.scene');
    this.conum = sc.conum;
    this.index = sc.index;
    this.stream = A.bytes(key + '.anim');
    this.palette = new Uint8Array(A.bytes(key + '.pal'));
    this.near = opts.near ?? 512;
    this.far = opts.far ?? 9999999;
    this.prog = R.program(VS, FS);
    this.remixProg = R.program(VS, REMIX_FS);
    // GPU meshes per distinct object file
    this.meshes = {};
    for (const [id, o] of Object.entries(sc.objs)) this.meshes[id] = this.buildMesh(gl, o);
    this.objName = [];
    for (let c = 1; c < this.conum; c++) this.objName[c] = sc.objs[this.index[c]].name;
    this.decode();
    this.palTex = R.texture(256, 1, { filter: gl.NEAREST });
    this.setPalette(this.palette);
  }

  setPalette(pal6) {
    const d = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      d[i * 4] = Math.round(pal6[i * 3] * 255 / 63);
      d[i * 4 + 1] = Math.round(pal6[i * 3 + 1] * 255 / 63);
      d[i * 4 + 2] = Math.round(pal6[i * 3 + 2] * 255 / 63);
      d[i * 4 + 3] = 255;
    }
    this.R.update(this.palTex, d);
  }

  // One vertex buffer per painter's list (VISU keeps 8 view-direction
  // sorted polygon lists per object; the list whose sort vertex is nearest
  // the camera is used).
  buildMesh(gl, o) {
    const V = o.v, N = o.n, VN = o.vn;
    const polyVerts = (p) => {
      const [flags, color, normal, ...vs] = p;
      const fn = [N[normal * 3], N[normal * 3 + 1], N[normal * 3 + 2]];
      const out = [];
      const emit = (vi) => {
        const ni = VN[vi];
        const vn = ni >= 0 && ni * 3 < N.length ? [N[ni * 3], N[ni * 3 + 1], N[ni * 3 + 2]] : fn;
        out.push(V[vi * 3], V[vi * 3 + 1], V[vi * 3 + 2], vn[0], vn[1], vn[2], fn[0], fn[1], fn[2], color, flags, 0);
      };
      for (let k = 1; k + 1 < vs.length; k++) { emit(vs[0]); emit(vs[k]); emit(vs[k + 1]); }
      return out;
    };
    const lists = [];
    for (const [sortv, order] of o.lists) {
      const data = [];
      for (const pi of order) data.push(...polyVerts(o.p[pi]));
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      const st = 12 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 24);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, st, 36);
      gl.bindVertexArray(null);
      lists.push({ vao, count: data.length / 12, sortv: [V[sortv * 3], V[sortv * 3 + 1], V[sortv * 3 + 2]] });
    }
    // centre vertex of list 0 (ORD0 word 1) for object distance sorting
    return { lists, name: o.name };
  }

  // Decode the whole animation stream into per-frame object states.
  decode() {
    const d = this.stream, conum = this.conum;
    let sp = 0;
    const on = new Uint8Array(conum);
    const m = new Float64Array(conum * 9);
    const p = new Float64Array(conum * 3);
    const frames = [];
    const lsget = (f) => {
      switch (f & 3) {
        case 0: return 0;
        case 1: { const v = d[sp++]; return v > 127 ? v - 256 : v; }
        case 2: { const v = d[sp] | (d[sp + 1] << 8); sp += 2; return v > 32767 ? v - 65536 : v; }
        default: { const v = (d[sp] | (d[sp + 1] << 8) | (d[sp + 2] << 16) | (d[sp + 3] << 24)); sp += 4; return v; }
      }
    };
    let fov = 0;
    for (;;) {
      let onum = 0, end = false;
      for (;;) {
        let a = d[sp++];
        if (a === 0xff) {
          a = d[sp++];
          if (a <= 0x7f) { fov = a << 8; break; }
          if (a === 0xff) { end = true; break; }
        }
        if ((a & 0xc0) === 0xc0) { onum = (a & 0x3f) << 4; a = d[sp++]; }
        onum = (onum & 0xff0) | (a & 0xf);
        if ((a & 0xc0) === 0x80) on[onum] = 1;
        else if ((a & 0xc0) === 0x40) on[onum] = 0;
        let pf = 0;
        switch (a & 0x30) {
          case 0x10: pf = d[sp++]; break;
          case 0x20: pf = d[sp] | (d[sp + 1] << 8); sp += 2; break;
          case 0x30: pf = d[sp] | (d[sp + 1] << 8) | (d[sp + 2] << 16); sp += 3; break;
        }
        p[onum * 3] += lsget(pf); p[onum * 3 + 1] += lsget(pf >> 2); p[onum * 3 + 2] += lsget(pf >> 4);
        const w = pf & 0x40 ? 2 : 1;
        for (let b = 0; b < 9; b++) if (pf & (0x80 << b)) m[onum * 9 + b] += lsget(w);
      }
      if (end) break;
      frames.push({ fov, on: on.slice(), m: Float32Array.from(m), p: Float32Array.from(p) });
      if (sp >= d.length) break;
    }
    this.frames = frames;
  }

  get frameCount() { return this.frames.length; }

  // camera (object 0) at fractional frame f: rotation normalised to 1 and
  // translation; camera = Cn * world + cp
  cameraAt(f) {
    const n = this.frames.length;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(f))), i1 = Math.min(n - 1, i0 + 1);
    const A = this.frames[i0], B = this.frames[i1];
    let dp = 0, dm = 0;
    for (let j = 0; j < 3; j++) dp = Math.max(dp, Math.abs(B.p[j] - A.p[j]));
    for (let j = 0; j < 9; j++) dm = Math.max(dm, Math.abs(B.m[j] - A.m[j]));
    const a = dp > 20000 || dm > 4000 ? 0 : f - i0;
    const C = new Float64Array(9), cp = [0, 0, 0];
    for (let j = 0; j < 9; j++) C[j] = (A.m[j] + (B.m[j] - A.m[j]) * a) / UNIT;
    for (let j = 0; j < 3; j++) cp[j] = A.p[j] + (B.p[j] - A.p[j]) * a;
    // camera position in the world: -C^T cp
    const W = [0, 1, 2].map((k) => -(C[k] * cp[0] + C[3 + k] * cp[1] + C[6 + k] * cp[2]));
    return { C, cp, W };
  }

  // object -> world transform (rotation normalised, translation)
  objectWorld(f, c) {
    const n = this.frames.length;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(f))), i1 = Math.min(n - 1, i0 + 1);
    const A = this.frames[i0], B = this.frames[i1];
    const a = (B.on[c] ? f - i0 : 0);
    const O = new Float32Array(9), op = [0, 0, 0];
    for (let j = 0; j < 9; j++) O[j] = (A.m[c * 9 + j] + (B.m[c * 9 + j] - A.m[c * 9 + j]) * a) / UNIT;
    for (let j = 0; j < 3; j++) op[j] = A.p[c * 3 + j] + (B.p[c * 3 + j] - A.p[c * 3 + j]) * a;
    return { O, op };
  }

  // depth-only render of every visible object from a light: uL maps world
  // to light clip space (orthographic)
  drawShadow(f, L) {
    const gl = this.R.gl;
    if (!this.shadowProg) this.shadowProg = this.R.program(SHADOW_VS, SHADOW_FS);
    const fi = Math.max(0, Math.min(this.frames.length - 1, Math.floor(f)));
    const prog = this.shadowProg.use().m4('uL', L);
    for (let c = 1; c < this.conum; c++) {
      if (!this.frames[fi].on[c]) continue;
      const mesh = this.meshes[this.index[c]];
      if (!mesh) continue;
      const { O, op } = this.objectWorld(f, c);
      prog.m3('uO', transpose3(O)).f('uOp', ...op);
      const Lst = mesh.lists[0];
      if (!Lst.count) continue;
      gl.bindVertexArray(Lst.vao);
      gl.drawArrays(gl.TRIANGLES, 0, Lst.count);
    }
    gl.bindVertexArray(null);
  }

  // camera-applied transform for object c at fractional frame f
  objectTransform(f, c) {
    const n = this.frames.length;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(f)));
    const i1 = Math.min(n - 1, i0 + 1);
    const a = f - i0;
    const A = this.frames[i0], B = this.frames[i1];
    // interpolate only if the object stays on and doesn't jump (camera cuts)
    const lerp = (arr0, arr1, k, cnt, off) => {
      const out = new Float64Array(cnt);
      for (let j = 0; j < cnt; j++) out[j] = arr0[off + j] + (arr1[off + j] - arr0[off + j]) * k;
      return out;
    };
    const jump = (fr0, fr1, idx) => {
      const dp = Math.hypot(fr1.p[idx * 3] - fr0.p[idx * 3], fr1.p[idx * 3 + 1] - fr0.p[idx * 3 + 1], fr1.p[idx * 3 + 2] - fr0.p[idx * 3 + 2]);
      let dm = 0; for (let j = 0; j < 9; j++) dm = Math.max(dm, Math.abs(fr1.m[idx * 9 + j] - fr0.m[idx * 9 + j]));
      return dp > 20000 || dm > 4000;
    };
    const kc = jump(A, B, 0) ? 0 : a;
    const ko = (B.on[c] && !jump(A, B, c)) ? a : 0;
    const C = lerp(A.m, B.m, kc, 9, 0), cp = lerp(A.p, B.p, kc, 3, 0);
    const O = lerp(A.m, B.m, ko, 9, c * 9), op = lerp(A.p, B.p, ko, 3, c * 3);
    // R = C * O (VISU mulmatrices2), T = C*op/UNIT + cp
    const R = new Float32Array(9);
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
      let s = 0; for (let k = 0; k < 3; k++) s += C[r * 3 + k] * O[k * 3 + col];
      R[r * 3 + col] = s / UNIT / UNIT;
    }
    const T = [0, 0, 0];
    for (let r = 0; r < 3; r++) T[r] = (C[r * 3] * op[0] + C[r * 3 + 1] * op[1] + C[r * 3 + 2] * op[2]) / UNIT + cp[r];
    return { R, T, on: A.on[c] };
  }

  // Draw frame f. Caller has bound a target with depth; window = [x0,y0,x1,y1] in VGA pixels.
  // Objects: z-buffered against each other. Inside an object: painter's
  // order from its nearest directional list (colour pass without depth
  // writes, then a depth-only pass) - reproduces VISU's decals exactly.
  draw(f, opts = {}) {
    const R = this.R, gl = R.gl;
    const fi = Math.max(0, Math.min(this.frames.length - 1, Math.floor(f)));
    const fov = this.frames[fi].fov;
    const win = opts.window || [0, 25, 319, 174];
    const addx = (win[0] + win[2]) >> 1, addy = (win[1] + win[3]) >> 1;
    const [mulx, muly] = cameraMul(fov, win[2] - addx);
    const prog = (opts.prog || this.prog).use();
    prog.tex('uPal', this.palTex).f('uLight', ...LIGHT).f('uNearFar', this.near, this.far)
      .f('uProj', mulx, muly, addx, addy).f('uScreen', 320, 200).f('uLevelAdd', opts.levelAdd || 0).f('uBias', 0);
    if (opts.setup) opts.setup(prog);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const list = [];
    for (let c = 1; c < this.conum; c++) {
      if (!this.frames[fi].on[c]) continue;
      const mesh = this.meshes[this.index[c]];
      if (!mesh) continue;
      const tr = this.objectTransform(f, c);
      // pick the painter's list whose sort vertex is nearest (smallest z)
      let best = 0, bz = Infinity;
      const Rm = tr.R;
      for (let k = 0; k < mesh.lists.length; k++) {
        const v = mesh.lists[k].sortv;
        const z = Rm[6] * v[0] + Rm[7] * v[1] + Rm[8] * v[2] + tr.T[2];
        if (z < bz) { bz = z; best = k; }
      }
      const name = this.objName[c] || '';
      let dist = bz;
      if (opts.groundFirst && name[0] === '_') dist = 1e9;
      const onTop = !!(opts.onTop && opts.onTop(name, f));
      if (onTop) dist = -1e9;
      list.push({ c, tr, mesh, L: mesh.lists[best], dist, ground: dist === 1e9, onTop });
    }
    // back to front like the original (stable)
    list.sort((a, b) => b.dist - a.dist);
    for (const it of list) {
      if (!it.L.count) continue;
      prog.m3('uM', transpose3(it.tr.R)).f('uT', ...it.tr.T);
      gl.bindVertexArray(it.L.vao);
      if (it.ground || it.onTop) {
        // backdrop objects / forced-on-top objects ignore depth when colouring
        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLES, 0, it.L.count);
        gl.enable(gl.DEPTH_TEST);
      } else {
        gl.depthMask(false);
        gl.drawArrays(gl.TRIANGLES, 0, it.L.count);
        gl.depthMask(true);
      }
      if (!it.onTop) {
        gl.colorMask(false, false, false, false);
        gl.depthFunc(gl.LESS);
        gl.drawArrays(gl.TRIANGLES, 0, it.L.count);
        gl.depthFunc(gl.LEQUAL);
        gl.colorMask(true, true, true, true);
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
}

// row-major 3x3 -> column-major for uniformMatrix3fv
function transpose3(m) {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}
