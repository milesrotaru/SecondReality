// ENDSCRL - the greetings end scroller. ENDSCRL/MAIN.C: 640x400 16-colour,
// one new scanline every second retrace at the bottom (the screen scrolls
// by start address), text lines centred with 2-pixel glyph spacing.
// The released binary (capture) differs from the source: lines are 25
// scanlines, '[n' lines are n-scanline spacers ('[8' measures 42), the font
// has more glyphs, and the part ends when '%' is reached.
// HD: glyphs are drawn as smoothly sampled quads at sub-scanline positions.
import { FPS } from '../demo.js';
import { GLSL_NOISE, getNoise } from '../gfx/remix.js';

// remix: the greetings drift up through space; star layers and a faint
// nebula scroll with them at smaller speeds (parallax), the text glows.
const SPACE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uScroll, uTime, uFade;
${GLSL_NOISE}
void main(){
  vec2 p = vec2(vUv.x * 640.0, (1.0 - vUv.y) * 400.0);
  vec3 c = vec3(0.0);
  // nebula at 8% of the scroll speed
  vec2 q = (p + vec2(0.0, uScroll * 0.08)) / 260.0;
  float n = fbm2(q + vec2(uTime * 0.004, 0.0), 6);
  float m = fbm2(q * 1.7 + 5.0, 5);
  c += mix(vec3(0.05, 0.02, 0.12), vec3(0.01, 0.06, 0.1), m) * smoothstep(0.5, 0.9, n) * 0.7;
  c += vec3(0.07, 0.02, 0.06) * smoothstep(0.62, 0.9, n * m * 1.8);
  // three star layers at 15%, 35%, 60%
  for (int k = 0; k < 3; k++) {
    float sp = k == 0 ? 0.15 : (k == 1 ? 0.35 : 0.6);
    float sc = k == 0 ? 3.0 : (k == 1 ? 5.0 : 9.0);
    vec2 g = (p + vec2(0.0, uScroll * sp)) / sc;
    vec2 ci = floor(g), f = fract(g);
    vec2 h = hash22(ci + float(k) * 17.0);
    if (h.x < 0.012 - float(k) * 0.003) {
      vec2 sp2 = 0.2 + 0.6 * hash22(ci + 3.0);
      float d = length(f - sp2) * sc;
      float mag = (0.3 + pow(hash12(ci + 9.0), 5.0) * 3.0) * (1.0 + float(k));
      c += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), h.y) * mag * exp(-d * d * 0.8) * (0.8 + 0.2 * sin(uTime * 3.0 + h.y * 40.0));
    }
  }
  o = vec4(c * uFade, 1.0);
}`;
const GLOW_FS = `#version 300 es
precision highp float;
in vec2 vT;
out vec4 o;
uniform sampler2D uFont;
void main(){ float v = texture(uFont, vT).r; o = vec4(vec3(0.95, 0.92, 1.1) * v * 1.6, 1.0); }`;

const LINE = 25;

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aRect;  // x, y, w (640x400 px), atlas x
out vec2 vT;
uniform float uScroll;             // scanlines scrolled
uniform vec2 uAtlas;
void main(){
  vec2 k = aCorner * 0.5 + 0.5;
  vec2 p = vec2(aRect.x + k.x * aRect.z, aRect.y - uScroll + k.y * 25.0);
  vT = vec2(aRect.w + k.x * aRect.z, k.y * 25.0) / uAtlas;
  gl_Position = vec4(p.x / 320.0 - 1.0, 1.0 - p.y / 200.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vT;
out vec4 o;
uniform sampler2D uFont;
void main(){ float v = texture(uFont, vT).r; o = vec4(vec3(v), 1.0); }`;

export default {
  name: 'EndScroll',
  credit: 'Future Crew',

  init(R, A) {
    const gl = R.gl;
    const fm = A.meta('endscrl.font');
    this.font = R.texture(fm.w, fm.h, { internal: gl.R8, format: gl.RED, data: A.bytes('endscrl.font'), filter: gl.LINEAR });
    this.atlas = [fm.w, fm.h];
    const glyphs = A.json('endscrl.glyphs');
    const text = Array.from(A.bytes('endscrl.text'), (b) => String.fromCharCode(b)).join('').split('\n'); // raw bytes (0x84 = a-umlaut glyph)
    // lay out every glyph once: y = scanline of the line top
    const rects = [];
    let s = 0;
    this.endLine = 0;
    for (const raw of text) {
      if (raw.startsWith('%')) { this.endLine = s; break; }
      const m = raw.match(/^\[(\d+)/);
      if (m) { const n = +m[1]; s += n >= 10 ? n : 42; continue; }
      let w = 0;
      for (const ch of raw) w += (ch === ' ' ? 16 : (glyphs[ch] ? glyphs[ch][1] : 0)) + 2;
      let x = Math.trunc((639 - w) / 2);
      for (const ch of raw) {
        const g = ch === ' ' ? null : glyphs[ch];
        const cw = ch === ' ' ? 16 : (g ? g[1] : 0);
        if (g) rects.push(x, s, cw, g[0]);
        x += cw + 2;
      }
      s += LINE;
    }
    this.count = rects.length / 4;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.buffer(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1])));
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.buffer(new Float32Array(rects)));
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    this.prog = R.program(VS, FS);
    this.glow = R.program(VS, GLOW_FS);
    this.space = R.fsProgram(SPACE_FS);
    this.noise = getNoise(R);
  },

  plan(P, t0) {
    this.t0 = t0;
    // scanline n reaches the bottom row at t0 + 2*(n - 4)/FPS (capture fit)
    return t0 + 2 * (this.endLine - 4) / FPS;
  },

  renderRemix(R, t, post) {
    const gl = R.gl;
    const bottom = (t - this.t0) * FPS / 2 + 2;
    post.begin({ samples: 4 });
    this.space.use().tex('uNoise', this.noise).f('uScroll', bottom).f('uTime', t).f('uFade', Math.min(1, (t - this.t0) / 3));
    R.drawFullscreen();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.glow.use().tex('uFont', this.font).f('uScroll', bottom - 400).f('uAtlas', ...this.atlas);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    post.end(t, { exposure: 1.0, bloom: 0.1, grain: 0.02, vignette: 0.35 });
    return true;
  },

  render(R, t) {
    const gl = R.gl;
    const bottom = (t - this.t0) * FPS / 2 + 2; // content scanline at the bottom row
    this.prog.use().tex('uFont', this.font).f('uScroll', bottom - 400).f('uAtlas', ...this.atlas);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  },
};
