// PANICEND (Wildfire) - the "panic" end: the troll collapses like a TV being
// switched off. PANIC/SHUTDOWN.C: squash into a whitening band
// (a = 32, a*5/6 ... > 2, one frame each), a line that shrinks 3 pixels per
// side per frame, then a single dot pulsing (cos) for 60 frames, then sleep(1).
import { FPS } from '../demo.js';
import { Picture } from '../gfx/picture.js';

export default {
  name: 'Panic',
  credit: 'Wildfire',

  init(R, A) {
    const pic = A.pic('techno.troll');
    // fadepals[] start at byte 3: colour 0 (the black surround) never whitens
    this.troll = new Picture(R, pic, { alphaIndex: 0 });
    // colour of the collapsed line: the picture's middle rows, averaged
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 196; y < 204; y++) for (let x = 60; x < 260; x++) {
      const c = pic.pix[y * pic.w + x] * 3;
      r += pic.pal[c]; g += pic.pal[c + 1]; b += pic.pal[c + 2]; n++;
    }
    this.lineCol = [r / n / 63, g / n / 63, b / n / 63];
    const as = [];
    for (let a = 32; a > 2; a = Math.trunc(a * 5 / 6)) as.push(a);
    this.as = as;
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    this.t0 = t0;
    this.tSquash = t0 + F(2);
    this.tLine = this.tSquash + F(this.as.length);
    this.tDot = this.tLine + F(47);
    this.tSleep = this.tDot + F(60);
    return this.tSleep + 1.0;
  },

  render(R, t) {
    const gl = R.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const F = (x) => x * FPS;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (t < this.tSquash) {
      // switch-over: one frame with colour 0 set white (fadepals[3]), then fadepals[20]
      const first = t < this.t0 + 1 / FPS;
      if (first) { gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.clearColor(0, 0, 0, 1); }
      this.troll.draw({ screen: [320, 200], dst: [0, 75, 320, 125], mix: [1, 1, 1, (first ? 3 : 20) / 64] });
      gl.disable(gl.BLEND);
      return;
    }
    if (t < this.tLine) {
      const k = F(t - this.tSquash);
      const i = Math.min(this.as.length - 1, Math.floor(k));
      const a0 = this.as[i], a1 = i + 1 < this.as.length ? this.as[i + 1] : 2;
      const a = a0 + (a1 - a0) * (k - i);
      const white = (63 - a) / 64;
      this.troll.draw({ screen: [320, 200], dst: [0, 100 - a / 2, 320, 100 + a / 2], mix: [1, 1, 1, white] });
      gl.disable(gl.BLEND);
      return;
    }
    gl.disable(gl.BLEND);
    const c = this.lineCol.map((v) => v + (1 - v) * 61 / 64);
    if (t < this.tDot) {
      const k = F(t - this.tLine);
      const x = 20 + 3 * k;
      const x0 = x + 1, x1 = 319 - x;
      if (x1 > x0) {
        R.scissorVGA(x0, 99.5, x1 - x0, 1.0);
        gl.clearColor(c[0], c[1], c[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0, 0, 0, 1);
      }
      return;
    }
    const k = Math.min(59, F(t - this.tDot));
    const b = (Math.cos(k / 120 * 3 * 2 * Math.PI) * 31 + 32) / 63;
    R.scissorVGA(159.5, 99.5, 1.2, 1.0);
    gl.clearColor(b, b, b, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
  },
};
