// Shared pieces for the remix renderers: a seeded noise texture (fast value
// noise via texture lookups) and GLSL helpers.

let noiseTex = null;

// 256x256 RGBA of random bytes; G and A copy R and B at an offset of (37,17)
// so that a single bilinear fetch yields two z-slices (iq's 3D noise trick).
export function getNoise(R) {
  if (noiseTex) return noiseTex;
  const gl = R.gl, N = 256;
  let s = 0x2545f491;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) & 255; };
  const a = new Uint8Array(N * N), b = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) { a[i] = rnd(); b[i] = rnd(); }
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, j = ((y - 17) & 255) * N + ((x - 37) & 255);
    d[i * 4] = a[i]; d[i * 4 + 1] = a[j]; d[i * 4 + 2] = b[i]; d[i * 4 + 3] = b[j];
  }
  noiseTex = R.texture(N, N, { data: d, filter: gl.LINEAR, wrap: gl.REPEAT, mipmap: false });
  return noiseTex;
}

export const GLSL_NOISE = `
uniform sampler2D uNoise;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// 2D value noise, 0..1, smooth
float vnoise(vec2 x){
  vec2 p = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (p + f + 0.5) / 256.0, 0.0).x;
}
// 2D value noise with derivatives (value in x, d/dx d/dy in yz), 0..1
vec3 vnoised(vec2 x){
  vec2 p = floor(x), f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = textureLod(uNoise, (p + vec2(0.5, 0.5)) / 256.0, 0.0).x;
  float b = textureLod(uNoise, (p + vec2(1.5, 0.5)) / 256.0, 0.0).x;
  float c = textureLod(uNoise, (p + vec2(0.5, 1.5)) / 256.0, 0.0).x;
  float d = textureLod(uNoise, (p + vec2(1.5, 1.5)) / 256.0, 0.0).x;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
              du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
}
// 3D value noise, 0..1
float vnoise3(vec3 x){
  vec3 p = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = (p.xy + vec2(37.0, 17.0) * p.z) + f.xy;
  vec2 rg = textureLod(uNoise, (uv + 0.5) / 256.0, 0.0).yx;
  return mix(rg.x, rg.y, f.z);
}
const mat2 M2 = mat2(0.80, 0.60, -0.60, 0.80);
float fbm2(vec2 p, int oct){ float a = 0.5, s = 0.0; for (int i = 0; i < 12; i++) { if (i >= oct) break; s += a * vnoise(p); p = M2 * p * 2.03; a *= 0.5; } return s; }
float fbm3(vec3 p, int oct){ float a = 0.5, s = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise3(p); p = p * 2.02 + vec3(1.7, 9.2, 5.3); a *= 0.5; } return s; }
`;

export const GLSL_COLOR = `
vec3 srgb2lin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
