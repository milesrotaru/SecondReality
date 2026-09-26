// MINVBALL (Psi) - 512 bouncing balls over a gradient floor, with shadows.
// DOTS/MAIN.C + ASM.ASM: an emitter respawns one ball per frame following a
// frame-driven script (spiral drop, rings, fountain, random rain), gravity
// and damped bounces in 16-bit integer math, the scene yawing around the
// vertical axis. Balls are 4x3 pixel sprites shaded by depth.
// HD: the exact integer simulation runs underneath (MS C rand() included);
// screen positions are projected without truncation and interpolated
// between simulation frames, balls are drawn as shaded, antialiased spheres.
import { FPS } from '../demo.js';

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPos;   // centre x,y (VGA), radius x,y
layout(location=2) in vec3 aC0;    // centre colour
layout(location=3) in vec3 aC1;    // rim colour
out vec2 vC;
out vec3 vC0, vC1;
void main(){
  vC0 = aC0; vC1 = aC1;
  vec2 p = aPos.xy + aCorner * (aPos.zw + 0.75);   // margin for the AA edge
  vC = aCorner * (aPos.zw + 0.75) / aPos.zw;
  gl_Position = vec4(p.x / 160.0 - 1.0, 1.0 - p.y / 100.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vC;
in vec3 vC0, vC1;
out vec4 o;
void main(){
  float r = length(vC);
  float w = fwidth(r);
  float a = 1.0 - smoothstep(1.0 - w, 1.0 + w, r);
  vec3 c = mix(vC0, vC1, smoothstep(0.0, 0.85, r));
  o = vec4(c * a, a);
}`;

const FLOOR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uSub;   // subtractive fade-in
uniform vec3 uAdd;    // end brightening
uniform float uGray;  // end: whole palette one grey (-1 = off)
void main(){
  float y = (1.0 - vUv.y) * 200.0 - 0.5;
  float a = y - 100.0;
  float g = 0.0;
  if (a > -0.5) {
    float c = 64.0 - 256.0 / (max(a, 0.0) + 4.0);
    g = c * c / 64.0 / 4.0;
  }
  vec3 col = uGray >= 0.0 ? vec3(uGray) : min(max(vec3(g) - uSub, 0.0) + uAdd, vec3(63.0));
  o = vec4(col / 63.0, 1.0);
}`;

const COLS = [[0, 0, 0], [4, 25, 30], [8, 40, 45], [16, 55, 60]];
const N = 512;

function msRand(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 214013) + 2531011) >>> 0; return (s >>> 16) & 0x7fff; };
}
const i16 = (v) => (v << 16) >> 16;

