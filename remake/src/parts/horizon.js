// The widescreen horizon painting (Marvel) shared by ALKU, U2A and PAM:
// 640x150 of HOI.U shown 320 pixels wide on VGA rows 25..174.
import { GLSL_BICUBIC } from '../gfx/common.js';
import { palToRGBA } from '../gfx/gl.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPic;
uniform float uScroll, uFade;
uniform vec3 uTint;
${GLSL_BICUBIC}
void main(){
  float sx = vUv.x * 320.0;
  float sy = (1.0 - vUv.y) * 200.0;
  if (sy < 25.0 || sy >= 175.0) { o = vec4(0,0,0,1); return; }
  vec2 p = vec2(uScroll + sx, sy - 25.0);
  vec3 c = texBicubic(uPic, p / vec2(640.0, 200.0)).rgb;
  o = vec4(max(c, 0.0) * uFade * uTint, 1.0);
}`;

let shared = null;

export class Horizon {
  static get(R, A) {
    if (!shared) shared = new Horizon(R, A);
    return shared;
  }
  constructor(R, A) {
    const pic = A.pic('alku.hoi');
    this.pal = pic.pal;
    this.tex = R.texture(pic.w, pic.h, { data: palToRGBA(pic.pix, pic.pal), filter: R.gl.LINEAR });
    this.prog = R.fsProgram(FS);
  }
  draw(R, scroll, fade = 1, tint = [1, 1, 1]) {
    this.prog.use().tex('uPic', this.tex).f('uScroll', scroll).f('uFade', fade).f('uTint', ...tint);
    R.drawFullscreen();
  }
}
