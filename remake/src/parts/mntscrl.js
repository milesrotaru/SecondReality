// MNTSCRL - "Vuori-Scrolli" (Trug). Branches over a blue moonlit hillside;
// the text "another way to scroll" slides along the terrain.
// FOREST/READ2.PAS: bg picture + font strip; POS1..3.DAT map every font
// texel to screen pixels (three interleaved pixel groups, one per frame);
// pixel = background index + font value (text palette at 128+).
// HD: the tables are inverted offline into a per-pixel surface coordinate,
// so the scrolling font is resampled smoothly at any resolution.
import { FPS } from '../demo.js';
import { GLSL_BICUBIC } from '../gfx/common.js';
import { palToRGBA } from '../gfx/gl.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uBg, uIdx, uUv, uFont, uCov, uPal;
uniform float uScroll;     // font-space offset (m/3 - 104)
uniform float uText;       // text drawn at all
uniform vec3 uFade;        // (other colours level, hill/text level, fadeout) in 6-bit units
${GLSL_BICUBIC}
vec3 pal(float i){
  float a = floor(i);
  vec3 c0 = texelFetch(uPal, ivec2(int(clamp(a, 0.0, 255.0)), 0), 0).rgb;
  vec3 c1 = texelFetch(uPal, ivec2(int(clamp(a + 1.0, 0.0, 255.0)), 0), 0).rgb;
  return mix(c0, c1, i - a);
}
vec3 lim(vec3 c, float lv){ return min(c * 63.0, vec3(lv)) / 63.0; }
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 base = clamp(texBicubic(uBg, uv).rgb, 0.0, 1.0);
  vec2 ip = uv * vec2(320.0, 200.0) - 0.5;
  // hill mask (indices < 32) and hill index, bilinear
  vec2 f = fract(ip); ivec2 i0 = ivec2(floor(ip));
  float m = 0.0, bi = 0.0, bw = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 q = clamp(i0 + ivec2(k & 1, k >> 1), ivec2(0), ivec2(319, 199));
    float w = ((k & 1) == 1 ? f.x : 1.0 - f.x) * ((k >> 1) == 1 ? f.y : 1.0 - f.y);
    float idx = texelFetch(uIdx, q, 0).r * 255.0;
    float h = idx < 31.5 ? 1.0 : 0.0;
    m += h * w; bi += idx * h * w; bw += h * w;
  }
  bi = bw > 0.0 ? bi / bw : 1.0;
  vec3 c = base;
  if (uText > 0.5) {
    vec4 s = texture(uUv, uv);
    if (s.z > 0.02) {
      float su = s.x / s.z, sv = s.y / s.z;
      float fx = su + uScroll;
      vec2 ft = vec2((fx + 0.5) / 640.0, (sv + 0.5) / 31.0);
      float cov = (fx < 0.0 || fx > 639.0) ? 0.0 : texture(uCov, ft).r;
      float F = texture(uFont, ft).r * 255.0 / max(cov, 0.02);
      // crisp letter edges: iso-line of the bilinear coverage field
      float w = max(fwidth(cov), 1e-3);
      float a = smoothstep(0.5 - w, 0.5 + w, cov) * clamp(s.z * 1.5, 0.0, 1.0) * m;
      vec3 tc = pal(128.0 + bi + clamp(F, 1.0, 7.0));
      c = mix(c, tc, a);
    }
  }
  // palette fades: hill/text colours and the rest step separately
  vec3 other = lim(c, uFade.x), hill = lim(c, uFade.y);
  c = mix(other, hill, m);
  c = max(c * 63.0 - uFade.z, 0.0) / 63.0;
  o = vec4(c, 1.0);
}`;

export default {
  name: 'Mountain',
  credit: 'Trug',

  init(R, A) {
    const gl = R.gl;
    const bg = A.pic('mnt.bg');
    this.bgTex = R.texture(320, 200, { data: palToRGBA(bg.pix, bg.pal), filter: gl.LINEAR });
    this.idxTex = R.texture(320, 200, { internal: gl.R8, format: gl.RED, data: bg.pix, filter: gl.NEAREST });
    const pd = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { for (let k = 0; k < 3; k++) pd[i * 4 + k] = Math.round(bg.pal[i * 3 + k] * 255 / 63); pd[i * 4 + 3] = 255; }
    this.palTex = R.texture(256, 1, { data: pd, filter: gl.NEAREST });
    const fm = A.meta('mnt.font');
    const fdat = A.bytes('mnt.font');
    this.fontTex = R.texture(fm.w, fm.h, { internal: gl.R8, format: gl.RED, data: fdat, filter: gl.LINEAR });
    this.covTex = R.texture(fm.w, fm.h, { internal: gl.R8, format: gl.RED, data: fdat.map((v) => (v ? 255 : 0)), filter: gl.LINEAR });
    const uv = A.f32('mnt.uv');
    const lin = !!gl.getExtension('OES_texture_float_linear');
    this.uvTex = R.texture(320, 200, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, data: uv, filter: lin ? gl.LINEAR : gl.NEAREST });
    this.prog = R.fsProgram(FS);
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    this.t0 = t0 + F(1);
    this.tWait = this.t0 + F(64);
    this.tB = P.until(this.tWait, (p) => p.musplus >= 0);
    this.tF = P.until(this.tB + F(127), (p) => p.musplus === -11);
    return this.tF + F(65);
  },

  render(R, t) {
    const F = (x) => x * FPS;
    let other = 63, hill = 63, out = 0, text = 0, m = 0;
    if (t < this.tWait) {
      other = Math.max(0, F(t - this.t0)); hill = 0;
    } else if (t < this.tB) {
      hill = 0;
    } else {
      m = F(t - this.tB);
      text = 1;
      hill = Math.min(63, Math.max(0, (m - 1) / 2));
      if (t >= this.tF) out = Math.min(64, F(t - this.tF));
    }
    this.prog.use().tex('uBg', this.bgTex).tex('uIdx', this.idxTex).tex('uUv', this.uvTex).tex('uFont', this.fontTex).tex('uCov', this.covTex).tex('uPal', this.palTex)
      .f('uScroll', m / 3 - 104).f('uText', text).f('uFade', other, hill, out);
    R.drawFullscreen();
  },
};
