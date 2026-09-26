// PANICEND (Wildfire) - the "panic" end: the troll collapses like a TV being
// switched off. PANIC/SHUTDOWN.C: squash into a whitening band
// (a = 32, a*5/6 ... > 2, one frame each), a line that shrinks 3 pixels per
// side per frame, then a single dot pulsing (cos) for 60 frames, then sleep(1).
import { FPS } from '../demo.js';
import { Picture } from '../gfx/picture.js';
import { TrollScene } from './troll_remix.js';

const SQUASH_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uT;
uniform float uBand, uWhite, uLine, uDot, uBg;
uniform vec3 uLineCol;
void main(){
  vec2 p = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec3 c = vec3(uBg);
  if (uBand > 0.0) {
    float y0 = 100.0 - uBand * 0.5;
    float v = (p.y - y0) / uBand;
    if (v >= 0.0 && v <= 1.0) {
      // the whole picture squashed into the band, brightening as it collapses
      vec3 s = texture(uT, vec2(vUv.x, 1.0 - v)).rgb;
      c = mix(s, vec3(3.0), uWhite);
    }
    // soft phosphor bleed above and below the band
    float d = max(abs(p.y - 100.0) - uBand * 0.5, 0.0);
    c += vec3(0.8, 0.85, 1.0) * uWhite * uWhite * 0.6 * exp(-d * 1.2);
  }
  vec3 lc = pow(uLineCol + (1.0 - uLineCol) * 61.0 / 64.0, vec3(2.2)) * 6.0;
  if (uLine > 0.0) {
    float dx = max(abs(p.x - 160.0) - uLine, 0.0), dy = abs(p.y - 100.0);
    c += lc * exp(-dy * dy * 4.0) * exp(-dx * 0.8);
    c += lc * 0.08 * exp(-dy * 0.35) * step(dx, 0.0);
  }
  if (uDot > 0.0) {
    vec2 d = (p - vec2(160.0, 100.0)) * vec2(1.0, 1.2);
    float r = length(d);
    c += vec3(1.0, 0.97, 1.0) * uDot * (8.0 * exp(-r * r * 3.0) + 0.4 * exp(-r * 0.4));
  }
  o = vec4(c, 1.0);
}`;

export default {
  name: 'Panic',
  credit: 'Wildfire',

  init(R, A) {
    const pic = A.pic('techno.troll');
    this.A = A;
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

  // remix: the troll diorama rendered to a texture, then switched off like a
  // CRT: the picture squashes into a whitening band, a phosphor line shrinks
  // to a dot that pulses and fades, all glowing in HDR.
  renderRemix(R, t, post) {
    const gl = R.gl;
    if (!this.scene) {
      this.scene = TrollScene.get(R, this.A);
      this.sq = R.fsProgram(SQUASH_FS);
    }
    const F = (x) => x * FPS;
    post.begin({ samples: 1 });
    const W = R.vw, H = R.vh;
    if (!this.tex || this.tex.w !== W || this.tex.h !== H) this.tex = R.target(W, H, { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT });
    let band = 0, white = 0, line = 0, dot = 0, bg = 0;
    if (t < this.tSquash) {
      const first = t < this.t0 + 1 / FPS;
      band = 50; white = (first ? 3 : 20) / 64; bg = first ? 1 : 0;
    } else if (t < this.tLine) {
      const k = F(t - this.tSquash);
      const i = Math.min(this.as.length - 1, Math.floor(k));
      const a0 = this.as[i], a1 = i + 1 < this.as.length ? this.as[i + 1] : 2;
      band = a0 + (a1 - a0) * (k - i);
      white = (63 - band) / 64;
    } else if (t < this.tDot) {
      const k = F(t - this.tLine);
      line = Math.max(0, 140 - 3 * k);   // half length (VGA px)
    } else {
      const k = Math.min(59, F(t - this.tDot));
      dot = (Math.cos(k / 120 * 3 * 2 * Math.PI) * 31 + 32) / 63;
      if (t > this.tSleep) dot *= Math.max(0, 1 - (t - this.tSleep) * 3);
    }
    if (band > 0) {
      // the scene into a texture (same resolution as the HDR buffer)
      const saved = R.screen;
      R.bindTarget(this.tex);
      this.scene.draw(R, { shift: 0, time: t });
      R.bindTarget(null);
    }
    this.sq.use().tex('uT', this.tex.color).f('uBand', band).f('uWhite', white).f('uLine', line).f('uDot', dot).f('uBg', bg)
      .f('uLineCol', ...this.lineCol);
    R.drawFullscreen();
    post.end(t, { exposure: 1.0, bloom: 0.16, grain: 0.02, vignette: 0.3 });
    return true;
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
