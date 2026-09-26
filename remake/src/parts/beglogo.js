// BEGLOGO - the Second Reality title picture (Pixel) fading in from white.
// BEG/BEG.C: white screen for 32 frames, then a 129-frame white->picture fade.
import { FPS } from '../demo.js';
import { Picture } from '../gfx/picture.js';
import { clamp01 } from '../gfx/common.js';
import { TitleScene } from './title_remix.js';

export default {
  name: 'Title',
  credit: 'Pixel',

  init(R, A) {
    this.pic = new Picture(R, A.pic('beg.title'));
    this.A = A;
  },

  plan(P, t0) {
    this.t0 = t0;
    return t0 + (32 + 129) / FPS;
  },

  // remix: the ice sculpture (title_remix.js) with the same white fade
  renderRemix(R, t, post) {
    if (!this.scene) this.scene = TitleScene.get(R, this.A);
    const k = (t - this.t0) * FPS - 32;
    post.begin({ samples: 1 });
    if (k >= 0) this.scene.draw(R, { time: t });
    post.end(t, { exposure: 1.0, bloom: 0.05, grain: 0.015, vignette: 0.12, fade: [1, 1, 1, 1 - clamp01(k / 128)] });
    return true;
  },

  render(R, t) {
    const gl = R.gl;
    const k = (t - this.t0) * FPS - 32;
    if (k < 0) { gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const c = clamp01(k / 128);
    this.pic.draw({ mix: [1, 1, 1, 1 - c] });
  },
};
