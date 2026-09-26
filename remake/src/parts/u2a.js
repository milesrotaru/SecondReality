// U2A - "Alkutekstit II" (Psi). The massive ship thunders over the horizon
// picture (same view the intro scroll ended on) and away toward the horizon.
// VISU/C/U2A.C: waits for order>10,row>46; one animation step per retrace.
import { FPS } from '../demo.js';
import { VisuScene } from '../gfx/visu.js';
import { Horizon } from './horizon.js';

export default {
  name: 'U2A',
  credit: 'Psi',

  init(R, A) {
    this.scene = new VisuScene(R, A, 'u2a');
    // background palette 192..255 is the horizon picture palette (U2A.C memcpy)
    const pal = new Uint8Array(this.scene.palette);
    const hp = A.pic('alku.hoi').pal;
    pal.set(hp.subarray(0, 64 * 3), 192 * 3);
    this.scene.setPalette(pal);
    this.horizon = Horizon.get(R, A);
  },

  plan(P, t0) {
    this.animStart = P.until(t0, (p) => p.ord > 10 && p.row > 46);
    this.lag = 20 / FPS; // copperdelay=16 + page queue (calibrated on capture)
    const streamEnd = this.animStart + this.lag + (this.scene ? this.scene.frameCount : 521) / FPS;
    const musicEnd = P.until(this.animStart, (p) => p.ord > 11 && p.row > 54);
    this.animEnd = Math.min(streamEnd, musicEnd);
    return this.animEnd;
  },

  render(R, t) {
    const gl = R.gl;
    const T = R.sceneTarget();
    R.bindTarget(T);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.horizon.draw(R, 320, 1);
    const f = (t - this.animStart - this.lag) * FPS;
    if (f >= 0 && f < this.scene.frameCount) {
      R.scissorVGA(0, 25, 320, 150);
      this.scene.draw(f);
      gl.disable(gl.SCISSOR_TEST);
    }
    R.present(T);
  },
};
