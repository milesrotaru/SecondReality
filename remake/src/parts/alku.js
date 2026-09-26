// ALKU - "Alkutekstit I" (Wildfire). Opening titles on black, then the
// widescreen horizon picture slowly scrolling left with credits faded on top.
// Timing follows ALKU/MAIN.C: dis_sync() points, 64-frame palette fades,
// 1 pixel of scroll every 9 frames (here: continuous sub-pixel scroll).
import { FPS } from '../demo.js';
import { GLSL_BICUBIC, layoutText, clamp01 } from '../gfx/common.js';
import { Horizon } from './horizon.js';
import { Moon, CAM_H } from './moon_remix.js';

const SCRLF = 9;

const TEXT_VS = `#version 300 es
layout(location=0) in vec4 aPos; // x,y in 320x400 space; u,v in font texels
out vec2 vT;
void main(){
  vT = aPos.zw;
  gl_Position = vec4(aPos.x / 160.0 - 1.0, 1.0 - aPos.y / 200.0, 0.0, 1.0);
}`;

const TEXT_FS = `#version 300 es
precision highp float;
in vec2 vT;
out vec4 o;
uniform sampler2D uFont;
uniform vec3 uC1, uC2, uC3;
uniform float uAlpha;
${GLSL_BICUBIC}
void main(){
  float v = texBicubic(uFont, vT / vec2(textureSize(uFont, 0))).r * 3.0;
  // firm up the 2-bit antialiasing into a crisp high-res edge
  float L = clamp((v - 0.35) * 1.35, 0.0, 3.0);
  vec3 c = L < 1.0 ? uC1 * L : (L < 2.0 ? mix(uC1, uC2, L - 1.0) : mix(uC2, uC3, L - 2.0));
  o = vec4(c * uAlpha, 1.0);
}`;

