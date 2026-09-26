// JPLOGO (Psi) - the ice-kingdom picture drops in and wobbles like jelly.
// JPLOGO/JP.C + ASM.ASM + ZOOM.INC: in 320x400, the start address slides
// the picture down (speed +6/64 row per frame); then a precomputed spring
// (top/bottom edge, integer physics at 1/4 rate) squashes it vertically and
// each row is re-zoomed horizontally by a half-sine bulge proportional to
// the squash.
// HD: the same curves, evaluated continuously; rows and columns resampled
// bicubically instead of by the unrolled zoom routines.
import { FPS } from '../demo.js';
import { GLSL_BICUBIC } from '../gfx/common.js';
import { palToRGBA } from '../gfx/gl.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPic;
uniform float uScroll;   // phase 1: start-address row offset (-1 = phase 2)
uniform vec2 uY;         // phase 2: y1, y2 (rows of 400)
uniform float uXsc;
${GLSL_BICUBIC}
const float PI = 3.14159265;
vec3 pic(float u, float v){ return clamp(texBicubic(uPic, vec2(u / 185.0, v / 400.0)).rgb, 0.0, 1.0); }
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
      // a = 184 + sin1024[b*32/25]*xsc/64, zoom routines exist for 140..244
      float a = clamp(184.0 + 255.0 * sin(clamp(b, 0.0, 400.0) * 32.0 / 25.0 * PI / 512.0) * uXsc / 64.0, 140.0, 244.0);
      float le = 160.0 - a * 0.5, ri = 160.0 + a * 0.5 + 1.0;
      float cov = covy * smoothstep(le - fw, le + fw, p.x) * (1.0 - smoothstep(ri - fw, ri + fw, p.x));
      if (cov > 0.0) c = pic((p.x - le) * 185.0 / (a + 1.0), b) * cov;
    }
  }
  o = vec4(c, 1.0);
}`;

function physics() {
  const y1s = new Int32Array(201), y2s = new Int32Array(201);
  let y1 = 0, y1a = 500, y2 = 399 * 16, y2a = 500, mika = 1, halt = 0, a = 200, la;
  const t = (v) => Math.trunc(v);
  for (let f = 0; f < 200; f++) {
    if (!halt) {
      y1 += y1a; y2 += y2a;
      y2a += 16;
      if (y2 > 400 * 16) { y2 -= y2a; y2a = t(-y2a * mika / 8); if (mika < 4) mika += 3; }
      y1a += 16;
      la = a;
      a = (y2 - y1) - 400 * 16;
      if ((a & 0x8000) ^ (la & 0x8000)) y1a = t(y1a * 7 / 8);
      y1a += t(a / 8); y2a -= t(a / 8);
    }
    if (f > 90) {
      if (y2 >= 399 * 16) { y2 = 400 * 16; halt = 1; } else y2a = 8;
      y1 = y2 - 400 * 16;
    }
    y1s[f] = y1; y2s[f] = y2;
  }
  y1s[200] = y2s[0]; // framey1[200] reads framey2[0]
  const y1t = new Float32Array(800), y2t = new Float32Array(800);
  for (let i = 0; i < 800; i++) {
    const b = i >> 2, c = i & 3, d = 3 - c;
    y1t[i] = t((y1s[b] * d + y1s[Math.min(200, b + 1)] * c) / 3) / 16;
    y2t[i] = t((y2s[b] * d + (b + 1 < 200 ? y2s[b + 1] : y2s[199]) * c) / 3) / 16;
  }
  return [y1t, y2t];
}

export default {
  name: 'JPLogo',
  credit: 'Psi',

  init(R, A) {
    const gl = R.gl;
    const pic = A.pic('jp.pic');
    this.tex = R.texture(pic.w, pic.h, { data: palToRGBA(pic.pix, pic.pal), filter: gl.LINEAR });
    this.prog = R.fsProgram(FS);
    [this.y1t, this.y2t] = physics();
    // slide: y -= a, a += 6 from y = 400*64, a = 64
    const s = [400];
    let y = 400 * 64, a = 64;
    while (y > 0) { y -= a; a += 6; if (y < 0) y = 0; s.push(y / 64); }
    this.slide = s;
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    this.tSlide = t0 + F(5);                    // load, readp of 400 rows, 2 waitb
    this.tWait = this.tSlide + F(this.slide.length);
    this.tLoop = P.until(this.tWait, (p) => p.musplus >= 4);
    return this.tWait + F(700);                 // doit(): frame < 700, frame counts from tWait
  },

  render(R, t) {
    const F = (x) => x * FPS;
    const pr = this.prog.use().tex('uPic', this.tex);
    if (t < this.tLoop) {
      const k = Math.max(0, F(t - this.tSlide));
      const i = Math.min(this.slide.length - 1, Math.floor(k)), f = k - i;
      const s = i + 1 < this.slide.length ? this.slide[i] + (this.slide[i + 1] - this.slide[i]) * f : 0;
      pr.f('uScroll', s).f('uY', 0, 400).f('uXsc', 0);
    } else {
      const fr = Math.min(511, F(t - this.tWait));
      const i = Math.floor(fr), f = fr - i;
      const L = (a) => a[i] + (a[Math.min(799, i + 1)] - a[i]) * f;
      const y1 = L(this.y1t), y2 = L(this.y2t);
      pr.f('uScroll', -1).f('uY', y1, y2).f('uXsc', (400 - (y2 - y1)) / 8);
    }
    R.drawFullscreen();
  },
};
