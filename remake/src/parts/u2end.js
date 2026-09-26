// The end: U2.ASM fades the music out (volume -1 per retrace) and leaves
// the U2END.BIN text screen on the console. The screen is taken from the
// capture (VGA text mode), shown with crisp upscaling.
import { FPS } from '../demo.js';
import { Picture } from '../gfx/picture.js';

// remix: the text screen on a CRT in a dark room. A curved glass face with
// an aperture grille and scanlines, phosphor glow bleeding into the bezel,
// a faint reflection of the room, the camera easing back from the glass.
const CRT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScr;
uniform float uK;        // 0..1 pull-back
uniform float uOn;       // power-on brightness
uniform float uTime;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
vec3 screen(vec2 uv){
  // barrel distortion of the tube face
  vec2 c = uv * 2.0 - 1.0;
  c *= 1.0 + 0.045 * dot(c, c);
  vec2 q = c * 0.5 + 0.5;
  if (any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)))) return vec3(0.0);
  vec2 ts = vec2(textureSize(uScr, 0));
  // soft beam: sample with a small vertical blur, scanlines, aperture grille
  vec3 a = texture(uScr, vec2(q.x, 1.0 - q.y)).rgb;
  vec3 b = texture(uScr, vec2(q.x, 1.0 - q.y + 0.6 / ts.y)).rgb;
  vec3 col = pow(mix(a, b, 0.3), vec3(2.2));
  float line = q.y * 400.0;
  float scan = 0.55 + 0.45 * pow(sin(line * 3.14159), 2.0);
  float px = q.x * 640.0 * 3.0;
  vec3 mask = vec3(0.7) + 0.3 * vec3(step(fract(px / 3.0), 0.333), step(0.333, fract(px / 3.0)) * step(fract(px / 3.0), 0.667), step(0.667, fract(px / 3.0)));
  float edge = smoothstep(0.0, 0.03, q.x) * smoothstep(1.0, 0.97, q.x) * smoothstep(0.0, 0.03, q.y) * smoothstep(1.0, 0.97, q.y);
  return col * scan * mask * 2.4 * edge;
}
void main(){
  vec2 p = (vUv - 0.5) * vec2(4.0 / 3.0, 1.0);
  // camera eases back: the tube fills the view, then sits in its bezel
  float z = mix(0.84, 1.28, uK);
  vec2 s = p * z;
  vec2 half_ = vec2(0.64, 0.48);
  float dScr = rbox(s, half_, 0.06);
  float dBez = rbox(s, half_ + vec2(0.13, 0.12), 0.1);
  vec3 col = vec3(0.004, 0.004, 0.006);
  // room: a desk edge below, catching the screen's light
  float glow = 0.0;
  vec3 scrAvg = vec3(0.05, 0.12, 0.2) * uOn;
  if (dBez < 0.0) {
    // plastic bezel lit by the screen, darker outward
    float k = exp(-max(dScr, 0.0) * 18.0);
    col = vec3(0.03, 0.03, 0.035) + scrAvg * 0.6 * k;
    col *= 0.8 + 0.2 * hash(floor(s * 900.0));
    // inner lip
    col += scrAvg * 0.35 * exp(-abs(dScr) * 160.0);
  } else {
    float below = smoothstep(-0.62, -0.75, s.y);
    col += vec3(0.02, 0.018, 0.016) * below + scrAvg * 0.12 * exp(-dBez * 4.0);
  }
  if (dScr < 0.0) {
    vec2 uv = s / (half_ * 2.0) + 0.5;
    vec3 c = screen(uv) * uOn;
    // glass: dark tube, a soft reflection of a window behind the viewer
    vec2 r = s - vec2(-0.25, 0.22);
    float refl = 0.012 * smoothstep(0.25, 0.0, rbox(r, vec2(0.18, 0.12), 0.05));
    float spec = 0.02 * exp(-length((s - vec2(0.3, 0.3)) * vec2(1.0, 2.0)) * 6.0);
    col = vec3(0.012, 0.014, 0.016) + c + vec3(refl + spec);
  }
  o = vec4(col, 1.0);
}`;

export default {
  name: 'End',
  credit: 'Future Crew',

  init(R, A) {
    const m = A.meta('u2end.screen');
    this.pic = new Picture(R, { w: m.w, h: m.h, pix: null, rgba: A.bytes('u2end.screen') });
    this.crt = R.fsProgram(CRT_FS);
  },

  plan(P, t0) {
    this.tShow = t0 + 64 / FPS;
    this.fades = [{ start: t0, end: t0 + 64 / FPS, from: 1, to: 0 }];
    return this.tShow + 1;
  },

  renderRemix(R, t, post) {
    post.begin({ samples: 1 });
    if (t >= this.tShow) {
      const k = Math.min(1, (t - this.tShow) / 6);
      const on = Math.min(1, (t - this.tShow) * 4);
      this.crt.use().tex('uScr', this.pic.tex).f('uK', k * k * (3 - 2 * k)).f('uOn', on).f('uTime', t);
      R.drawFullscreen();
    }
    post.end(t, { exposure: 1.0, bloom: 0.14, grain: 0.025, vignette: 0.4 });
    return true;
  },

  render(R, t) {
    if (t < this.tShow) return;
    this.pic.draw({ screen: [640, 400], dst: [0, 0, 640, 400], filter: 2 });
  },
};
