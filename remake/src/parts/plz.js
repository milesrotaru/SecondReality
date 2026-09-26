// PLZPART (Wildfire) - plasmas, then the plasma cube.
// PLZPART/PLZ.C + ASMYT.ASM + COPPER.ASM: two plasmas with different phase
// parameters are written as a pixel checkerboard, and the copper interrupt
// alternates line compare / pel panning every frame so each pixel flickers
// between them at 70 Hz: the eye sees their blend. Transitions "drop" the
// plasma off the screen (line compare n^2/4*43/128+60) and fade in the next
// palette. VECT.C + PLZFILL.C + SPLINE.ASM: a cube on a spline path, each
// face mapped with a sine-warped plasma texture by an affine scanline filler.
// HD: both plasmas are evaluated analytically per pixel and blended in linear
// light (what a CRT does with the flicker); the cube texture is evaluated
// analytically with the original's scanline-affine mapping, antialiased.
import { FPS } from '../demo.js';
import * as PX from './plz_remix.js';

const PI2 = Math.PI * 2;

// ---------------------------------------------------------------- plasma --
const PLZ_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec4 uK, uL;          // c1..c4 of both plasmas (continuous)
uniform sampler2D uPal;       // 256 x 1 current palette (0..1)
uniform float uLC;            // line compare (scanlines of 400)
const float TAU = 6.283185307179586;
float P(float a){ a *= TAU / 4096.0; return sin(a) * 55.0 + sin(a * 6.0) * 5.0 + sin(a * 21.0) * 4.0 + 64.0; }
float L16(float a){ a *= TAU / 4096.0; return (sin(a) * 55.0 + sin(a * 4.0) * 5.0 + sin(a * 17.0) * 3.0 + 64.0) * 16.0; }
float L4(float a){ a *= TAU / 4096.0; return (sin(a) * 55.0 + sin(a * 5.0) * 8.0 + sin(a * 15.0) * 2.0 + 64.0) * 8.0; }
float plz(vec4 c, float cc, float y){
  float v = P(c.x + 8.0 * cc + L16(c.y + y + 4.0 * (80.0 - cc)))
          + P(c.z + 2.0 * y + 4.0 * (80.0 - cc) + L4(c.w + 16.0 * cc + y));
  return mod(v, 256.0);
}
vec3 pal(float i){
  float a = floor(i);
  vec3 c0 = texelFetch(uPal, ivec2(int(a) & 255, 0), 0).rgb;
  vec3 c1 = texelFetch(uPal, ivec2((int(a) + 1) & 255, 0), 0).rgb;
  return mix(c0, c1, i - a);
}
void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * vec2(320.0, 400.0);
  float y = p.y - 0.5 - (uLC + 1.0);
  float cc = (p.x + 1.0 - 2.0) / 4.0;
  float w = fwidth(p.y) * 0.5;
  float m = smoothstep(-0.5 - w, -0.5 + w, y) * (1.0 - smoothstep(279.5 - w, 279.5 + w, y));
  // outside the plasma lines the screen shows cleared memory: colour 0
  vec3 col = texelFetch(uPal, ivec2(0), 0).rgb;
  if (m > 0.0) {
    vec3 a = pal(plz(uK, cc, y)), b = pal(plz(uL, cc, y));
    col = mix(col, pow((pow(a, vec3(2.2)) + pow(b, vec3(2.2))) * 0.5, vec3(1.0 / 2.2)), m);
  }
  o = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ cube --
const CUBE_VS = `#version 300 es
uniform vec2 uP[4];
out vec2 vP;
void main(){
  vec2 p = uP[gl_VertexID];
  vP = p;
  gl_Position = vec4(p.x / 160.0 - 1.0, 1.0 - p.y / 100.0, 0.0, 1.0);
}`;

