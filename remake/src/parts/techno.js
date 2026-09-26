// TECHNO (Psi). TECHNO/KOE.C + KOEA/KOEB.ASM:
//  1. one blue ring pulsing through an EGA ring pattern, burning to white
//  2. two ring systems (a 3-plane ring index + a wobbling 1-plane ring
//     plane) circling each other: palette-rotated moire interference
//  3. four light panels drop away on the beat
//  4. "8 times interleaved rotating delay bars": 11 bars per frame, each
//     frame into one EGA bitplane of 8 pages, so every page shows the bars
//     of 4 moments; colour = number of overlapping layers, strobing on the beat
//  5. the troll slides in with a bang (TROLL.UP), shakes, waits for the panic.
import { FPS } from '../demo.js';
import { Picture } from '../gfx/picture.js';

const trunc = Math.trunc;

// ---- interference palettes (6-bit) ----
const PAL1 = [[0, 0, 0], [10, 7, 10], [20, 15, 20], [30, 23, 30], [40, 31, 40], [50, 38, 50], [60, 46, 60], [30, 23, 30]];
const PAL2 = [[50, 33, 50], [60, 40, 60], [30, 20, 30], [0, 0, 0], [10, 6, 10], [20, 13, 20], [30, 20, 30], [40, 26, 40]];
const PAL0 = [[0, 30, 40], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

const RING_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uR1, uR2;   // r -> continuous ring number (1D, 1024 wide, 0.5px steps)
uniform vec2 uC1, uC2;        // ring centres on screen (VGA px)
uniform vec3 uPal[16];        // 0..1
uniform vec4 uVp;
uniform float uUse2;          // plane 3 on/off
uniform float uWobble[200];   // per-row horizontal offset of plane 3
float ring(sampler2D t, float r){ return texture(t, vec2(r / 512.0, 0.5)).r; }
vec3 shade(vec2 p){
  float r1 = length(p - uC1);
  float n1 = ring(uR1, r1);
  int i1 = int(mod(floor(n1), 8.0));
  int idx = i1;
  if (uUse2 > 0.5) {
    int row = int(clamp(floor(p.y), 0.0, 199.0));
    vec2 c2 = uC2 - vec2(uWobble[row], 0.0);
    float r2 = length(p - c2);
    float n2 = ring(uR2, r2);
    idx += 8 * int(mod(floor(n2), 2.0));
  }
  return uPal[idx];
}
void main(){
  vec2 q = (gl_FragCoord.xy - uVp.xy) / uVp.zw;
  vec2 p = vec2(q.x * 320.0, (1.0 - q.y) * 200.0);
  // 4x rotated-grid supersampling of the (very fine) outer rings
  vec2 d = vec2(320.0, 200.0) / uVp.zw;
  vec3 c = shade(p + d * vec2(0.125, 0.375)) + shade(p + d * vec2(-0.375, 0.125))
         + shade(p + d * vec2(0.375, -0.125)) + shade(p + d * vec2(-0.125, -0.375));
  o = vec4(c * 0.25, 1.0);
}`;

const BAR_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform float uXoff;
void main(){ gl_Position = vec4((aPos.x + uXoff) / 160.0 - 1.0, 1.0 - aPos.y / 100.0, 0.0, 1.0); }`;
const BAR_FS = `#version 300 es
precision highp float;
out vec4 o;
void main(){ o = vec4(0.25, 0.0, 0.0, 1.0); }`;
const COUNT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uCount;
uniform vec3 uCol[5];
void main(){
  float n = texture(uCount, vUv).r * 4.0;
  float i = floor(n);
  vec3 a = uCol[int(clamp(i, 0.0, 4.0))], b = uCol[int(clamp(i + 1.0, 0.0, 4.0))];
  o = vec4(mix(a, b, n - i), 1.0);
}`;

function barPal(c) {
  // KOE.C main(): colour by number of set bits, brightened by curpal c
  const base = [[0, 0, 0], [38, 33, 44], [52, 45, 58], [67, 61, 73], [83, 77, 89]].map((v) => v.map((x) => trunc(x * 64 / 111)));
  return base.map(([r, g, b]) => [
    Math.min(63, trunc(r * (10 + trunc(c * 9 / 9)) / 10)),
    Math.min(63, trunc(g * (10 + trunc(c * 7 / 9)) / 10)),
    Math.min(63, trunc(b * (10 + trunc(c * 5 / 9)) / 10))]);
}

export default {
  name: 'Techno',
  credit: 'Psi',

  init(R, A) {
    const gl = R.gl;
    this.R = R;
    this.sin = A.i16('sin1024');
    const rings = A.json('techno.rings');
    this.ringTex = [rings.r1, rings.r2].map((bnd) => {
      // continuous ring number n(r): n = k exactly at boundary k (linear between)
      const W = 1024, d = new Float32Array(W);
      for (let i = 0; i < W; i++) {
        const r = i * 0.5;
        let k = 0;
        while (k < bnd.length && bnd[k] <= r) k++;
        let n;
        if (k === 0) n = r / bnd[0];
        else if (k >= bnd.length) { const sp = bnd[bnd.length - 1] - bnd[bnd.length - 2]; n = bnd.length + (r - bnd[bnd.length - 1]) / sp; }
        else n = k + (r - bnd[k - 1]) / (bnd[k] - bnd[k - 1]);
        d[i] = n;
      }
      return R.texture(W, 1, { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, data: d, filter: gl.NEAREST });
    });
    this.ringProg = R.fsProgram(RING_FS);
    this.barProg = R.program(BAR_VS, BAR_FS);
    this.countProg = R.fsProgram(COUNT_FS);
    this.troll = new Picture(R, A.pic('techno.troll'));
    this.trollPal = A.pic('techno.troll').pal;
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.barPals = [];
    for (let c = 0; c < 16; c++) this.barPals.push(barPal(c));
  },

  sn(i) { return this.sin[i & 1023]; },

  plan(P, t0) {
    const F = (n) => n / FPS;
    this.P = P;
    const ts = this.ts = P.until(t0, (p) => p.musplus >= -4);
    this.tI2 = ts + F(2);
    this.tI = this.tI2 + F(257);
    this.t925 = Math.max(P.ticks(ts, 925), this.tI + F(1));
    this.tFlash1 = this.t925;
    let t = this.t925 + F(4);
    this.tBlockSetup = t;
    const row7 = (from) => P.until(from, (p) => (p.row & 7) === 7);
    t = P.until(t, (p) => p.musplus >= -3);
    t = row7(t);
    this.blocks = [];
    for (let b = 0; b < 4; b++) {
      const wipe = t;
      t += F(21);
      t = row7(t);
      this.blocks.push({ wipe, flash: t });
      t += F(4);
    }
    // bars
    this.doit = [];
    const sim = this.simulateBars(t, P);
    t = sim.end;
    this.tTrollLoad = t;
    const slide = P.until(t + F(3), (p) => p.ord > 35 || (p.ord === 35 && p.row > 48));
    this.tSlide = slide;
    // slide-in: xpos += xposa/4 until 320
    const xs = [];
    let xpos = 0, xposa = 0;
    for (;;) {
      if (xpos === 320) break;
      xpos += trunc(xposa / 4);
      if (xpos > 320) xpos = 320; else xposa++;
      xs.push(xpos);
    }
    this.slideX = xs;
    this.tRipple = slide + F(xs.length);
    const rip = [];
    let ripple = 0, ripplep = 8;
    for (let i = 0; i < 50; i++) {
      if (ripplep > 1023) ripplep = 1024; else ripplep = trunc(ripplep * 5 / 4);
      rip.push(320 + trunc(this.sn(ripple) / ripplep));
      ripple += ripplep + 100;
    }
    this.rippleX = rip;
    this.tStatic = this.tRipple + F(50);
    const endMus = P.until(this.tStatic, (p) => p.musplus > -6 && p.musplus < 16);
    this.tEnd = Math.min(endMus, this.tStatic + F(420));
    return this.tEnd;
  },

  // Simulate doit1/2/3 per iteration, with the EGA page/plane bookkeeping.
  simulateBars(t, P) {
    const F = (n) => n / FPS;
    const states = [];
    const disp = []; // per iteration: {t, layers:[stateIdx...], xpos, doit}
    const t2521 = P.ticks(this.ts, 2521);
    // doit1
    let slots = {};
    const run = (which, count0, startT) => {
      let rot = which === 1 ? 45 : (which === 2 ? 50 : 45), rota = 10, rot2 = 0;
      let vm = which === 1 ? 50 : 100 * 64, vma = 0;
      let xpos = 320, xposa = 0;
      let plv = 0, pl = 1;
      let count = count0;
      let tt = startT + F(1); // initial waitborder
      let i = 0;
      if (which === 3) slots = {};
      for (;;) {
        if (count <= 0) break;
        let wx = 160, wy = 100;
        if (which === 3) {
          if (tt >= t2521) { if (xpos !== 0) xpos = 0; else break; }
          if (count < 333) {
            xpos -= trunc(xposa / 4);
            if (xpos < 0) xpos = 0; else xposa++;
            if (xpos === 0) break;
          }
          if (rot2 < 32) { wx = trunc(this.sn(rot2) * rot2 / 8) + 160; wy = trunc(this.sn(rot2 + 256) * rot2 / 8) + 100; }
          else { wx = trunc(this.sn(rot2) / 4) + 160; wy = trunc(this.sn(rot2 + 256) / 4) + 100; }
          rot2 += 17;
        }
        count -= 1; tt += F(1);
        const st = { rot, vm: which === 1 ? vm : vm / 64, wx, wy };
        const sid = states.length;
        states.push(st);
        if (which === 1) {
          rot += 2; vm += vma; if (vm < 25) { vm -= vma; vma = -vma; } vma--;
        } else {
          rot += trunc(rota / 10); vm += vma; if (vm < 0) { vm -= vma; vma = -vma; } vma--; rota++;
        }
        const plane = Math.log2(pl);
        slots[plv + ':' + plane] = sid;
        const layers = [];
        for (let k = 0; k < 4; k++) { const s = slots[plv + ':' + k]; if (s !== undefined) layers.push(s); }
        disp.push({ t: tt, layers, xpos, which });
        if (which === 3) { plv += 2; plv &= 7; } else { plv++; plv &= 7; }
        if (!plv) { pl <<= 1; if (pl > 15) pl = 1; }
        i++;
      }
      return tt;
    };
    let tt = run(1, 70 * 6, t);
    this.doit.push(t);
    tt = run(2, 70 * 12, tt);
    tt = run(3, 70 * 14, tt);
    this.barStates = states;
    this.barDisp = disp;
    this.tBars = t;
    return { end: tt + F(1) };
  },

  render(R, t) {
    const gl = R.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (t < this.tI2) return;
    if (t < this.tBlockSetup) return this.renderRings(R, t);
    if (t < this.tBars) return this.renderBlocks(R, t);
    if (t < this.tTrollLoad) return this.renderBars(R, t);
    return this.renderTroll(R, t);
  },

  ringFrameState(j, second) {
    // state after j MOVE steps
    const S = (i) => this.sn(i);
    const scrnrot = (5 * j) & 1023;
    let scrnx, scrny;
    if (second) { scrnx = (S(scrnrot) >> 2) + 160; scrny = (S(scrnrot + 256) >> 2) + 100; }
    else { scrnx = 160; scrny = 100; }
    const overrot = (211 + 7 * j) & 1023;
    const overx = (S(overrot) >> 2) + 160, overy = (S(overrot + 256) >> 2) + 100;
    return { scrnx, scrny, overx, overy };
  },

  renderRings(R, t) {
    const gl = R.gl;
    const second = t >= this.tI;
    const tb = second ? this.tI : this.tI2;
    const jf = (t - tb) * FPS;
    const j = Math.max(0, Math.floor(jf));
    // continuous positions for smooth motion
    const a = this.ringFrameState(j, second), b = this.ringFrameState(j + 1, second);
    const fr = jf - j;
    const L = (x, y) => x + (y - x) * fr;
    const scrnx = L(a.scrnx, b.scrnx), scrny = L(a.scrny, b.scrny);
    const overx = L(a.overx, b.overx), overy = L(a.overy, b.overy);
    // palette rotation: offset decreases by one entry per frame
    const off = ((-(j + 1)) % 8 + 8) % 8;
    const pal = new Float32Array(48);
    if (!second) {
      const dx = Math.min(512, 2 * (j + 1));
      for (let i = 0; i < 8; i++) {
        const c = PAL0[(off + i) & 7];
        for (let k = 0; k < 3; k++) {
          let v = dx <= 256 ? (c[k] * dx) >> 8 : Math.min(63, c[k] + (dx - 256));
          pal[i * 3 + k] = v / 63; pal[(i + 8) * 3 + k] = v / 63;
        }
      }
    } else {
      for (let i = 0; i < 8; i++) for (let k = 0; k < 3; k++) {
        pal[i * 3 + k] = PAL1[(off + i) & 7][k] / 63;
        pal[(i + 8) * 3 + k] = PAL2[(off + i) & 7][k] / 63;
      }
    }
    // white flash after the interference (flash 32/64/192/256)
    if (t >= this.tFlash1) {
      const n = Math.floor((t - this.tFlash1) * FPS);
      const w = [32, 64, 192, 256][Math.min(3, n)] / 256;
      for (let i = 0; i < 48; i++) pal[i] = pal[i] * (1 - w) + w;
    }
    // plane-3 wobble rows
    const wob = new Float32Array(200);
    if (second) {
      const sinuspower = j < 350 ? 0 : Math.min(15, Math.floor((j - 350) / 16));
      let bp = (7 * (j + 1)) & 1023;
      for (let row = 0; row < 200; row++) {
        bp = (bp + 9) & 1023;
        wob[row] = trunc((this.sn(bp) >> 3) * sinuspower / 15);
      }
    }
    const vp = { x: R.vx, y: R.vy, w: R.vw, h: R.vh };
    this.ringProg.use().tex('uR1', this.ringTex[0]).tex('uR2', this.ringTex[1])
      .f('uC1', 320 - scrnx, 200 - scrny).f('uC2', 320 - overx + 7, 200 - overy)
      .fv('uPal', pal, 3).f('uVp', vp.x, vp.y, vp.w, vp.h).f('uUse2', second ? 1 : 0).fv('uWobble', wob, 1);
    R.drawFullscreen();
  },

  renderBlocks(R, t) {
    const gl = R.gl;
    // screen: colour 15 = (45,52,60) where not yet wiped
    const col = [45 / 63, 52 / 63, 60 / 63];
    let white = 1; // after the flash to white
    let cleared = 0, zy = 0;
    for (let b = 0; b < 4; b++) {
      const B = this.blocks[b];
      if (t < B.wipe) break;
      const k = (t - B.wipe) * FPS; // wipe iteration
      const i = Math.min(21, Math.floor(k) + 1);
      cleared = b; zy = i * (i + 1) / 2;
      // flash(a): a = 256 - 32*(i-1) down to 0 -> white fades to palette
      const a = Math.max(0, 256 - 32 * (i - 1));
      white = a / 256;
      if (t >= B.flash) {
        const n = Math.floor((t - B.flash) * FPS);
        white = [32, 64, 192, 256][Math.min(3, n)] / 256;
        zy = 200;
      }
    }
    const c = col.map((v) => v * (1 - white) + white);
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const blk = [0, 0, 0].map(() => white);
    gl.clearColor(blk[0], blk[1], blk[2], 1);
    for (let b = 0; b < 4; b++) {
      let h = 0;
      if (b < cleared) h = 200;
      else if (b === cleared && t >= this.blocks[0].wipe) h = Math.min(200, zy);
      if (h > 0) { R.scissorVGA(b * 80, 0, 80, h); gl.clear(gl.COLOR_BUFFER_BIT); }
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
  },

  barQuads(st) {
    const S = (i) => this.sn(i);
    const hx = trunc(S(st.rot) * 16 * 6 / 5), hy = S(st.rot + 256) * 16;
    let vx = trunc(S(st.rot + 256) * 6 / 5), vy = S(st.rot + 512);
    vx = vx * st.vm / 100; vy = vy * st.vm / 100;
    const out = [];
    for (let c = -10; c < 11; c += 2) {
      const cx = vx * c * 2, cy = vy * c * 2;
      const p = [
        [(-hx - vx + cx) / 16 + st.wx, (-hy - vy + cy) / 16 + st.wy],
        [(-hx + vx + cx) / 16 + st.wx, (-hy + vy + cy) / 16 + st.wy],
        [(+hx + vx + cx) / 16 + st.wx, (+hy + vy + cy) / 16 + st.wy],
        [(+hx - vx + cx) / 16 + st.wx, (+hy - vy + cy) / 16 + st.wy]];
      out.push(p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], p[0][0], p[0][1], p[2][0], p[2][1], p[3][0], p[3][1]);
    }
    return out;
  },

  renderBars(R, t) {
    const gl = R.gl;
    // current iteration
    const D = this.barDisp;
    let lo = 0, hi = D.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (D[m].t <= t) lo = m; else hi = m - 1; }
    if (t < D[0].t) { gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.clearColor(0, 0, 0, 1); return; }
    const cur = D[lo];
    const verts = [];
    for (const s of cur.layers) verts.push(...this.barQuads(this.barStates[s]));
    const T = R.sceneTarget();
    R.bindTarget(T);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // bars of all 4 layers, additively (count of overlapping layers)
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW);
    this.barProg.use().f('uXoff', cur.which === 3 ? 320 - cur.xpos : 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    // each layer's 11 bars are drawn in one go; bars within a layer never overlap
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    // resolve and map counts through the beat-flashed palette
    if (!this.cntT || this.cntT.w !== R.vw || this.cntT.h !== R.vh) this.cntT = R.target(R.vw, R.vh, {});
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.msfb || T.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.cntT.fb);
    gl.blitFramebuffer(0, 0, T.w, T.h, 0, 0, T.w, T.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    R.bindTarget(null);
    // curpal: 15 when the row turns to x7, then -1 per frame
    const p = this.planner.pos(t);
    const rowStart = p.rowTime;
    let curpal = 0;
    // find the last row with (row&7)==7 start time
    const pos7 = this.lastRow7(t);
    if (pos7 !== null) curpal = Math.max(0, 15 - Math.floor((t - pos7) * FPS));
    const pal = this.barPals[curpal];
    const cols = new Float32Array(15);
    for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) cols[i * 3 + k] = pal[i][k] / 63;
    this.countProg.use().tex('uCount', this.cntT.color).fv('uCol', cols, 3);
    R.drawFullscreen();
    void rowStart;
  },

  lastRow7(t) {
    // walk back row by row (rows are ~58ms at speed 3/tempo 130)
    const P = this.planner;
    let tt = t;
    for (let k = 0; k < 10; k++) {
      const p = P.pos(tt);
      if ((p.row & 7) === 7) return p.rowTime;
      tt = p.rowTime - 1e-4;
    }
    return null;
  },

  renderTroll(R, t) {
    const gl = R.gl;
    const F = (t2) => (t2) * FPS;
    let xpos = 0;
    let flashAdd = 0;
    if (t >= this.tSlide) {
      if (t < this.tRipple) {
        const k = F(t - this.tSlide);
        const i = Math.min(this.slideX.length - 1, Math.floor(k));
        const a = i > 0 ? this.slideX[i - 1] : 0;
        xpos = a + (this.slideX[i] - a) * (k - i);
      } else if (t < this.tStatic) {
        const k = Math.floor(F(t - this.tRipple));
        xpos = this.rippleX[Math.min(49, k)];
        if (k < 16) flashAdd = 45 - k * 3;
      } else xpos = 320;
    }
    if (xpos <= 0) return;
    // troll lives at virtual x 320..639 of a 640-wide screen; view starts at xpos
    const x0 = 320 - xpos;
    this.troll.draw({ screen: [320, 400], dst: [x0, 0, x0 + 320, 400], add: flashAdd / 63 });
  },
};
