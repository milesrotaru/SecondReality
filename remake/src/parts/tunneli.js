// TUNNELI - dot tunnel (Trug). TUNNELI/TUN10.PAS: 100 rings of 64 dots, a
// new ring every retrace at the far end, positions from two growing sine
// tables, drawn relative to ring 5. 1060 frames, no music sync.
// HD: rings move continuously in depth, dots are smooth discs.
import { FPS } from '../demo.js';

const VEKE = 1060;

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aDot; // x,y (VGA), size (VGA px), brightness
out vec2 vC;
out float vB;
uniform float uPx; // VGA px -> NDC scale x
void main(){
  vC = aCorner;
  vB = aDot.w;
  vec2 p = aDot.xy + aCorner * aDot.z;
  gl_Position = vec4(p.x / 160.0 - 1.0, 1.0 - p.y / 100.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vC;
in float vB;
out vec4 o;
void main(){
  float r = length(vC);
  float a = 1.0 - smoothstep(0.55, 1.0, r);
  o = vec4(vec3(vB) * a, 1.0);
}`;

// ---- remix: every dot is a hot particle streaked along its motion, each
// ring also glows as a faint continuous hoop, and a light sits at the far end.
const RX_DOT_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aA;    // pos now (VGA), pos a moment ago
layout(location=2) in vec4 aB;    // radius (VGA px), intensity, hue, unused
out vec2 vQ;
out vec3 vCol;
out float vLen;
void main(){
  vec2 p1 = aA.xy, p0 = aA.zw;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 ax = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 ay = vec2(-ax.y, ax.x);
  float r = aB.x;
  // a capsule from p0 to p1 of radius r
  vec2 c = (p0 + p1) * 0.5;
  vec2 p = c + ax * aCorner.x * (len * 0.5 + r * 2.0) + ay * aCorner.y * r * 2.0;
  vQ = vec2(aCorner.x * (len * 0.5 + r * 2.0), aCorner.y * r * 2.0) / r;
  vLen = len * 0.5 / r;
  vec3 a = vec3(0.55, 0.85, 1.6), b = vec3(1.5, 0.55, 1.3);
  vCol = mix(a, b, aB.z) * aB.y / (1.0 + len / r * 0.15);
  gl_Position = vec4(p.x / 160.0 - 1.0, 1.0 - p.y / 100.0, 0.0, 1.0);
}`;
const RX_DOT_FS = `#version 300 es
precision highp float;
in vec2 vQ;
in vec3 vCol;
in float vLen;
out vec4 o;
void main(){
  vec2 q = vec2(max(abs(vQ.x) - vLen, 0.0), vQ.y);
  float d = length(q);
  float core = exp(-d * d * 2.2), halo = exp(-d * 1.6) * 0.18;
  o = vec4(vCol * (core + halo), 1.0);
}`;
const RX_RING_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aR;    // centre (VGA), radii (VGA)
layout(location=2) in vec4 aC;    // width (VGA px), intensity, hue
out vec2 vP;
flat out vec4 vR;
flat out vec4 vC;
void main(){
  vR = aR; vC = aC;
  vec2 p = aR.xy + aCorner * (aR.zw + aC.x * 4.0 + 2.0);
  vP = p;
  gl_Position = vec4(p.x / 160.0 - 1.0, 1.0 - p.y / 100.0, 0.0, 1.0);
}`;
const RX_RING_FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vR;
flat in vec4 vC;
out vec4 o;
void main(){
  vec2 q = (vP - vR.xy) / vR.zw;
  float k = length(q);
  // distance to the ellipse, in VGA px (first-order)
  vec2 g = q / (vR.zw * max(k, 1e-3));
  float d = abs(k - 1.0) / max(length(g), 1e-4);
  float w = vC.x;
  float a = exp(-d * d / (w * w)) * 0.8 + exp(-d / (w * 4.0)) * 0.08;
  vec3 c = mix(vec3(0.3, 0.55, 1.2), vec3(1.1, 0.35, 0.95), vC.z);
  o = vec4(c * vC.y * a, 1.0);
}`;
const RX_END_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec2 uC;      // far end centre (VGA)
uniform float uI;
void main(){
  vec2 p = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec2 d = (p - uC) / vec2(1.7, 1.0);
  float r = length(d);
  vec3 c = vec3(0.35, 0.5, 1.0) * uI * (exp(-r / 4.0) * 0.8 + exp(-r / 25.0) * 0.03);
  o = vec4(c, 1.0);
}`;

export default {
  name: 'Tunneli',
  credit: 'Trug',

  init(R, A) {
    const gl = R.gl;
    this.sinit = A.i16('tunneli.sinit');
    this.cosit = A.i16('tunneli.cosit');
    this.prog = R.program(VS, FS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const q = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, q);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    this.buf = new Float32Array(90 * 64 * 4);
  },

  plan(P, t0) {
    this.t0 = t0 + 1 / FPS;
    return this.t0 + VEKE / FPS;
  },

  // ring created at step m: position and colour
  ringPos(m) {
    const s = this.sinit, c = this.cosit;
    return [-s[(m * 3) & 4095], s[(m * 2) & 4095] - c[m & 2047] + s[0]];
  },
  ringCol(m) {
    if (m >= VEKE - 102) return 0;
    return ((m + 1) & 15) > 7 ? 128 : 64;
  },

  initRemix(R) {
    const gl = R.gl;
    const mk = (a1, a2) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const q = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, q);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const inst = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
      return { vao, inst };
    };
    this.rx = {
      dot: R.program(RX_DOT_VS, RX_DOT_FS), ring: R.program(RX_RING_VS, RX_RING_FS), end: R.fsProgram(RX_END_FS),
      dots: mk(), rings: mk(), dbuf: new Float32Array(90 * 64 * 8), rbuf: new Float32Array(100 * 8),
    };
  },

  // ring state at time F: returns list of {cx, cy, rx, ry, b, hue, x}
  ringsAt(F) {
    const posAt = (mf) => {
      const m0 = Math.floor(mf), a = mf - m0;
      if (m0 < 0) return [0, 0];
      const p0 = this.ringPos(m0), p1 = this.ringPos(m0 + 1);
      return [p0[0] + (p1[0] - p0[0]) * a, p0[1] + (p1[1] - p0[1]) * a];
    };
    const ref = posAt(F - 95);
    const out = new Map();
    for (let m = Math.ceil(F - 96); m <= F - 20; m++) {
      if (m < 0) continue;
      const x = 100 - F + m;
      if (x < 4 || x > 80) continue;
      const col = this.ringCol(m);
      if (!col) continue;
      const k = Math.round(x / 1.3);
      let b = k === 4 ? 0 : (col === 64 ? (64 - x / 1.3) / 63 : ((64 - x / 1.3) * 3 / 4) / 63);
      const p = this.ringPos(m);
      const z = 16384 / (x * 7 + 95) + 10;
      out.set(m, { cx: 160 + p[0] - ref[0], cy: 100 + p[1] - ref[1], rx: z * 1.7, ry: z, b: Math.max(0, b), hue: col === 64 ? 0 : 1, x });
    }
    return out;
  },

  renderRemix(R, t, post) {
    const gl = R.gl;
    if (!this.rx) this.initRemix(R);
    const X = this.rx;
    post.begin({ samples: 4 });
    const F = (t - this.t0) * FPS;
    if (F > 0) {
      const now = this.ringsAt(F), prev = this.ringsAt(F - 0.35);
      let nd = 0, nr = 0;
      let far = null;
      for (const [m, r] of now) {
        if (!far || r.x > far.x) far = r;
        if (r.b <= 0) continue;
        const p = prev.get(m) || r;
        const I = Math.pow(r.b, 1.6) * 2.2;
        const size = 0.35 + 0.5 * Math.min(1, r.ry / 140);
        X.rbuf.set([r.cx, r.cy, r.rx, r.ry, 0.2 + r.ry / 400, I * 0.045, r.hue, 0], nr * 8); nr++;
        for (let i = 0; i < 64; i++) {
          const a = i * Math.PI / 32, sa = Math.sin(a), ca = Math.cos(a);
          const x1 = r.cx + sa * r.rx, y1 = r.cy + ca * r.ry;
          if (x1 < -8 || x1 > 328) continue;
          X.dbuf.set([x1, y1, p.cx + sa * p.rx, p.cy + ca * p.ry, size, I, r.hue, 0], nd * 8); nd++;
        }
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      if (far) X.end.use().f('uC', far.cx, far.cy).f('uI', Math.min(1, F / 60) * Math.max(0, Math.min(1, (940 - F) / 80))), R.drawFullscreen();
      gl.bindVertexArray(X.rings.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, X.rings.inst);
      gl.bufferData(gl.ARRAY_BUFFER, X.rbuf.subarray(0, nr * 8), gl.STREAM_DRAW);
      X.ring.use();
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, nr);
      gl.bindVertexArray(X.dots.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, X.dots.inst);
      gl.bufferData(gl.ARRAY_BUFFER, X.dbuf.subarray(0, nd * 8), gl.STREAM_DRAW);
      X.dot.use();
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, nd);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
    post.end(t, { exposure: 1.0, bloom: 0.14, grain: 0.02, vignette: 0.3 });
    return true;
  },

  render(R, t) {
    const gl = R.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const F = (t - this.t0) * FPS;
    if (F <= 0) return;
    const posAt = (mf) => { // interpolated ring position for fractional creation step
      const m0 = Math.floor(mf), a = mf - m0;
      if (m0 < 0) return [0, 0];
      const p0 = this.ringPos(m0), p1 = this.ringPos(m0 + 1);
      return [p0[0] + (p1[0] - p0[0]) * a, p0[1] + (p1[1] - p0[1]) * a];
    };
    // ring at index 5 (the reference ring)
    const ref = posAt(F - 95);
    let n = 0;
    const buf = this.buf;
    for (let m = Math.ceil(F - 96); m <= F - 20; m++) {
      if (m < 0) continue;
      const x = 100 - F + m; // continuous ring index (depth)
      if (x < 4 || x > 80) continue;
      const col = this.ringCol(m);
      if (!col) continue;
      const k = Math.round(x / 1.3);
      let b;
      if (k === 4) b = 0;
      else b = col === 64 ? (64 - x / 1.3) / 63 : ((64 - x / 1.3) * 3 / 4) / 63;
      if (b <= 0) continue;
      const p = this.ringPos(m);
      const dx = p[0] - ref[0], dy = p[1] - ref[1];
      const z = 16384 / (x * 7 + 95) + 10;
      const rx = z * 1.7, ry = z;
      const size = 0.55 + 0.35 * Math.min(1, z / 140);
      for (let i = 0; i < 64; i++) {
        const a = i * Math.PI / 32;
        const X = 160 + Math.sin(a) * rx + dx, Y = 100 + Math.cos(a) * ry + dy;
        if (X < -2 || X > 322) continue;
        buf[n * 4] = X + 0.5; buf[n * 4 + 1] = Y + 0.5; buf[n * 4 + 2] = size; buf[n * 4 + 3] = Math.min(1, b);
        n++;
      }
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, n * 4), gl.STREAM_DRAW);
    this.prog.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  },
};
