// U2A - "Alkutekstit II" (Psi). The massive ship thunders over the horizon
// picture (same view the intro scroll ended on) and away toward the horizon.
// VISU/C/U2A.C: waits for order>10,row>46; one animation step per retrace.
import { FPS } from '../demo.js';
import { VisuScene } from '../gfx/visu.js';
import { Horizon } from './horizon.js';
import { Moon } from './moon_remix.js';

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

  // remix: the ship over the moonscape, lit by the same low sun
  renderRemix(R, t, post) {
    const gl = R.gl;
    if (!this.moon) this.moon = Moon.get(R);
    post.begin({ samples: 4 });
    this.moon.draw(R, { time: t });
    const f = (t - this.animStart - this.lag) * FPS;
    if (f >= 0 && f < this.scene.frameCount) {
      R.scissorVGA(0, 25, 320, 150);
      this.scene.draw(f, { prog: this.scene.remixProg, setup: (p) => moonShipLight(p) });
      gl.disable(gl.SCISSOR_TEST);
    }
    post.end(t, { exposure: 1.0, bloom: 0.08, grain: 0.025, vignette: 0.3 });
    return true;
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

// ship lighting under the moonscape's sun (camera space: y down)
export function moonShipLight(p, pt = [0, 0, 0], ptC = [0, 0, 0]) {
  const L = [-0.78, -0.36, 0.55], n = Math.hypot(...L);
  p.f('uKey', L[0] / n, L[1] / n, L[2] / n).f('uKeyC', 3.2, 3.1, 3.5)
    .f('uSkyC', 0.03, 0.025, 0.06).f('uGndC', 0.13, 0.13, 0.17)
    .f('uFogC', 0.03, 0.012, 0.045).f('uFogD', 1 / 2.5e6)
    .f('uPt', ...pt).f('uPtC', ...ptC).f('uRough', 0.38).f('uMetal', 0.6).f('uLights', 1.4).f('uThrust', 0, 0, 0)
    .m3('uCamInv', new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])).f('uCamW', 0, 0, 0).f('uShadowOn', 0).f('uUp', 0, -1, 0).f('uCity', 0);
}
