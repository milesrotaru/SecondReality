// U2E - "Vector Part II" (Psi). Flight through the city, ending on the
// Future Crew logo. VISU/C/U2E.C: the jelly picture is faded to white, a
// letterbox frame is drawn and faded in around a white window, the scene
// starts when the music reaches order 19; the stream runs at 35 fps (each
// frame shown for two retraces); '_' objects are the ground (drawn first),
// 's01' is forced on top for stream frames 900..1100; fade to white at the end.
import { FPS } from '../demo.js';
import { VisuScene } from '../gfx/visu.js';
import { Picture } from '../gfx/picture.js';

const ADD_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform float uA;
void main(){ o = vec4(vec3(uA), 1.0); }`;

export default {
  name: 'U2E',
  credit: 'Psi',

  init(R, A) {
    this.scene = new VisuScene(R, A, 'u2e');
    const jp = A.pic('jp.pic');
    this.jp = new Picture(R, jp);
    this.jp254 = [0, 0, 0]; // colour 254 is black on the capture (excluded from the white fade)
    this.add = R.fsProgram(ADD_FS);
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    // measured on the capture: the white fade starts 0.09 s after the music restart
    this.tW = t0 + 0.09;
    this.tSet = this.tW + F(33 + 16);          // fadeset + double-scan switch
    this.tF2 = this.tSet + F(2 + 16);          // letterbox fade: 252 -> black, 254 -> white
    this.tMode = this.tF2 + F(33);             // vid_init(11), scene palette
    this.tAnim = P.until(this.tMode, (p) => p.ord > 18);
    this.lag = 10 / FPS;                       // copperdelay + page queue (capture: 10 retraces)
    this.tStreamEnd = this.tAnim + this.lag + this.scene.frameCount / (FPS / 2);
    return this.tStreamEnd + F(16);
  },

  rect(R, x, y, w, h, c) {
    const gl = R.gl;
    R.scissorVGA(x, y, w, h);
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
  },

  render(R, t) {
    const gl = R.gl;
    const F = (x) => x * FPS;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (t < this.tSet) {
      // jelly picture, every colour but 0 (and 254/255) +2 per frame
      const k = Math.min(33, Math.max(0, F(t - this.tW)));
      this.jp.draw({ screen: [320, 400], dst: [68, 0, 253, 400], add: Math.min(66, 2 * k) / 63 });
      return;
    }
    if (t < this.tAnim + this.lag) {
      const k = t < this.tF2 ? 0 : Math.min(33, F(t - this.tF2));
      const c252 = Math.max(0, 63 - 2 * k) / 63;
      const c254 = this.jp254.map((v) => Math.min(1, v + 2 * k / 63));
      const W = [1, 1, 1];
      const side = t >= this.tMode ? W : c254;
      const band = t >= this.tMode ? [0, 0, 0] : [c252, c252, c252];
      this.rect(R, 68, 0, 188, 25, band);
      this.rect(R, 68, 175, 188, 25, band);
      this.rect(R, 0, 25, 68, 150, side);
      this.rect(R, 253, 25, 67, 150, side);
      this.rect(R, 68, 25, 185, 150, W);
      return;
    }
    const T = R.sceneTarget();
    R.bindTarget(T);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const f = Math.min(this.scene.frameCount - 1, (t - this.tAnim - this.lag) * FPS / 2);
    R.scissorVGA(0, 25, 320, 150);
    this.scene.draw(f, { groundFirst: true, onTop: (name, fr) => name.startsWith('s01') && fr > 900 && fr < 1100 });
    gl.disable(gl.SCISSOR_TEST);
    R.present(T);
    if (t > this.tStreamEnd) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.add.use().f('uA', Math.min(64, 4 * F(t - this.tStreamEnd)) / 63);
      R.drawFullscreen();
      gl.disable(gl.BLEND);
    }
  },
};
