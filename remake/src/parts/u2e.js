// U2E - "Vector Part II" (Psi). Flight through the city, ending on the
// Future Crew logo. VISU/C/U2E.C: the jelly picture is faded to white, a
// letterbox frame is drawn and faded in around a white window, the scene
// starts when the music reaches order 19; the stream runs at 35 fps (each
// frame shown for two retraces); '_' objects are the ground (drawn first),
// 's01' is forced on top for stream frames 900..1100; fade to white at the end.
import { FPS } from '../demo.js';
import { VisuScene } from '../gfx/visu.js';
import { Picture } from '../gfx/picture.js';
import { IceCard } from './ice_remix.js';
import { cameraMul } from '../gfx/visu.js';

// remix: the city at golden hour. Background pass: sky dome and an asphalt
// street plane under the city's ground plates (the original's black gaps).
const CITY_BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec4 uProj;
uniform mat3 uCamInv;
uniform vec3 uCamW, uSun;
uniform float uTime;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 sky(vec3 d){
  float e = d.z;
  vec3 zen = vec3(0.05, 0.12, 0.35), hor = vec3(1.1, 0.62, 0.35);
  vec3 c = mix(hor, zen, pow(clamp(e, 0.0, 1.0), 0.45));
  float sd = max(dot(d, uSun), 0.0);
  c += vec3(4.0, 2.4, 1.2) * pow(sd, 400.0) * 6.0 + vec3(0.9, 0.5, 0.25) * pow(sd, 12.0) * 0.6;
  // a few high streaks of cloud
  vec2 q = d.xy / max(e, 0.05) * 0.6;
  float cl = 0.0; float a = 0.5; vec2 pp = q + vec2(uTime * 0.01, 0.0);
  for (int i = 0; i < 4; i++) { cl += a * hash(floor(pp)); pp *= 2.1; a *= 0.5; }
  return c * mix(1.0, 0.55, smoothstep(-0.1, 0.02, -e));
}
void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec3 dc = vec3((s.x - uProj.z - 0.5) / uProj.x, (s.y - uProj.w - 0.5) / uProj.y, 1.0);
  vec3 d = normalize(uCamInv * dc);
  vec3 col = sky(d);
  // streets: z = -120 inside the city's footprint
  if (d.z < 0.0) {
    float t = (-120.0 - uCamW.z) / d.z;
    vec3 p = uCamW + d * t;
    if (p.x > -32000.0 && p.x < 48000.0 && p.y > -52000.0 && p.y < 6000.0) {
      vec3 asphalt = vec3(0.035, 0.035, 0.04) * (0.8 + 0.4 * hash(floor(p.xy / 40.0)));
      float lane = smoothstep(30.0, 0.0, abs(mod(p.x, 1500.0) - 750.0)) + smoothstep(30.0, 0.0, abs(mod(p.y, 1500.0) - 750.0));
      asphalt += vec3(0.25, 0.22, 0.12) * lane * 0.3 * step(0.5, fract((p.x + p.y) / 400.0));
      vec3 lit = asphalt * (0.35 + 1.8 * max(uSun.z, 0.0)) + vec3(0.9, 0.5, 0.3) * 0.02;
      float fog = 1.0 - exp(-t / 60000.0);
      col = mix(lit, sky(normalize(vec3(d.xy, 0.02))), fog);
    } else col = mix(vec3(0.006, 0.008, 0.02), col * 0.5, exp(d.z * 12.0));
  }
  o = vec4(col, 1.0);
}`;


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
    this.bgProg = R.fsProgram(CITY_BG_FS);
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

  // ---------------- remix ----------------
  renderRemix(R, t, post) {
    const gl = R.gl;
    const F = (x) => x * FPS;
    if (t < this.tSet) {
      // the ice card (at rest) brightening to white
      const ice = IceCard.get(R);
      const tex = ice.render(R, t);
      post.begin({ samples: 1 });
      const k = Math.min(33, Math.max(0, F(t - this.tW)));
      ice.jelly.use().tex('uPic', tex.color).f('uScroll', 0).f('uY', 0, 400).f('uXsc', 0).f('uWhite', Math.min(1, 2 * k / 63), 1, 0);
      R.drawFullscreen();
      post.end(t, { exposure: 1.0, bloom: 0.09, grain: 0.02, vignette: 0.3 });
      return true;
    }
    if (t < this.tAnim + this.lag) {
      post.begin({ samples: 1 });
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
      post.end(t, { exposure: 1.0, bloom: 0.05, grain: 0.02, vignette: 0.2 });
      return true;
    }
    const sc = this.scene;
    const f = Math.min(sc.frameCount - 1, (t - this.tAnim - this.lag) * FPS / 2);
    const cam = sc.cameraAt(f);
    const C = cam.C;
    // the sun: low in the west, warm
    const sun = (() => { const v = [-0.5, 0.38, 0.85]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
    // shadow map around where the camera looks
    if (!this.shadowT) this.shadowT = R.target(3072, 3072, { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.NEAREST, depth: true });
    const fwd = [C[6], C[7], C[8]]; // camera z axis in world = third row of C
    const ctr = [0, 1, 2].map((k) => cam.W[k] + fwd[k] * 9000);
    const lz = sun.map((v) => -v);
    const up = [0, 0, 1];
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nz = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
    const lx = nz(cr(lz, up)), ly = cr(lx, lz);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const hw = 22000, hd = 80000;
    const cx = dot(lx, ctr), cy = dot(ly, ctr), cz = dot(lz, ctr);
    const L = new Float32Array([
      lx[0] / hw, ly[0] / hw, lz[0] / hd, 0,
      lx[1] / hw, ly[1] / hw, lz[1] / hd, 0,
      lx[2] / hw, ly[2] / hw, lz[2] / hd, 0,
      -cx / hw, -cy / hw, -cz / hd, 1]);
    R.bindTarget(this.shadowT);
    gl.clearColor(1, 1, 1, 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    sc.drawShadow(f, L);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    post.begin({ samples: 4 });
    const fi = Math.max(0, Math.min(sc.frameCount - 1, Math.floor(f)));
    const [mx, my] = cameraMul(sc.frames[fi].fov, 160);
    const CT = new Float32Array([C[0], C[1], C[2], C[3], C[4], C[5], C[6], C[7], C[8]]); // column-major of C^T
    R.scissorVGA(0, 25, 320, 150);
    this.bgProg.use().f('uProj', mx, my, 159, 99).m3('uCamInv', CT).f('uCamW', ...cam.W).f('uSun', ...sun).f('uTime', t);
    R.drawFullscreen();
    const keyCam = [0, 1, 2].map((k) => C[k * 3] * sun[0] + C[k * 3 + 1] * sun[1] + C[k * 3 + 2] * sun[2]);
    sc.draw(f, {
      prog: sc.remixProg, groundFirst: true, onTop: (name, fr) => name.startsWith('s01') && fr > 900 && fr < 1100,
      setup: (p) => {
        p.f('uKey', ...keyCam).f('uKeyC', 4.2, 3.2, 2.3)
          .f('uSkyC', 0.2, 0.24, 0.36).f('uGndC', 0.22, 0.17, 0.12)
          .f('uFogC', 0.55, 0.38, 0.3).f('uFogD', 1 / 90000)
          .f('uPt', 0, 0, 0).f('uPtC', 0, 0, 0).f('uRough', 0.55).f('uMetal', 0.05).f('uLights', 0).f('uThrust', 0, 0, 0)
          .m3('uCamInv', CT).f('uCamW', ...cam.W).m4('uL', L).tex('uShadow', this.shadowT.color).f('uShadowOn', 1).f('uUp', 0, 0, 1);
      },
    });
    gl.disable(gl.SCISSOR_TEST);
    let fade = [0, 0, 0, 0];
    if (t > this.tStreamEnd) fade = [1, 1, 1, Math.min(64, 4 * F(t - this.tStreamEnd)) / 64];
    post.end(t, { exposure: 1.0, bloom: 0.07, grain: 0.02, vignette: 0.3, fade });
    return true;
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