export default {
  name: 'Minvball',
  credit: 'Psi',

  init(R, A) {
    const gl = R.gl;
    const s = A.i16('sin1024');
    this.sin = (d) => s[d & 1023];
    this.cos = (d) => s[(d + 256) & 1023];
    this.sin1024 = s;
    // palette (6-bit)
    const pal = new Float32Array(768);
    for (let a = 0; a < 16; a++) for (let b = 0; b < 4; b++) {
      const c = 100 + a * 9, e = (a * 4 + b) * 3;
      pal[e] = COLS[b][0]; pal[e + 1] = Math.trunc(COLS[b][1] * c / 256); pal[e + 2] = Math.trunc(COLS[b][2] * c / 256);
    }
    for (let a = 0; a < 100; a++) {
      let c = 64 - Math.trunc(256 / (a + 4));
      c = Math.trunc(c * c / 64);
      pal[(64 + a) * 3] = pal[(64 + a) * 3 + 1] = pal[(64 + a) * 3 + 2] = c >> 2;
    }
    this.pal = pal;
    this.prog = R.program(VS, FS);
    this.floor = R.fsProgram(FLOOR_FS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const q = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, q);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const st = 10 * 4;
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, st, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, st, 28); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    this.buf = new Float32Array(N * 2 * 10);
    this.reset();
  },

  // ----- the original simulation, one retrace per step
  reset() {
    const rand = msRand(1);
    const tau = new Int16Array(N);
    for (let a = 0; a < N; a++) tau[a] = a;
    for (let a = 0; a < 500; a++) { const b = rand() % N, c = rand() % N; const d = tau[b]; tau[b] = tau[c]; tau[c] = d; }
    for (let a = 0; a < 1000; a++) rand(); // scramble of identical dots: rand() calls only
    const S = {
      x: new Int16Array(N), y: new Int16Array(N), z: new Int16Array(N), yadd: new Int16Array(N),
      tau, rand, j: 0, f: 0, frame: 0, dropper: 22000, rot: 0, rots: 0, rota: -64, grav: 3, gravd: 13,
      rotsin: 0, rotcos: 0, spawned: -1,
    };
    S.y.fill(2560 - 22000);
    this.S = S;
    this.prev = null;
  },

  step() {
    const S = this.S;
    const prev = { x: S.x.slice(), y: S.y.slice(), z: S.z.slice(), rotsin: S.rotsin, rotcos: S.rotcos, frame: S.frame };
    S.frame++;
    const fr = S.frame;
    if (fr === 500) S.f = 0;
    const i = S.tau[S.j];
    S.j = (S.j + 1) % N;
    const f = S.f;
    S.spawned = -1;
    if (fr < 500) {
      S.x[i] = this.sin(f * 11) * 40; S.y[i] = this.cos(f * 13) * 10 - S.dropper; S.z[i] = this.sin(f * 17) * 40; S.yadd[i] = 0; S.spawned = i;
    } else if (fr < 900) {
      S.x[i] = this.cos(f * 15) * 55; S.y[i] = S.dropper; S.z[i] = this.sin(f * 15) * 55; S.yadd[i] = -260; S.spawned = i;
    } else if (fr < 1700) {
      const a = Math.trunc(this.sin1024[fr & 1023] / 8);
      S.x[i] = this.cos(f * 66) * a; S.y[i] = 8000; S.z[i] = this.sin(f * 66) * a; S.yadd[i] = -300; S.spawned = i;
    } else if (fr < 2360) {
      S.x[i] = S.rand() - 16384; S.y[i] = 8000 - Math.trunc(S.rand() / 2); S.z[i] = S.rand() - 16384; S.yadd[i] = 0; S.spawned = i;
      if (fr > 1900 && !(fr & 31) && S.grav > 0) S.grav--;
    }
    if (S.dropper > 4000) S.dropper -= 100;
    S.rotcos = this.cos(S.rot) * 64; S.rotsin = this.sin(S.rot) * 64;
    S.rots += 2;
    if (fr > 1900) { S.rot += Math.trunc(S.rota / 64); S.rota--; } else S.rot = this.sin(S.rots);
    S.f = i16(S.f + 1);
    // drawdots(): gravity and bounce
    for (let k = 0; k < N; k++) {
      let ya = i16(S.yadd[k] + S.grav);
      let ny = i16(S.y[k] + ya);
      if (ny >= 8105) { ya = i16(Math.imul(-ya, S.gravd)) >> 4; ny = i16(ny + ya); }
      S.yadd[k] = ya; S.y[k] = ny;
    }
    this.prev = prev;
  },

  simTo(n) {
    if (this.S.frame > n) this.reset();
    while (this.S.frame < n) this.step();
  },

  project(x, y, z, rs, rc) {
    const bp = Math.floor(z * rc / 65536) - Math.floor(x * rs / 65536) + 9000;
    const v = (x * rc + z * rs) / 256 * 9 / 8;
    return [v / bp + 160, y * 64 / bp + 100, 524288 / bp + 100, bp];
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    this.t0 = t0;
    this.tMain = t0 + F(130);
    // MAIN.C loops 2450 frames (white flash from 2360); the shipped EXE cuts
    // to the next part at frame ~2225 without the flash (capture: rain onset
    // at exactly frame 1700, black at 2225).
    this.tEnd = Math.min(this.tMain + F(2225), P.until(this.tMain, (p) => p.musplus > -4 && p.musplus < 0));
    return this.tEnd;
  },

  color(idx, fade) {
    const p = this.pal;
    return [0, 1, 2].map((k) => fade(p[idx * 3 + k], k) / 63);
  },

  render(R, t) {
    const gl = R.gl;
    const F = (x) => x * FPS;
    // palette state
    let sub = Math.max(0, 64 - F(t - this.t0) / 2), add = [0, 0, 0], gray = -1;
    const fr = F(t - this.tMain);
    if (fr > 2360 && fr < 2400) { const a = fr - 2360; add = [3 * a, 3 * a, 4 * a]; sub = 0; }
    else if (fr >= 2400) { gray = Math.max(0, 63 - 2 * Math.min(40, fr - 2400)); sub = 0; }
    const fade = (v, k) => (gray >= 0 ? gray : Math.min(63, Math.max(0, v - sub) + add[k]));
    this.floor.use().f('uSub', sub).f('uAdd', ...add).f('uGray', gray);
    R.drawFullscreen();
    if (fr < 1) return;

    const n = Math.floor(fr);
    this.simTo(n + 1);
    const S = this.S, P0 = this.prev, u = fr - n;
    const buf = this.buf;
    let ns = 0;
    const shadows = [], balls = [];
    const shc = this.color(87, fade);
    for (let k = 0; k < N; k++) {
      const a = this.project(P0.x[k], P0.y[k], P0.z[k], P0.rotsin, P0.rotcos);
      const b = this.project(S.x[k], S.y[k], S.z[k], S.rotsin, S.rotcos);
      const p = k === S.spawned ? b : a.map((v, i) => v + (b[i] - v) * u);
      const x = p[0];
      if (!(x >= 0 && x < 320)) continue;
      if (p[2] >= 0 && p[2] < 200) shadows.push(x + 1, p[2]);
      if (p[2] >= 0 && p[2] < 200 && p[1] >= 0 && p[1] < 200) balls.push([x + 2, p[1] + 1.5, p[3]]);
    }
    for (let k = 0; k < shadows.length; k += 2) {
      buf.set([shadows[k], shadows[k + 1], 1, 0.5, ...shc, ...shc], ns * 10); ns++;
    }
    balls.sort((A, B) => B[2] - A[2]);
    for (const [x, y, bp] of balls) {
      let c = (bp / 256 - 31) * 3 / 4 + 8;
      c = 15 - Math.min(15, Math.max(0, c));
      const c0 = Math.min(14.999, Math.floor(c)), cf = c - c0;
      const lerp = (i0, i1) => this.color(i0, fade).map((v, k) => v + (this.color(i1, fade)[k] - v) * cf);
      const hi = lerp(c0 * 4 + 3, Math.min(63, (c0 + 1) * 4 + 3)), lo = lerp(c0 * 4 + 2, Math.min(63, (c0 + 1) * 4 + 2));
      buf.set([x, y, 2, 1.5, ...hi, ...lo], ns * 10); ns++;
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, ns * 10), gl.STREAM_DRAW);
    this.prog.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, ns);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  },
};
