// ENDLOGO, remixed: the two Future Crew rings as solid octagonal bands of
// blued steel with the letters engraved and chromed, raymarched, turning
// slowly under studio light; same white fade-in and black fade-out.
// Letters come from a canvas-rendered bold face turned into a distance field.
import { sdf } from '../gfx/sdf.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTxt;      // R: "CREW" sdf, G: "FUTURE" sdf (texture px)
uniform mat3 uRA, uRB;       // ring rotations (local -> world)
uniform vec3 uPA, uPB;       // ring centres
uniform float uTime;
const float RO = 1.0, RI = 0.62, H = 0.36, EN = 0.05;
const vec2 TXS = vec2(1024.0, 256.0);
float sdOct(vec2 p, float r){
  const vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
  p = abs(p);
  p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
// letters on the outer faces: returns 2D distance (world) of the text at local p
float letters(vec3 p, int which, float th0, float span){
  float th = atan(p.z, p.x);
  float d = th - th0; d = mod(d + 3.14159265, 6.2831853) - 3.14159265;
  float u = d / span + 0.5, v = 0.5 - p.y / (2.0 * H * 0.9);
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return 1.0;
  vec4 t = texture(uTxt, vec2(u, v));
  float s = which == 0 ? t.r : t.g;
  return s * (abs(span) * RO) / TXS.x;     // texture px -> world
}
float ring(vec3 p, int which, float th0, float span, out float eng){
  float d2 = max(sdOct(p.xz, RO), -(length(p.xz) - RI));
  vec2 w = vec2(d2, abs(p.y) - H);
  float d = min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.025;
  float dl = letters(p, which, th0, span);
  float de = max(dl, -(sdOct(p.xz, RO) + EN));
  float so = sdOct(p.xz, RO);
  eng = step(dl, 0.004) * step(-EN - 0.012, so) * step(so, 0.01);
  return max(d, -de);
}
float map(vec3 p, out int m, out float eng){
  float e1, e2;
  float a = ring(transpose(uRA) * (p - uPA), 0, -1.5708, 2.9, e1);
  float b = ring(transpose(uRB) * (p - uPB), 1, -1.15, 3.9, e2);
  if (a < b) { m = 0; eng = e1; return a; }
  m = 1; eng = e2; return b;
}
float mapD(vec3 p){ int m; float e; return map(p, m, e); }
vec3 normal(vec3 p){
  vec2 k = vec2(0.0015, -0.0015);
  return normalize(k.xyy * mapD(p + k.xyy) + k.yyx * mapD(p + k.yyx) + k.yxy * mapD(p + k.yxy) + k.xxx * mapD(p + k.xxx));
}
vec3 env(vec3 r){
  // dark studio with two long softboxes and a floor bounce
  vec3 c = vec3(0.01, 0.012, 0.018) + vec3(0.04, 0.05, 0.07) * smoothstep(-0.2, 0.6, r.y);
  c += vec3(2.6, 2.6, 2.8) * smoothstep(0.86, 0.97, dot(r, normalize(vec3(-0.6, 0.7, -0.4))));
  c += vec3(0.9, 1.1, 1.5) * smoothstep(0.9, 0.98, dot(r, normalize(vec3(0.8, 0.2, -0.3))));
  c += vec3(0.25, 0.2, 0.18) * smoothstep(-0.5, -0.9, r.y);
  return c;
}
float shadow(vec3 p, vec3 l){
  float s = 1.0, t = 0.02;
  for (int i = 0; i < 40; i++) { float d = mapD(p + l * t); s = min(s, 10.0 * d / t); t += clamp(d, 0.01, 0.2); if (s < 0.01 || t > 5.0) break; }
  return clamp(s, 0.0, 1.0);
}
void main(){
  vec2 uv = (vUv - 0.5) * vec2(4.0 / 3.0, 1.0);
  vec3 ro = vec3(0.25 * sin(uTime * 0.2), 0.55, -7.0);
  vec3 ta = vec3(0.15, 0.05, 0.3);
  vec3 f = normalize(ta - ro), r = normalize(cross(vec3(0.0, 1.0, 0.0), f)), u = cross(f, r);
  vec3 rd = normalize(f * 1.9 + r * uv.x + u * uv.y);
  float t = 3.0; int m; float eng; bool hit = false;
  for (int i = 0; i < 160; i++) {
    float d = map(ro + rd * t, m, eng);
    if (d < 0.0007 * t) { hit = true; break; }
    t += d * 0.9;
    if (t > 12.0) break;
  }
  vec3 col = vec3(0.0);
  if (hit) {
    vec3 p = ro + rd * t, n = normal(p), v = -rd;
    map(p, m, eng);
    vec3 L = normalize(vec3(-0.6, 0.8, -0.5));
    float sh = shadow(p + n * 0.003, L);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 R = reflect(rd, n);
    if (eng > 0.5) {
      // chrome in the engraving
      col = env(R) * vec3(0.9, 0.95, 1.0) * (0.35 + 0.65 * sh);
    } else {
      // blued steel, satin
      vec3 alb = vec3(0.035, 0.07, 0.12);
      float ndl = max(dot(n, L), 0.0);
      vec3 h = normalize(L + v);
      col = alb * (ndl * 2.4 * sh + 0.12) + vec3(0.8, 0.9, 1.1) * pow(max(dot(n, h), 0.0), 40.0) * 1.2 * sh;
      col += env(R) * mix(vec3(0.06, 0.09, 0.14), vec3(1.0), F) * 0.45;
    }
  }
  o = vec4(col, 1.0);
}`;

function textSDF(words) {
  const W = 1024, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const chans = words.map((word) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 230;
    g.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    // spread the letters over the width
    const letters = word.split('');
    const step = W / letters.length;
    g.strokeStyle = '#fff'; g.lineWidth = 16; g.lineJoin = 'round';
    letters.forEach((ch, i) => { g.fillText(ch, step * (i + 0.5), H * 0.54); g.strokeText(ch, step * (i + 0.5), H * 0.54); });
    const img = g.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = img[i * 4] > 127 ? 1 : 0;
    return sdf(mask, W, H);
  });
  const d = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4] = chans[0][i]; d[i * 4 + 1] = chans[1][i]; }
  return { W, H, d };
}

const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const mul = (A, B) => { const o = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]; return o; };
const colMajor = (M) => new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]);

export class Rings {
  constructor(R) {
    const gl = R.gl;
    const t = textSDF(['CREW', 'FUTURE']);
    this.tex = R.texture(t.W, t.H, { internal: gl.RGBA16F, format: gl.RGBA, type: gl.FLOAT, data: t.d, filter: gl.LINEAR });
    this.prog = R.fsProgram(FS);
  }
  draw(R, time) {
    // CREW lies nearly flat at lower left; FUTURE leans upright behind right
    const a = 0.08 * Math.sin(time * 0.25);
    const RA = mul(rotX(-0.22), rotY(0.2 + a));
    // FUTURE: axis tipped towards the viewer-right so the band faces up and out
    const RB = mul(mul(rotZ(-0.32), rotX(0.62)), rotY(-0.1 - a * 1.3));
    this.prog.use().tex('uTxt', this.tex).m3('uRA', colMajor(RA)).m3('uRB', colMajor(RB))
      .f('uPA', -0.55, -0.6, 0.0).f('uPB', 0.8, 0.55, 0.8).f('uTime', time);
    R.drawFullscreen();
  }
}