const CUBE_FS = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 o;
uniform vec2 uP[4], uT[4];
uniform mat3 uH;
uniform float uDD, uShade;
uniform int uBlock;
const float TAU = 6.283185307179586;
float S(float a){ return 127.0 * sin(a * TAU / 512.0); }
vec3 blockPal(float k){
  k = clamp(k, 0.0, 63.0);
  float h = max(k - 32.0, 0.0);
  vec3 c;
  if (uBlock == 0) c = k < 32.0 ? vec3(0.0, 0.0, 2.0 * k) : vec3(2.0 * h, 2.0 * h, 63.0);
  else if (uBlock == 1) c = k < 32.0 ? vec3(2.0 * k, 0.0, 0.0) : vec3(63.0, 2.0 * h, 0.0);
  else c = k < 32.0 ? vec3(k, 0.0, k * 2.0 / 3.0) : vec3(31.0 - h, 2.0 * h, 21.0);
  return c / 63.0;
}
void main(){
  // scanline-affine mapping: texture coords interpolated down the two edges
  // crossing this scanline, then linearly across the span (PLZFILL.C/do_block)
  float y = vP.y;
  float xl = 1e9, xr = -1e9;
  vec2 tl = vec2(0.0), tr = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 a = uP[i], b = uP[(i + 1) & 3];
    if (abs(b.y - a.y) < 1e-4) continue;
    float t = (y - a.y) / (b.y - a.y);
    if (t < -0.01 || t > 1.01) continue;
    t = clamp(t, 0.0, 1.0);
    float x = mix(a.x, b.x, t);
    vec2 tc = mix(uT[i], uT[(i + 1) & 3], t);
    if (x < xl) { xl = x; tl = tc; }
    if (x > xr) { xr = x; tr = tc; }
  }
  float s = xr > xl ? clamp((vP.x - xl) / (xr - xl), 0.0, 1.0) : 0.0;
  vec2 T = mix(tl, tr, s);
#ifdef P3
  // machine mode: exact perspective (screen -> face homography) instead of
  // the 486's affine scanline walk
  vec3 h = uH * vec3(vP, 1.0);
  T = h.xy / h.z;
