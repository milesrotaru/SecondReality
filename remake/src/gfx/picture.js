// Palette pictures drawn in HD: palette -> RGB first, then bicubic upscaling,
// so uniform palette fades become exact RGB mixes.
import { GLSL_BICUBIC } from './common.js';
import { palToRGBA } from './gl.js';

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uDst;   // x0,y0,x1,y1 in virtual screen units (y down)
uniform vec2 uScreen; // virtual screen size
uniform vec4 uSrc;   // u0,v0,u1,v1 in texels
out vec2 vT;
void main(){
  vec2 k = aPos * 0.5 + 0.5; // 0..1
  vec2 p = mix(uDst.xy, uDst.zw, vec2(k.x, 1.0 - k.y));
  vT = mix(uSrc.xy, uSrc.zw, vec2(k.x, 1.0 - k.y));
  gl_Position = vec4(p.x / uScreen.x * 2.0 - 1.0, 1.0 - p.y / uScreen.y * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vT;
out vec4 o;
uniform sampler2D uTex;
uniform vec4 uMixCol; // rgb, amount
uniform float uBright;
uniform float uAdd;
uniform int uFilter; // 0 bicubic, 1 bilinear, 2 sharp
${GLSL_BICUBIC}
void main(){
  vec2 ts = vec2(textureSize(uTex, 0));
  vec2 uv = vT / ts;
  vec4 c = uFilter == 0 ? texBicubic(uTex, uv) : (uFilter == 2 ? texSharp(uTex, uv, 1.0) : texture(uTex, uv));
  vec3 rgb = min(mix(clamp(c.rgb, 0.0, 1.0), uMixCol.rgb, uMixCol.a) * uBright + uAdd, vec3(1.0));
  o = vec4(rgb, c.a);
}`;

export class Picture {
  constructor(R, pic, opts = {}) {
    this.R = R;
    this.w = pic.w; this.h = pic.h;
    this.pix = pic.pix; this.pal = pic.pal;
    this.tex = R.texture(pic.w, pic.h, { data: pic.rgba ?? palToRGBA(pic.pix, pic.pal, opts.alphaIndex ?? -1), filter: R.gl.LINEAR, wrap: opts.wrap });
    this.prog = R.program(VS, FS);
  }
  // dst in virtual screen coords (default 320 x h), src in texels
  draw(opts = {}) {
    const R = this.R;
    const sw = opts.screen ? opts.screen[0] : 320, sh = opts.screen ? opts.screen[1] : this.h;
    const dst = opts.dst || [0, 0, sw, sh];
    const src = opts.src || [0, 0, this.w, this.h];
    const mix = opts.mix || [0, 0, 0, 0];
    this.prog.use().tex('uTex', this.tex).f('uDst', ...dst).f('uScreen', sw, sh).f('uSrc', ...src)
      .f('uMixCol', ...mix).f('uBright', opts.bright ?? 1).f('uAdd', opts.add ?? 0).i('uFilter', opts.filter ?? 0);
    R.drawQuad();
  }
}
