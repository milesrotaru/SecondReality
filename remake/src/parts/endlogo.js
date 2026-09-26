// ENDLOGO - the Future Crew rings. END/END.C: white screen, 32 frames, the
// 320x400 picture fades in from white over 129 frames, holds until
// musplus > -16, fades to black over 64 frames.
import { FPS } from '../demo.js';
import { Picture } from '../gfx/picture.js';

export default {
  name: 'EndLogo',
  credit: 'Pixel',

  init(R, A) {
    this.pic = new Picture(R, A.pic('end.pic'));
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    this.tIn = t0 + 0.47;                      // 2 waitb + 32 frames + decoding (capture)
    this.tHold = this.tIn + F(129);
    this.tOut = P.until(this.tHold, (p) => p.musplus > -16);
    return this.tOut + F(64);
  },

  render(R, t) {
    const gl = R.gl;
    const F = (x) => x * FPS;
    if (t < this.tIn) {
      gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.clearColor(0, 0, 0, 1);
      return;
    }
    const c = Math.min(128, F(t - this.tIn));
    const out = t >= this.tOut ? Math.max(0, 63 - F(t - this.tOut)) / 64 : 1;
    this.pic.draw({ screen: [320, 400], dst: [0, 0, 320, 400], mix: [1, 1, 1, (128 - c) / 128], bright: out });
  },
};