export default {
  name: 'Alku',
  credit: 'Wildfire',

  init(R, A) {
    const gl = R.gl;
    this.horizon = Horizon.get(R, A);
    this.pal = this.horizon.pal;
    const fm = A.meta('alku.font');
    const fb = A.bytes('alku.font');
    const fd = new Uint8Array(fb.length);
    for (let i = 0; i < fb.length; i++) fd[i] = fb[i] * 85;
    this.fontTex = R.texture(fm.w, fm.h, { internal: gl.R8, format: gl.RED, data: fd, filter: gl.LINEAR });
    this.glyphs = A.json('alku.glyphs');
    this.textProg = R.program(TEXT_VS, TEXT_FS);
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    // text colours: palette entries 1..3 of the (linked) picture palette
    const c = (i) => [this.pal[i * 3] / 63, this.pal[i * 3 + 1] / 63, this.pal[i * 3 + 2] / 63];
    this.c1 = c(1); this.c2 = c(2); this.c3 = c(3);
  },

  plan(P, t0) {
    const f = (n) => n / FPS;
    const ev = this.ev = {};
    // three title cards on black
    ev.t1 = P.untilSync(t0, 1);
    const card = f(64) + f(300) + f(64);
    ev.t2 = P.untilSync(ev.t1 + card, 2);
    ev.t3 = P.untilSync(ev.t2 + card, 3);
    ev.pic = P.untilSync(ev.t3 + card, 4);
    // picture fade (128 frames) with scrolling from the start
    const step = f(SCRLF);
    ev.scrollEnd = ev.pic + 319 * step;
    // credits: each waits for sync 5..8 (and an even scroll position)
    const cards = [];
    let t = ev.pic + f(128);
    for (let i = 0; i < 5; i++) {
      let s = P.untilSync(t, 5 + i);
      if (s > ev.scrollEnd) break;
      // align to an even scroll step boundary (the `a&1` wait)
      let k = Math.ceil((s - ev.pic) / step - 1e-6);
      if (k % 2 === 1) k++;
      s = ev.pic + k * step;
      const fin = s + step; // fade starts at the next scroll step
      cards.push({ idx: i, fadeIn: fin, fadeOut: fin + 31 * step });
      t = fin + 31 * step + f(64);
    }
    ev.cards = cards;
    ev.end = ev.scrollEnd + f(64);
    return ev.end;
  },

  textBlocks(which) {
    switch (which) {
      case 'fc': return [[160, 120, 'A'], [160, 160, 'Future Crew'], [160, 200, 'Production']];
      case 'asm': return [[160, 160, 'First Presented'], [160, 200, 'at Assembly 93']];
      case 'dolby': return [[160, 120, 'in'], [160, 160, '\x8f'], [160, 179, '\x99']];
      case 0: return [[160, 150, 'Graphics'], [160, 190, 'Marvel'], [160, 230, 'Pixel']];
      case 1: return [[160, 150, 'Music'], [160, 190, 'Purple Motion'], [160, 230, 'Skaven']];
      case 2: return [[160, 130, 'Code'], [160, 170, 'Psi'], [160, 210, 'Trug'], [160, 248, 'Wildfire']];
      case 3: return [[160, 150, 'Additional Design'], [160, 190, 'Abyss'], [160, 230, 'Gore']];
      default: return [];
    }
  },

  drawText(R, blocks, alpha, colors, add = false) {
    if (!blocks.length || alpha <= 0) return;
    const gl = R.gl;
    const verts = [];
    for (const [cx, y, str] of blocks) {
      const L = layoutText(this.glyphs, str, 2);
      const x0 = cx - Math.floor(L.width / 2);
      for (const g of L.items) {
        const x = x0 + g.x, u = g.src, w = g.w;
        const q = [[x, y, u, 0], [x + w, y, u + w, 0], [x + w, y + 30, u + w, 30], [x, y, u, 0], [x + w, y + 30, u + w, 30], [x, y + 30, u, 30]];
        for (const v of q) verts.push(...v);
      }
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    const p = this.textProg.use();
    p.tex('uFont', this.fontTex).f('uC1', ...colors[0]).f('uC2', ...colors[1]).f('uC3', ...colors[2]).f('uAlpha', alpha);
    gl.enable(gl.BLEND);
    // screen blend: dst + src*(1-dst); additive light in the remix's HDR
    if (add) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 4);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  },

  // ---- remix: the painting becomes the moonscape (moon_remix.js); the
  // scroll is a pan that ends on U2A's camera. Text is added as light.
  renderRemix(R, t, post) {
    const ev = this.ev;
    const f = (n) => n / FPS;
    if (!this.moon) this.moon = Moon.get(R);
    post.begin({ samples: 1 });
    // text in HDR: linear, a little over white so it blooms
    const cols = [this.c1, this.c2, this.c3].map((c) => c.map((v) => Math.pow(v, 2.2) * 2.2));
    const card = (ts, name) => {
      const lt = t - ts;
      if (lt < 0 || lt > f(428)) return;
      let a = 1;
      if (lt < f(64)) a = lt / f(64);
      else if (lt > f(364)) a = 1 - (lt - f(364)) / f(64);
      this.drawText(R, this.textBlocks(name), clamp01(a), cols, true);
    };
    if (t < ev.pic) {
      card(ev.t1, 'fc');
      card(ev.t2, 'asm');
      card(ev.t3, 'dolby');
    } else {
      const scroll = Math.min(319, (t - ev.pic) * FPS / SCRLF);
      const k = 1 - scroll / 319, ke = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
      this.moon.draw(R, { yaw: -0.74 * ke, cam: [-9000 * ke, CAM_H + 250 * ke, -3000 * ke], fade: clamp01((t - ev.pic) / f(128)), time: t });
      for (const c of ev.cards) {
        const lt = t - c.fadeIn;
        if (lt < 0 || t > c.fadeOut + f(64)) continue;
        let a = clamp01(lt / f(64));
        if (t > c.fadeOut) a = 1 - clamp01((t - c.fadeOut) / f(64));
        this.drawText(R, this.textBlocks(c.idx), a, cols, true);
      }
    }
    post.end(t, { exposure: 1.0, bloom: 0.09, grain: 0.025, vignette: 0.3 });
    return true;
  },

  render(R, t) {
    const gl = R.gl;
    const ev = this.ev;
    const f = (n) => n / FPS;
    const cols = [this.c1, this.c2, this.c3];
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const card = (ts, name) => {
      const lt = t - ts;
      if (lt < 0 || lt > f(428)) return;
      let a = 1;
      if (lt < f(64)) a = lt / f(64);
      else if (lt > f(364)) a = 1 - (lt - f(364)) / f(64);
      this.drawText(R, this.textBlocks(name), clamp01(a), cols);
    };
    if (t < ev.pic) {
      card(ev.t1, 'fc');
      card(ev.t2, 'asm');
      card(ev.t3, 'dolby');
      return;
    }
    const scroll = Math.min(319, (t - ev.pic) * FPS / SCRLF);
    const fade = clamp01((t - ev.pic) / f(128));
    this.horizon.draw(R, scroll, fade);
    for (const c of ev.cards) {
      const lt = t - c.fadeIn;
      if (lt < 0 || t > c.fadeOut + f(64)) continue;
      let a = clamp01(lt / f(64));
      if (t > c.fadeOut) a = 1 - clamp01((t - c.fadeOut) / f(64));
      // text rows are offset by 100 scanlines (tbuf lives at row 100)
      this.drawText(R, this.textBlocks(c.idx), a, cols);
    }
  },
};
