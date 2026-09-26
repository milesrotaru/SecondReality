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
