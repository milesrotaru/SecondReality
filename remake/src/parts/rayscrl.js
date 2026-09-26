// RAYSCRL (Trug) - a raytraced water scene; a strip of fire and a sword
// scrolls "through" it, seen via reflections and refraction.
// WATER/DEMO.PAS + ROUTINES.ASM: WAT1..3.DAT list, for every texel of a
// 158x34 scroll buffer, the screen pixels it lands on (three interleaved
// pixel groups, one drawn per frame; the buffer shifts every third frame).
// A non-zero texel replaces the background pixel.
// HD: the tables are inverted offline into a per-pixel buffer coordinate, so
// the strip is resampled with continuous scrolling and clean edges.
import { FPS } from '../demo.js';
import { GLSL_BICUBIC } from '../gfx/common.js';
import { palToRGBA } from '../gfx/gl.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uBg, uUv, uFont;
uniform float uN;       // scroll events so far (continuous)
uniform vec2 uFade;     // (fade-in steps, fade-out steps) in 6-bit units
${GLSL_BICUBIC}
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 c = clamp(texBicubic(uBg, uv).rgb, 0.0, 1.0);
  vec4 s = texture(uUv, uv);
  if (s.z > 0.02) {
    vec2 b = s.xy / s.z;                         // buffer column/row
    float fx = min(b.x + uN - 159.0, 390.0);     // strip column (scp caps at 390)
    if (fx > -0.5) {
      vec4 f = texture(uFont, vec2((fx + 0.5) / 400.0, (b.y + 0.5) / 34.0));
      float w = max(fwidth(f.a), 1e-3);
      float a = smoothstep(0.5 - w, 0.5 + w, f.a) * clamp((s.z - 0.25) * 2.0, 0.0, 1.0);
      c = mix(c, f.rgb / max(f.a, 1e-3), a);
    }
  }
  // DEMO.PAS fades with 'for pf := 0 to 3': the 4th channel is the next
  // colour's red, so red moves twice as fast both ways
  c = min(c * 63.0, vec3(2.0, 1.0, 1.0) * uFade.x);
  c = max(c - vec3(2.0, 1.0, 1.0) * uFade.y, 0.0) / 63.0;
  o = vec4(c, 1.0);
}`;

export default {
  name: 'Rayscrl',
  credit: 'Trug',

  init(R, A) {
    const gl = R.gl;
    const bg = A.pic('ray.bg');
    this.bgTex = R.texture(320, 200, { data: palToRGBA(bg.pix, bg.pal), filter: gl.LINEAR });
    // strip: premultiplied RGBA, alpha = non-zero texel
    const fm = A.meta('ray.font'), fi = A.bytes('ray.font');
    const rgba = palToRGBA(fi, bg.pal);
    for (let i = 0; i < fi.length; i++) {
      const a = fi[i] ? 1 : 0;
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] *= a;
      rgba[i * 4 + 3] = a * 255;
    }
    this.fontTex = R.texture(fm.w, fm.h, { data: rgba, filter: gl.LINEAR });
    const lin = !!gl.getExtension('OES_texture_float_linear');
    this.uvTex = R.texture(320, 200, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, data: A.f32('ray.uv'), filter: lin ? gl.LINEAR : gl.NEAREST });
    this.prog = R.fsProgram(FS);
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    // wait musplus >= 0 (remember the order), fade in over 127 frames
    this.tIn = P.until(t0 + F(3), (p) => p.musplus >= 0) + F(1);
    const co = P.pos(this.tIn).ord;
    // wait for the next order, row >= 16; then scroll until musplus == -11
    this.tMain = P.until(this.tIn + F(127), (p) => p.ord !== co && p.row >= 16);
    this.tF = P.until(this.tMain + F(2), (p) => p.musplus === -11);
    return this.tF + F(65);
  },

  render(R, t) {
    const F = (x) => x * FPS;
    const fin = Math.max(0, Math.min(63, F(t - this.tIn) / 2));
    const fout = t >= this.tF ? Math.min(64, F(t - this.tF)) : 0;
    const n = t >= this.tMain ? (F(t - this.tMain) + 1) / 3 : 0;
    this.prog.use().tex('uBg', this.bgTex).tex('uUv', this.uvTex).tex('uFont', this.fontTex)
      .f('uN', n).f('uFade', fin, fout);
    R.drawFullscreen();
  },
};
