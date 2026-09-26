// CRED - the per-part credits. CREDITS/MAIN.C: 21 screens; each shows a
// 160x100 picture of a part (top) and the credits text (bottom). In a
// 640-wide double-scanned tweak mode the picture slides in from the right
// (start address + pel panning, yy = 320 - y/80) while the text rises from
// the bottom (line compare y/128 + 200), with y *= 12/13 per frame; after
// 200 frames both leave accelerating (y += v, v += 15).
// The texts and pictures follow the released binary (capture), which differs
// from the released MAIN.C/LBMs in a few screens.
// HD: the text uses the full 32-row font (the original shows every other
// row), everything is resampled smoothly with sub-frame motion.
import { FPS } from '../demo.js';
import { GLSL_BICUBIC } from '../gfx/common.js';

const SCREENS = [
  ['GRAPHICS - MARVEL', 'MUSIC - SKAVEN', 'CODE - WILDFIRE'],
  ['GRAPHICS - MARVEL', 'MUSIC - SKAVEN', 'CODE - PSI', 'OBJECTS - WILDFIRE'],
  ['GRAPHICS - MARVEL', 'MUSIC - SKAVEN', 'CODE - WILDFIRE', 'ANIMATION - TRUG'],
  ['', 'GRAPHICS - PIXEL'],
  ['GRAPHICS - PIXEL', 'MUSIC - PURPLE MOTION', 'CODE - PSI'],
  ['', 'MUSIC - PURPLE MOTION', 'CODE - TRUG'],
  ['', 'MUSIC - PURPLE MOTION', 'CODE - PSI'],
  ['', 'MUSIC - PURPLE MOTION', 'CODE - PSI'],
  ['', 'GRAPHICS - PIXEL', 'MUSIC - PURPLE MOTION'],
  ['GRAPHICS - PIXEL', 'MUSIC - PURPLE MOTION', 'CODE - TRUG', 'RENDERING - TRUG'],
  ['SKETCH - SKAVEN', 'GRAPHICS - PIXEL', 'MUSIC - PURPLE MOTION', 'CODE - PSI'],
  ['SKETCH - SKAVEN', 'GRAPHICS - PIXEL', 'MUSIC - PURPLE MOTION', 'CODE - PSI'],
  ['', 'MUSIC - PURPLE MOTION', 'CODE - WILDFIRE'],
  ['', 'MUSIC - PURPLE MOTION', 'CODE - WILDFIRE'],
  ['', 'MUSIC - PURPLE MOTION', 'CODE - PSI'],
  ['GRAPHICS - PIXEL', 'MUSIC - PURPLE MOTION', 'CODE - TRUG', 'RENDERING - TRUG'],
  ['', 'MUSIC - PURPLE MOTION', 'CODE - PSI'],
  ['GRAPHICS - MARVEL', 'MUSIC - PURPLE MOTION', 'CODE - PSI'],
  ['MUSIC - SKAVEN', 'CODE - PSI', 'WORLD - TRUG'],
  ['GRAPHICS - PIXEL', 'MUSIC - SKAVEN'],
  ['GRAPHICS - PIXEL', 'MUSIC - SKAVEN', 'CODE - WILDFIRE'],
];
const FONAORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/?!:,."()+-';
const CYCLE = 364; // frames per screen, measured on the capture

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPic, uText;
uniform float uYY, uSplit;   // horizontal scroll (px), split row (display rows)
${GLSL_BICUBIC}
void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * vec2(320.0, 200.0);
  float fh = fwidth(p.y) * 0.5, fw = fwidth(p.x) * 0.5;
  float below = smoothstep(uSplit - fh, uSplit + fh, p.y);
  vec3 c = vec3(0.0);
  // top: memory line 200 + row; picture at columns 400..559, lines 200..299
  vec2 q = vec2(p.x + uYY - 400.0, p.y);
  if (q.x > -1.0 && q.x < 161.0 && q.y < 101.0) {
    float cov = smoothstep(-fw, fw, q.x) * (1.0 - smoothstep(160.0 - fw, 160.0 + fw, q.x)) * (1.0 - smoothstep(100.0 - fh, 100.0 + fh, q.y));
    c = clamp(texBicubic(uPic, q / vec2(160.0, 100.0)).rgb, 0.0, 1.0) * cov;
  }
  // bottom: memory from line 0, the text (putpixel rows at half height)
  float ty = (p.y - uSplit) * 2.0;
  float tv = ty >= 0.0 ? texture(uText, vec2(p.x / 320.0, ty / 200.0)).r : 0.0;
  o = vec4(mix(c, vec3(tv), below), 1.0);
}`;

export default {
  name: 'Cred',
  credit: 'Future Crew',

  init(R, A) {
    const gl = R.gl;
    const fm = A.meta('cred.font'), font = A.bytes('cred.font');
    const FW = fm.w, FY = fm.h;
    const colEmpty = (x) => { for (let y = 0; y < FY; y++) if (font[y * FW + x]) return false; return true; };
    const gp = {}, gw = {};
    let x = 0;
    for (const ch of FONAORDER) {
      while (x < FW && colEmpty(x)) x++;
      const b = x;
      while (x < FW && !colEmpty(x)) x++;
      gp[ch] = b; gw[ch] = x - b;
    }
    gp[' '] = FW - 32; gw[' '] = 8;
    const pm = A.meta('cred.pics'), pics = A.bytes('cred.pics');
    this.pics = [];
    this.texts = [];
    for (let s = 0; s < SCREENS.length; s++) {
      const rgba = new Uint8Array(160 * 100 * 4);
      for (let i = 0; i < 160 * 100; i++) {
        rgba.set(pics.subarray((s * 16000 + i) * 3, (s * 16000 + i) * 3 + 3), i * 4);
        rgba[i * 4 + 3] = 255;
      }
      this.pics.push(R.texture(pm.w, pm.h, { data: rgba, filter: gl.LINEAR }));
      // text laid out in putpixel coordinates (320 x 200), grey 7*v
      const buf = new Uint8Array(320 * 200);
      let y = 16;
      for (const line of SCREENS[s]) {
        let w = 0;
        for (const ch of line) w += (gw[ch] ?? 8) + 2;
        let cx = 160 - Math.trunc(w / 2);
        for (const ch of line) {
          const sx = gp[ch] ?? gp[' '], cw = gw[ch] ?? 8;
          for (let i = 0; i < cw; i++) for (let r = 0; r < FY; r++) {
            const X = cx + i, Y = y + r;
            if (X >= 0 && X < 320 && Y < 200) buf[Y * 320 + X] = Math.min(255, font[r * FW + sx + i] * 7 * 255 / 63);
          }
          cx += cw + 2;
        }
        y += FY + 10;
      }
      this.texts.push(R.texture(320, 200, { internal: gl.R8, format: gl.RED, data: buf, filter: gl.LINEAR }));
    }
    this.prog = R.fsProgram(FS);
    // motion curves
    this.yin = [];
    for (let y = 200 * 128; y > 0; y = Math.trunc(y * 12 / 13)) this.yin.push(y);
    this.yin.push(0);
    this.yout = [];
    for (let y = 0, v = 0; y < 128 * 200; y += v, v += 15) this.yout.push(y);
    this.yout.push(128 * 200);
    const k80 = this.yin.findIndex((y) => y < 80);
    this.lead = 72 - k80; // capture: screen 1 settles at frame 68 of its segment
  },

  plan(P, t0) {
    this.t0 = t0 + this.lead / FPS;
    return t0 + (SCREENS.length * CYCLE - 8) / FPS;
  },

  render(R, t) {
    const F = (x) => x * FPS;
    const fr = F(t - this.t0);
    const s = Math.max(0, Math.min(SCREENS.length - 1, Math.floor(fr / CYCLE)));
    const k = fr - s * CYCLE;
    const nIn = this.yin.length, hold = 200;
    const curve = (arr, i) => {
      const a = Math.max(0, Math.min(arr.length - 1, Math.floor(i))), b = Math.min(arr.length - 1, a + 1);
      return arr[a] + (arr[b] - arr[a]) * Math.max(0, Math.min(1, i - a));
    };
    let yy, split;
    if (k < 0) { yy = 0; split = 200; } else if (k < nIn) {
      const y = curve(this.yin, k);
      yy = 320 - y / 80; split = (y / 128 + 200) / 2;
    } else if (k < nIn + hold) { yy = 320; split = 100; } else {
      const y = curve(this.yout, k - nIn - hold);
      yy = 320 + y / 80; split = (y / 128 + 200) / 2;
    }
    this.prog.use().tex('uPic', this.pics[s]).tex('uText', this.texts[s]).f('uYY', yy).f('uSplit', split);
    R.drawFullscreen();
  },
};
