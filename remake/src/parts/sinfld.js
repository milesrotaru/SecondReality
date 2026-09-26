// 3DSINFLD (Psi) - the blue voxel landscape.
// COMAN/MAIN.C + ASM.ASM + THELOOP.INC (unrolled by DOLOOP.C): terrain is
// w1[x] + w2[y] from two 32768-entry wave tables; 160 rays per frame march
// 64 single then 64 double steps over it with a skewed rotation (x and y use
// angles r and r+177), a view-space ripple (zwave) and colour = height with
// distance fade. The camera drifts along the centre ray; the landscape rises
// from the bottom at the start and sinks at the end.
// HD: per screen column, a GPU pass evaluates the terrain along the ray and
// its running maximum of (T+m)/j - the slope below which a row hits; each
// pixel binary-searches that envelope for its row slope and interpolates
// the exact crossing between steps: per-pixel silhouettes, smooth colour.
import { FPS } from '../demo.js';

const STEPS = 128; // 64 single + 64 double steps (j = 0..63, 64..190)

const COMMON = `
uniform sampler2D uW1, uW2;
float wave(sampler2D t, float i){
  i = mod(i, 32768.0);
  float a = floor(i), f = i - a;
  int k0 = int(a), k1 = (k0 + 1) & 32767;
  float v0 = texelFetch(t, ivec2(k0 & 255, k0 >> 8), 0).r;
  float v1 = texelFetch(t, ivec2(k1 & 255, k1 >> 8), 0).r;
  return mix(v0, v1, f);
}
float jOf(float k){ return k < 64.0 ? k : 64.0 + 2.0 * (k - 64.0); }
float pOf(float k){ return k < 64.0 ? k + 1.0 : jOf(k) + 2.0; }
float mOf(float j){ return j <= 64.0 ? j : (j + 64.0) * 0.5; }   // 'adc ax,-1' per seek step
`;

// pass A: terrain T(k) along the ray of each column
const TERRAIN_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uCam;          // xw, yw (byte offsets, unwrapped)
uniform vec4 uRot;          // rcos, rsin, rcos2, rsin2
uniform float uCols;
${COMMON}
void main(){
  vec2 fc = gl_FragCoord.xy - 0.5;
  float a = (fc.x + 0.5) / uCols * 160.0 - 0.5;
  float k = fc.y;
  float x = a - 80.0;
  vec2 d = vec2(x * uRot.x + 160.0 * uRot.y, 160.0 * uRot.z - x * uRot.w) / 256.0;
  float j = jOf(k), p = pOf(k);
  vec2 P = uCam + p * d;
  float T = wave(uW1, P.x * 0.5) + wave(uW2, P.y * 0.5) + 16.0 * sin(j * 6.283185307 * 3.0 / 192.0) - 240.0;
  float g = j > 0.0 ? (T + mOf(j)) / j : -1e9;
  o = vec4(g, T, 0.0, 1.0);
}`;

// pass B: running maximum of g
const ENVELOPE_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uA;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  float G = -1e9;
  for (int k = 0; k <= c.y; k++) G = max(G, texelFetch(uA, ivec2(c.x, k), 0).r);
  o = vec4(G, texelFetch(uA, c, 0).g, 0.0, 1.0);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uB, uPal;
uniform float uRise;       // startrise (rows)
${COMMON}
vec3 pal(float v){
  float i = mod(v, 256.0) * 0.5;
  float a = floor(i);
  vec3 c0 = texelFetch(uPal, ivec2(int(a), 0), 0).rgb;
  vec3 c1 = texelFetch(uPal, ivec2(min(int(a) + 1, 127), 0), 0).rgb;
  return mix(c0, c1, i - a);
}
void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * vec2(320.0, 200.0);
  float r = 209.5 + uRise - p.y;          // vbuf row from the bottom
  if (r > 139.5) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float s = -332800.0 / 65536.0 + r * (2560.0 / 65536.0);
  float u = p.x / 320.0;
  // first step whose envelope exceeds this row's slope
  if (texture(uB, vec2(u, (float(${STEPS - 1}) + 0.5) / ${STEPS}.0)).r <= s) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  int lo = 1, hi = ${STEPS - 1};
  for (int it = 0; it < 7; it++) {
    int mid = (lo + hi) >> 1;
    if (texture(uB, vec2(u, (float(mid) + 0.5) / ${STEPS}.0)).r > s) hi = mid; else lo = mid + 1;
  }
  float k = float(lo);
  float T1 = texture(uB, vec2(u, (k + 0.5) / ${STEPS}.0)).g;
  float T0 = texture(uB, vec2(u, (k - 0.5) / ${STEPS}.0)).g;
  float j1 = jOf(k), j0 = jOf(k - 1.0);
  float a0 = j0 * s - mOf(j0) - T0, a1 = j1 * s - mOf(j1) - T1;   // ray minus terrain
  float f = clamp(a0 / max(a0 - a1, 1e-6), 0.0, 1.0);
  float T = mix(T0, T1, f), j = mix(j0, j1, f);
  o = vec4(pal(T + 140.0 - j / 8.0), 1.0);
}`;

