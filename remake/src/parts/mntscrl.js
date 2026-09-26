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
import * as MX from './mntscrl_remix.js';

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
    // READ2.PAS waits for musplus >= 0 and fades out at musplus == -11; the
    // shipped MNTSCRL.EXE (PKLITE-packed, not the released source) starts the
    // hills on row 18 and the fade on row 50 (-14), measured frame-exactly
    // against a DOSBox capture aligned by the soundtrack.
    this.tB = P.until(this.tWait, (p) => p.musplus >= 18);
    this.tF = P.until(this.tB + F(127), (p) => p.musplus === -14);
    return this.tF + F(65);
  },

  // ---------------- remix (mntscrl_remix.js) ----------------
  initRemix(R) {
    const gl = R.gl;
    const oak = MX.buildOak();
    const quad = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);
    // leaves are a 5 x 2 grid so they can cup and curl
    const grid = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
      const x0 = i / 5, x1 = (i + 1) / 5, y0 = j - 1, y1 = j;
      grid.push(x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1);
    }
    const leafQuad = new Float32Array(grid);
    const mk = (data, layout, stride, corners = quad) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const q = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, q);
      gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      let off = 0;
      layout.forEach((n, i) => { gl.enableVertexAttribArray(i + 1); gl.vertexAttribPointer(i + 1, n, gl.FLOAT, false, stride * 4, off * 4); gl.vertexAttribDivisor(i + 1, 1); off += n; });
      gl.bindVertexArray(null);
      return { vao, count: data.length / stride, verts: corners.length / 2 };
    };
    const X = this.rx = {
      hill: R.fsProgram(MX.HILL_FS),
      leafP: R.program(MX.LEAF_VS, MX.LEAF_FS),
      branchP: R.program(MX.BRANCH_VS, MX.BRANCH_FS),
      leaves: mk(oak.leaves, [3, 3, 4], 10, leafQuad),
      branches: mk(oak.branches, [4, 4], 8),
      noise: MX.getNoiseTex(R),
    };
    // light-space basis and bounds
    const L = MX.LIGHT, lz = L.map((v) => -v);
    const up = [0, -1, 0];
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nz = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
    const lx = nz(cr(up, lz)), ly = cr(lz, lx);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const pts = [];
    for (let u = -20; u <= 260; u += 20) for (let v = -10; v <= 45; v += 5) pts.push([0, 1, 2].map((k) => MX.T[k] + u * MX.R1[k] + v * MX.R2[k]));
    for (let i = 0; i < oak.branches.length; i += 4) pts.push([oak.branches[i], oak.branches[i + 1], oak.branches[i + 2]]);
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of pts) { const q = [dot(lx, p), dot(ly, p), dot(lz, p)]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); } }
    for (let k = 0; k < 3; k++) { const pad = (mx[k] - mn[k]) * 0.03 + 1; mn[k] -= pad; mx[k] += pad; }
    X.LB = new Float32Array([lx[0], ly[0], lz[0], lx[1], ly[1], lz[1], lx[2], ly[2], lz[2]]);
    X.LR = [mn[0], mn[1], 1 / (mx[0] - mn[0]), 1 / (mx[1] - mn[1])];
    X.LZ = [mn[2], 1 / (mx[2] - mn[2])];
    X.shadow = R.target(2048, 2048, { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.NEAREST, depth: true });
  },

  drawOak(R, t, shadowPass, lit) {
    const gl = R.gl, X = this.rx;
    const set = (p) => p.use().f('uTime', t).i('uShadowPass', shadowPass ? 1 : 0).f('uLit', lit)
      .m3('uLB', X.LB).f('uLR', ...X.LR).f('uLZ', ...X.LZ).tex('uShadow', X.shadow.color).tex('uNoise', X.noise);
    set(X.branchP);
    gl.bindVertexArray(X.branches.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, X.branches.count);
    set(X.leafP);
    gl.bindVertexArray(X.leaves.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, X.leaves.verts, X.leaves.count);
    gl.bindVertexArray(null);
  },

  renderRemix(R, t, post) {
    const gl = R.gl;
    if (!this.rx) this.initRemix(R);
    const X = this.rx;
    const F = (x) => x * FPS;
    let other = 63, hill = 63, out = 0, text = 0, m = 0;
    if (t < this.tWait) { other = Math.max(0, F(t - this.t0)); hill = 0; }
    else if (t < this.tB) hill = 0;
    else {
      m = F(t - this.tB); text = 1;
      hill = Math.min(63, Math.max(0, (m - 1) / 2));
      if (t >= this.tF) out = Math.min(64, F(t - this.tF));
    }
    // shadow map (the boughs sway, so every frame)
    R.bindTarget(X.shadow);
    gl.clearColor(1, 1, 1, 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    this.drawOak(R, t, true, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    post.begin({ samples: 4 });
    X.hill.use().tex('uFont', this.fontTex).tex('uCov', this.covTex).tex('uShadow', X.shadow.color).tex('uNoise', X.noise)
      .m3('uLB', X.LB).f('uLR', ...X.LR).f('uLZ', ...X.LZ)
      .f('uScroll', m / 3 - 104).f('uText', text).f('uHill', Math.pow(hill / 63, 1.6)).f('uSky', other / 63).f('uTime', t);
    R.drawFullscreen();
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    this.drawOak(R, t, false, Math.pow(other / 63, 1.6));
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.disable(gl.DEPTH_TEST);
    post.end(t, { exposure: 1.0, bloom: 0.08, grain: 0.025, vignette: 0.3, fade: [0, 0, 0, out / 64] });
    return true;
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
