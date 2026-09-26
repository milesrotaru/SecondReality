// The end: U2.ASM fades the music out (volume -1 per retrace) and leaves
// the U2END.BIN text screen on the console. The screen is taken from the
// capture (VGA text mode), shown with crisp upscaling.
import { FPS } from '../demo.js';
import { Picture } from '../gfx/picture.js';

export default {
  name: 'End',
  credit: 'Future Crew',

  init(R, A) {
    const m = A.meta('u2end.screen');
    this.pic = new Picture(R, { w: m.w, h: m.h, pix: null, rgba: A.bytes('u2end.screen') });
  },

  plan(P, t0) {
    this.tShow = t0 + 64 / FPS;
    this.fades = [{ start: t0, end: t0 + 64 / FPS, from: 1, to: 0 }];
    return this.tShow + 1;
  },

  render(R, t) {
    if (t < this.tShow) return;
    this.pic.draw({ screen: [640, 400], dst: [0, 0, 640, 400], filter: 2 });
  },
};