#endif
  // kuva[y][x] = sini[(y*4 + sini[x*2]) & 511]/4 + 32, read through the
  // dist1 row offset sini[(y+dd)*8]/3
  float tx = T.x + S((T.y + uDD) * 8.0) / 3.0;
  float k = S(T.y * 4.0 + S(tx * 2.0)) / 4.0 + 32.0;
  o = vec4(blockPal(k) * uShade, 1.0);
}`;

// 3x3 homography mapping the 4 points src[i] -> dst[i] (column-major for GL)
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c && A[c][c] !== 0) {
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j];
      b[r] -= k * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return new Float32Array([h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], 1]);
}

function buildPals() {
  const ptau = [0];
  for (let a = 1; a <= 128; a++) ptau.push(Math.trunc(Math.cos(a * PI2 / 128 + Math.PI) * 31 + 32));
  const pals = [];
  const mk = (segs) => {
    const p = new Float32Array(256 * 3);
    let i = 1;
    for (const [n, f] of segs) for (let a = 0; a < n; a++) { const c = f(a); p[i * 3] = c[0]; p[i * 3 + 1] = c[1]; p[i * 3 + 2] = c[2]; i++; }
    return p;
  };
  const T = ptau;
  const first = (f) => [63, (a) => f(a + 1)];
  pals.push(mk([first((a) => [T[a], T[0], T[0]]), [64, (a) => [T[63 - a], T[0], T[0]]], [64, (a) => [T[0], T[0], T[a]]], [64, (a) => [T[a], T[0], T[63 - a]]]]));
  pals.push(mk([first((a) => [T[a], T[0], T[0]]), [64, (a) => [T[63 - a], T[0], T[a]]], [64, (a) => [T[0], T[a], T[63 - a]]], [64, (a) => [T[a], T[63], T[a]]]]));
  pals.push(mk([first(() => [T[0] >> 1, T[0] >> 1, T[0] >> 1]), [64, (a) => [T[a] >> 1, T[a] >> 1, T[a] >> 1]], [64, (a) => [T[63 - a] >> 1, T[63 - a] >> 1, T[63 - a] >> 1]], [64, () => [T[0] >> 1, T[0] >> 1, T[0] >> 1]]]));
  return pals;
}

const INIT_K = [3500, 2300, 3900, 3670], INIT_L = [1000, 2000, 3000, 4000];
const DK = [-3, -2, 1, 2], DL = [-1, -2, 2, 3];          // moveplz, per frame
const INITTABLE = [
  [1000, 2000, 3000, 4000, 3500, 2300, 3900, 3670],
  [1000, 2000, 4000, 4000, 1500, 2300, 3900, 1670],
  [3500, 1000, 3000, 1000, 3500, 3300, 2900, 2670],
];
const TIMETABLE = [64 * 6 * 2 - 45, 64 * 6 * 4 - 45, 64 * 6 * 5 - 45];
const PRE_FRAMES = 72; // moveplz runs from part start; measured phase at the first plasma frame

const CUBE_PTS = [[125, 125, 125], [125, -125, 125], [-125, -125, 125], [-125, 125, 125], [125, 125, -125], [125, -125, -125], [-125, -125, -125], [-125, 125, -125]];
const CUBE_FACES = [[1, 2, 3, 0, 0], [7, 6, 5, 4, 0], [0, 4, 5, 1, 1], [1, 5, 6, 2, 2], [2, 6, 7, 3, 1], [3, 7, 4, 0, 2]];
const TXT = [64, 4, 190, 4, 190, 60, 64, 60];

export default {
  name: 'Plasma',
  credit: 'Wildfire',

  init(R, A) {
    const gl = R.gl;
    this.pals = buildPals();
    this.palData = new Float32Array(256 * 4);
    this.palTex = R.texture(256, 1, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, data: this.palData, filter: gl.NEAREST });
    this.plzProg = R.fsProgram(PLZ_FS);
    this.cubeProg = R.program(CUBE_VS, CUBE_FS);
    // RATA.INC parks the cube at distance 300; silhouettes fitted against the
    // capture of the shipped build say 350 (which also makes the closing
    // 350..500 ramp continuous), so the release source is one tweak behind.
    this.rata = Int16Array.from(A.i16('plz.rata'), (v, i) => (i % 8 === 2 && v === 300 ? 350 : v));
    this.spl = A.i16('plz.spline');
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    this.t0 = t0;
    // plz(): while(dis_musplus()<0); dis_setmframe(0); mode set, fade from white
    this.tP = P.until(t0 + F(3), (p) => p.musplus >= 0) + F(4); // + mode set / first frame
    this.tr = TIMETABLE.map((n) => P.ticks(this.tP, n + 1) + F(0.5));
    this.tPlzEnd = this.tr[2] + F(65);
    // vect(): while(dis_musplus()<13); loop until -4 <= musplus < 0
    this.tV = P.until(this.tPlzEnd, (p) => p.musplus >= 13);
    this.tEnd = P.until(this.tV + F(2), (p) => p.musplus >= -4 && p.musplus < 0);
    return this.tEnd;
  },

  // ----- plasma state at time t
  plasma(t) {
    const F = (x) => x * FPS;
    let stage = 0;
    while (stage < 3 && t >= this.tr[stage]) stage++;
    let lc = 60.5, K, L, level = null, pal = this.pals[0];
    const params = (base, n) => [base.slice(4, 8).map((v, i) => v + DK[i] * n), base.slice(0, 4).map((v, i) => v + DL[i] * n)];
    if (stage === 0) {
      const n = F(t - this.tP);
      [K, L] = [INIT_K.map((v, i) => v + DK[i] * (PRE_FRAMES + n)), INIT_L.map((v, i) => v + DL[i] * (PRE_FRAMES + n))];
      const a = Math.min(127, Math.max(0, n - 1));
      level = (v) => Math.min(63, 64 - (63 - v) * a / 128);
      this.fillPal(pal, level);
      return { K, L, lc };
    }
    const m = F(t - this.tr[stage - 1]);
    if (m < 64) {
      // still the previous plasma, dropping away
      const prev = stage - 1;
      const mp = prev === 0 ? PRE_FRAMES + F(t - this.tP) : F(t - this.tr[prev - 1]) - 64;
      if (prev === 0) [K, L] = [INIT_K.map((v, i) => v + DK[i] * mp), INIT_L.map((v, i) => v + DL[i] * mp)];
      else [K, L] = params(INITTABLE[prev], mp);
      if (prev === 0) this.fillPal(this.pals[0], (v) => Math.min(63, v + 1));
      else this.fillPal(this.pals[prev], (v) => v * 31 / 32);
      const n = m + 1;
      lc = n * n / 4 * 43 / 128 + 60;
      return { K, L, lc };
    }
    if (stage === 3 || m < 65) return { K: [0, 0, 0, 0], L: [0, 0, 0, 0], lc: 1000 };
    [K, L] = params(INITTABLE[stage], m - 64);
    const f = Math.min(31, Math.max(0, m - 65)) / 32;
    this.fillPal(this.pals[stage], (v) => v * f);
    return { K, L, lc };
  },

  fillPal(pal, level) {
    const d = this.palData;
    for (let i = 0; i < 256; i++) {
      for (let k = 0; k < 3; k++) d[i * 4 + k] = level(pal[i * 3 + k]) / 63;
      d[i * 4 + 3] = 1;
    }
    this.palDirty = true;
  },

  // ----- cube (spline path, fixed-point-free float version of VECT.C)
  spline(pos) {
    const seg = Math.floor(pos / 256), f = pos - seg * 256;
    const f0 = Math.min(254, Math.floor(f)), ff = f - f0;
    const out = new Array(8).fill(0);
    const R = this.rata, S = this.spl, np = R.length / 8;
    for (let k = 0; k < 4; k++) {
      const w = S[k * 256 + f0] + (S[k * 256 + f0 + 1] - S[k * 256 + f0]) * ff;
      const pi = Math.min(np - 1, seg + 3 - k);
      for (let j = 0; j < 8; j++) out[j] += w * R[pi * 8 + j];
    }
    return out.map((v) => v / 32768);
  },

  renderCube(R, t) {
    const gl = R.gl;
    const frames = Math.max(0, (t - this.tV) * FPS - 4); // loop start + page-flip latency (measured)
    const [tx, ty, dis, kx, ky, kz, lkx, lky] = this.spline(4 * 256 + frames * 4);
    const ang = (k) => k * PI2 / 1024;
    const SX = Math.sin(ang(kx)), CX = Math.cos(ang(kx)), SY = Math.sin(ang(ky)), CY = Math.cos(ang(ky)), SZ = Math.sin(ang(kz)), CZ = Math.cos(ang(kz));
    const M = [
      [CY * CZ, CY * SZ, -SY],
      [SX * CZ * SY - CX * SZ, SX * SY * SZ + CX * CZ, CY * SX],
      [CX * CZ * SY + SX * SZ, CX * SY * SZ - SX * CZ, CY * CX],
    ];
    // light: ls_y = kos>>8, ls_x = (sin>>8)*(sin>>8)>>7, ls_z = (sin>>8)*(kos>>8)>>7 (127 scale)
    const la = ang(lkx), lb = ang(lky);
    const ls = [127 * Math.sin(la) * Math.sin(lb) * 127 / 128, 127 * Math.cos(la), 127 * Math.sin(la) * Math.cos(lb) * 127 / 128];
    const P3 = CUBE_PTS.map(([x, y, z]) => [
      x * M[0][0] + y * M[0][1] + z * M[0][2] + tx,
      x * M[1][0] + y * M[1][1] + z * M[1][2] + ty,
      x * M[2][0] + y * M[2][1] + z * M[2][2] + dis,
    ]);
    const P2 = P3.map(([x, y, z]) => [x * 256 / z + 160, y * 213 / z + 99]);
    const T = R.sceneTarget();
    R.bindTarget(T);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const pr = this.cubeProg.use();
    pr.fv('uT', TXT, 2).f('uDD', frames + 1);
    gl.bindVertexArray(R.fsVao);
    for (const [a, b, c, d, col] of CUBE_FACES) {
      const p = P3[a], q = P3[b], r = P3[c];
      const ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2];
      const bx = r[0] - p[0], by = r[1] - p[1], bz = r[2] - p[2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (-p[0] * nx - p[1] * ny - p[2] * nz > 0) continue;
      if (p[2] <= 1 || q[2] <= 1 || r[2] <= 1 || P3[d][2] <= 1) continue;
      const s = Math.max(0, Math.min(64, (ls[0] * nx + ls[1] * ny + ls[2] * nz) / 250000 + 32));
      pr.m3('uH', homography([P2[a], P2[b], P2[c], P2[d]], [[64, 4], [190, 4], [190, 60], [64, 60]]));
      pr.fv('uP', [...P2[a], ...P2[b], ...P2[c], ...P2[d]], 2).f('uShade', s / 64).i('uBlock', col);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }
    R.present(T);
  },

  // ---------------- remix (plz_remix.js) ----------------
  initRemix(R) {
    this.rx = { slab: R.fsProgram(PX.SLAB_FS), cube: R.fsProgram(PX.CUBE_FS) };
    // per face slot (by outward local normal): affine local -> texcoord maps
    const slotOf = (n) => (n[2] > 0.5 ? 0 : n[2] < -0.5 ? 1 : n[0] > 0.5 ? 2 : n[0] < -0.5 ? 4 : n[1] < -0.5 ? 3 : 5);
    const Ax = new Float32Array(24), Ay = new Float32Array(24), blk = new Int32Array(6);
    const Tc = [[64, 4], [190, 4], [190, 60], [64, 60]];
    for (const [a, b, c, d, col] of CUBE_FACES) {
      const P = [a, b, c, d].map((i) => CUBE_PTS[i]);
      const ctr = [0, 1, 2].map((k) => (P[0][k] + P[2][k]) / 2);
      const n = ctr.map((v) => Math.sign(Math.round(v)));
      const sl = slotOf(n);
      const e1 = [0, 1, 2].map((k) => P[1][k] - P[0][k]), e2 = [0, 1, 2].map((k) => P[3][k] - P[0][k]);
      const l1 = e1.reduce((s, v) => s + v * v, 0), l2 = e2.reduce((s, v) => s + v * v, 0);
      for (let j = 0; j < 2; j++) {
        const du = Tc[1][j] - Tc[0][j], dv = Tc[3][j] - Tc[0][j];
        const g = [0, 1, 2].map((k) => e1[k] / l1 * du + e2[k] / l2 * dv);
        const off = Tc[0][j] - (g[0] * P[0][0] + g[1] * P[0][1] + g[2] * P[0][2]);
        (j === 0 ? Ax : Ay).set([...g, off], sl * 4);
      }
      blk[sl] = col;
    }
    this.rx.Ax = Ax; this.rx.Ay = Ay; this.rx.blk = blk;
  },

  renderRemix(R, t, post) {
    if (!this.rx) this.initRemix(R);
    const gl = R.gl, X = this.rx;
    let fade = [0, 0, 0, 0];
    post.begin({ samples: 1 });
    if (t < this.tP) fade = [1, 1, 1, 1];
    else if (t < this.tPlzEnd) {
      const s = this.plasma(t);
      if (s.lc <= 400) {
        if (this.palDirty) { R.update(this.palTex, this.palData, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT }); this.palDirty = false; }
        X.slab.use().tex('uPal', this.palTex).f('uK', ...s.K).f('uL', ...s.L).f('uDrop', s.lc - 60.5).f('uTime', t);
        R.drawFullscreen();
      }
    } else if (t >= this.tV) {
      const frames = Math.max(0, (t - this.tV) * FPS - 4);
      const [tx, ty, dis, kx, ky, kz, lkx, lky] = this.spline(4 * 256 + frames * 4);
      const ang = (k) => k * PI2 / 1024;
      const SX = Math.sin(ang(kx)), CX = Math.cos(ang(kx)), SY = Math.sin(ang(ky)), CY = Math.cos(ang(ky)), SZ = Math.sin(ang(kz)), CZ = Math.cos(ang(kz));
      const M = [
        [CY * CZ, CY * SZ, -SY],
        [SX * CZ * SY - CX * SZ, SX * SY * SZ + CX * CZ, CY * SX],
        [CX * CZ * SY + SX * SZ, CX * SY * SZ - SX * CZ, CY * CX],
      ];
      const la = ang(lkx), lb = ang(lky);
      const ls = [Math.sin(la) * Math.sin(lb), Math.cos(la), Math.sin(la) * Math.cos(lb)];
      X.cube.use().m3('uM', new Float32Array([M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]]))
        .f('uT', tx, ty, dis).fv('uAx', X.Ax, 4).fv('uAy', X.Ay, 4).f('uDD', frames + 1).f('uLs', ...ls).f('uFade', 1);
      gl.uniform1iv(X.cube.u('uBlk'), X.blk);
      R.drawFullscreen();
    }
    post.end(t, { exposure: 1.0, bloom: 0.1, grain: 0.02, vignette: 0.3, fade });
    return true;
  },

  render(R, t) {
    const gl = R.gl;
    if (t < this.tP) {
      gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.clearColor(0, 0, 0, 1);
      return;
    }
    if (t < this.tPlzEnd) {
      const s = this.plasma(t);
      if (s.lc > 400) { gl.clear(gl.COLOR_BUFFER_BIT); return; }
      if (this.palDirty) { R.update(this.palTex, this.palData, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT }); this.palDirty = false; }
      this.plzProg.use().tex('uPal', this.palTex).f('uK', ...s.K).f('uL', ...s.L).f('uLC', s.lc);
      R.drawFullscreen();
      return;
    }
    if (t < this.tV) { gl.clear(gl.COLOR_BUFFER_BIT); return; }
    this.renderCube(R, t);
  },
};
