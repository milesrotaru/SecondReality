// BEGLOGO - the Second Reality title picture (Pixel) fading in from white.
// BEG/BEG.C: white screen for 32 frames, then a 129-frame white->picture fade.
import { FPS } from '../demo.js';
import { Picture } from '../gfx/picture.js';
import { clamp01 } from '../gfx/common.js';

export default {
  name: 'Title',
  credit: 'Pixel',

  init(R, A) {
    this.pic = new Picture(R, A.pic('beg.title'));
  },

  plan(P, t0) {
    this.t0 = t0;
    return t0 + (32 + 129) / FPS;
  },

  render(R, t) {
    const gl = R.gl;
    const k = (t - this.t0) * FPS - 32;
    if (k < 0) { gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const c = clamp01(k / 128);
    this.pic.draw({ mix: [1, 1, 1, 1 - c] });
  },
};