export default {
  name: '3DSinfld',
  credit: 'Psi',

  init(R, A) {
    const gl = R.gl;
    gl.getExtension('EXT_color_buffer_float');
    this.linear = !!gl.getExtension('OES_texture_float_linear');
    const up = (name) => R.texture(256, 128, { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, data: Float32Array.from(A.i16(name)), filter: gl.NEAREST });
    this.w1 = up('coman.w1');
    this.w2 = up('coman.w2');
    const s = A.i16('sin1024');
    this.sin1024 = s;
    // palette (MAIN.C)
    const pal = new Uint8Array(768);
    for (let a = 0; a < 256; a++) {
      const uc = (223 - Math.trunc(a * 22 / 26)) * 3;
      let b = Math.trunc((230 - a) / 4) + Math.trunc(s[(a * 4) & 1023] / 32);
      pal[uc + 1] = Math.max(0, Math.min(63, b));
      b = Math.trunc((255 - a) / 3);
      pal[uc + 2] = Math.min(63, b);
      b = Math.min(40, Math.abs(a - 220));
      pal[uc] = Math.trunc((40 - b) / 3);
    }
    for (let a = 0; a < 768 - 48; a++) pal[a] = Math.min(63, Math.trunc(pal[a] * 9 / 6));
    pal[0] = pal[1] = pal[2] = 0;
    const pd = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { for (let k = 0; k < 3; k++) pd[i * 4 + k] = Math.round(pal[i * 3 + k] * 255 / 63); pd[i * 4 + 3] = 255; }
    this.palTex = R.texture(256, 1, { data: pd, filter: gl.NEAREST });
    this.terrain = R.fsProgram(TERRAIN_FS);
    this.envelope = R.fsProgram(ENVELOPE_FS);
    this.draw = R.fsProgram(DRAW_FS);
    // camera path, one entry per loop iteration (exact integer math)
    const N = 4500;
    this.rot = new Float64Array(N + 2); this.xw = new Float64Array(N + 2); this.yw = new Float64Array(N + 2);
    let rot = 0, rot2 = 0, xwav = 0, ywav = 0;
    for (let n = 1; n <= N + 1; n++) {
      rot2 += 4;
      rot += Math.trunc(s[rot2 & 1023] / 15);
      const r = rot >> 3;
      this.rot[n] = rot; this.xw[n] = xwav; this.yw[n] = ywav;
      const rsin = s[r & 1023], rcos2 = s[(r + 177 + 256) & 1023];
      xwav += Math.trunc(160 * rsin / 256) * 4;
      ywav += Math.trunc(160 * rcos2 / 256) * 4;
    }
  },

  plan(P, t0) {
    const F = (n) => n / FPS;
    // doit(): dis_waitb(), then wait for musplus >= 0. The first waitb in the
    // loop returns every frame of that wait, so startrise has already
    // dropped by the wait's length on the second iteration.
    this.tW = t0 + F(2);
    this.tLoop = P.until(this.tW, (p) => p.musplus >= 0) + F(1);
    this.tSink = P.until(this.tLoop + F(400), (p) => p.musplus > -30 && p.musplus < 0);
    this.tEnd = Math.min(this.tLoop + F(4444), P.until(this.tLoop, (p) => p.musplus > -8 && p.musplus < 0));
    return this.tEnd;
  },

  targets(R) {
    const gl = R.gl;
    const cols = Math.min(2048, Math.max(160, R.vw || 1280));
    if (!this.tA || this.tA.w !== cols) {
      const o = { internal: gl.RG32F, format: gl.RG, type: gl.FLOAT, filter: gl.NEAREST };
      this.tA = R.target(cols, STEPS, o);
      this.tB = R.target(cols, STEPS, { ...o, filter: this.linear ? gl.LINEAR : gl.NEAREST });
    }
  },

  render(R, t) {
    const gl = R.gl;
    const F = (x) => x * FPS;
    const n = Math.max(1, Math.min(4500, F(t - this.tLoop) + 1));
    const i = Math.floor(n), f = n - i;
    const L = (arr) => arr[i] + (arr[i + 1] - arr[i]) * f;
    const r = L(this.rot) / 8;
    const ang = (k) => 255 * Math.sin(k * Math.PI * 2 / 1024);
    if (t < this.tLoop) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const rise = Math.max(Math.max(0, 160 - F(t - this.tW)), t > this.tSink ? Math.min(160, F(t - this.tSink)) : 0);

    this.targets(R);
    const prev = R.cur;
    gl.disable(gl.BLEND);
    R.bindTarget(this.tA);
    this.terrain.use().tex('uW1', this.w1).tex('uW2', this.w2).f('uCam', L(this.xw), L(this.yw))
      .f('uRot', ang(r + 256), ang(r), ang(r + 177 + 256), ang(r + 177)).f('uCols', this.tA.w);
    R.drawFullscreen();
    R.bindTarget(this.tB);
    this.envelope.use().tex('uA', this.tA.color);
    R.drawFullscreen();
    R.bindTarget(prev);
    this.draw.use().tex('uB', this.tB.color).tex('uPal', this.palTex).tex('uW1', this.w1).tex('uW2', this.w2).f('uRise', rise);
    R.drawFullscreen();
  },
};
