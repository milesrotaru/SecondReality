// PAM - "Alkutekstit III" (Trug/Wildfire). The ship reaches the horizon and
// goes off like Praxis in Star Trek VI; the shock wall rolls toward the
// viewer and the screen burns out to white. PAM/OUTTAA.C: 40 flic frames,
// 4 retraces each, palette white-fade curve wfade[].
// HD: the flic's explosion layer is separated from its (re-quantised)
// landscape and composited over the HD horizon, with frame blending.
import { FPS } from '../demo.js';
import { GLSL_BICUBIC } from '../gfx/common.js';
import { Horizon } from './horizon.js';

const WFADE = [63, 32, 16, 8, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 2, 4, 6, 9, 14, 20, 28, 37, 46, 56, 63, 63, 63, 63, 63, 63, 63, 63, 63];

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uA, uB, uBg;
uniform float uMix, uWhite;
${GLSL_BICUBIC}
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 bg = texture(uBg, vUv).rgb;
  vec4 a = texBicubic(uA, uv), b = texBicubic(uB, uv);
  vec4 e = mix(a, b, uMix);
  float m = clamp(e.a, 0.0, 1.0);
  vec3 c = mix(bg, e.rgb / max(m, 1e-3), smoothstep(0.0, 1.0, m));
  c = mix(c, vec3(1.0), uWhite);
  o = vec4(c, 1.0);
}`;

export default {
  name: 'PAM',
  credit: 'Trug & Wildfire',

  init(R, A) {
    const gl = R.gl;
    this.horizon = Horizon.get(R, A);
    const d = A.bytes('pam.anim');
    const pal = A.bytes('pam.pal');
    const lut = A.bytes('pam.lut');
    const hoi = A.pic('alku.hoi');
    // flic background = horizon indices through the LUT
    const flicBg = new Uint8Array(64000).fill(255);
    for (let y = 25; y < 175; y++) for (let x = 0; x < 320; x++) flicBg[y * 320 + x] = lut[hoi.pix[(y - 25) * 640 + 320 + x]];
    const pages = [new Uint8Array(64000), new Uint8Array(64000)];
    let si = 0;
    this.frames = [];
    for (let k = 0; k < 40; k++) {
      const pg = pages[k & 1];
      let di = 0;
      for (;;) {
        let al = d[si++]; if (al > 127) al -= 256;
        if (al < 0) { di -= al; continue; }
        if (al === 0) break;
        pg.fill(d[si++], di, di + al); di += al;
      }
      si = (si + 15) & ~15;
      // premultiplied RGBA: alpha = explosion layer mask
      const rgba = new Uint8Array(64000 * 4);
      for (let i = 0; i < 64000; i++) {
        const c = pg[i];
        const isExp = (c !== flicBg[i] && !(flicBg[i] === 255 && c === 0)) ? 1 : 0;
        const r = pal[c * 3] * 255 / 63, g = pal[c * 3 + 1] * 255 / 63, b = pal[c * 3 + 2] * 255 / 63;
        rgba[i * 4] = r * isExp; rgba[i * 4 + 1] = g * isExp; rgba[i * 4 + 2] = b * isExp; rgba[i * 4 + 3] = isExp * 255;
      }
      this.frames.push(R.texture(320, 200, { data: rgba, filter: gl.LINEAR }));
    }
    this.prog = R.fsProgram(FS);
    this.bgT = null;
  },

  plan(P, t0) {
    this.t0 = P.untilSync(t0, 10);
    // 45 steps of 4 retraces
    return this.t0 + 45 * 4 / FPS + 1 / FPS;
  },

  render(R, t) {
    const gl = R.gl;
    const step = (t - this.t0) * FPS / 4;
    // background layer into an offscreen target
    if (!this.bgT || this.bgT.w !== R.vw || this.bgT.h !== R.vh) this.bgT = R.target(R.vw, R.vh, { filter: gl.NEAREST });
    R.bindTarget(this.bgT);
    this.horizon.draw(R, 320, 1);
    R.bindTarget(null);
    if (step < 0) {
      // waiting for the sync: landscape as U2A left it
      this.horizon.draw(R, 320, 1);
      return;
    }
    // whiteness: wfade[] of the current step, eased between steps
    const si = Math.floor(step), sf = step - si;
    const w0 = WFADE[Math.min(si, WFADE.length - 1)], w1 = WFADE[Math.min(si + 1, WFADE.length - 1)];
    const white = (w0 + (w1 - w0) * sf) / 64;
    // step f shows frame f-1 (frames 0..39); blend towards the next one
    const fk = Math.max(0, Math.min(39, step - 1));
    const k0 = Math.floor(fk), k1 = Math.min(39, k0 + 1);
    this.prog.use().tex('uA', this.frames[k0]).tex('uB', this.frames[k1]).tex('uBg', this.bgT.color)
      .f('uMix', step < 1 ? 0 : fk - k0).f('uWhite', white);
    R.drawFullscreen();
  },
};
