// Shared GLSL snippets and 2D helpers.

// Catmull-Rom bicubic sampling (9 taps via bilinear trick) for upscaling
// the original 320x200 artwork without blockiness.
export const GLSL_BICUBIC = `
vec4 texBicubic(sampler2D tex, vec2 uv) {
#ifdef P3
  // machine mode: art shown at an exact integer scale is copied pixel for
  // pixel (as a software blitter would); anything scaled or warped is bilinear
  vec2 tsz = vec2(textureSize(tex, 0));
  vec2 k = 1.0 / max(fwidth(uv * tsz), vec2(1e-5));
  if (all(lessThan(abs(k - floor(k + 0.5)), vec2(0.02))) && all(greaterThan(k, vec2(0.9))))
    return texelFetch(tex, clamp(ivec2(floor(uv * tsz)), ivec2(0), ivec2(tsz) - 1), 0);
  return texture(tex, uv);
#endif
  vec2 texSize = vec2(textureSize(tex, 0));
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / w12;
  vec2 texPos0 = (texPos1 - 1.0) / texSize;
  vec2 texPos3 = (texPos1 + 2.0) / texSize;
  vec2 texPos12 = (texPos1 + offset12) / texSize;
  vec4 r = vec4(0.0);
  r += texture(tex, vec2(texPos0.x, texPos0.y)) * w0.x * w0.y;
  r += texture(tex, vec2(texPos12.x, texPos0.y)) * w12.x * w0.y;
  r += texture(tex, vec2(texPos3.x, texPos0.y)) * w3.x * w0.y;
  r += texture(tex, vec2(texPos0.x, texPos12.y)) * w0.x * w12.y;
  r += texture(tex, vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
  r += texture(tex, vec2(texPos3.x, texPos12.y)) * w3.x * w12.y;
  r += texture(tex, vec2(texPos0.x, texPos3.y)) * w0.x * w3.y;
  r += texture(tex, vec2(texPos12.x, texPos3.y)) * w12.x * w3.y;
  r += texture(tex, vec2(texPos3.x, texPos3.y)) * w3.x * w3.y;
  return r;
}
// Same, with explicit derivatives (for coordinates that wrap discontinuously)
vec4 texBicubicGrad(sampler2D tex, vec2 uv, vec2 gx, vec2 gy) {
#ifdef P3
  return textureGrad(tex, uv, gx, gy);
#endif
  vec2 texSize = vec2(textureSize(tex, 0));
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / w12;
  vec2 t0 = (texPos1 - 1.0) / texSize, t3 = (texPos1 + 2.0) / texSize, t12 = (texPos1 + offset12) / texSize;
  vec4 r = vec4(0.0);
  r += textureGrad(tex, vec2(t0.x, t0.y), gx, gy) * w0.x * w0.y;
  r += textureGrad(tex, vec2(t12.x, t0.y), gx, gy) * w12.x * w0.y;
  r += textureGrad(tex, vec2(t3.x, t0.y), gx, gy) * w3.x * w0.y;
  r += textureGrad(tex, vec2(t0.x, t12.y), gx, gy) * w0.x * w12.y;
  r += textureGrad(tex, vec2(t12.x, t12.y), gx, gy) * w12.x * w12.y;
  r += textureGrad(tex, vec2(t3.x, t12.y), gx, gy) * w3.x * w12.y;
  r += textureGrad(tex, vec2(t0.x, t3.y), gx, gy) * w0.x * w3.y;
  r += textureGrad(tex, vec2(t12.x, t3.y), gx, gy) * w12.x * w3.y;
  r += textureGrad(tex, vec2(t3.x, t3.y), gx, gy) * w3.x * w3.y;
  return r;
}
// "Sharp bilinear": crisp pixel edges without shimmer when scaled by
// non-integer factors. Used where the pixel look is the point.
vec4 texSharp(sampler2D tex, vec2 uv, float sharp) {
  vec2 ts = vec2(textureSize(tex, 0));
  vec2 p = uv * ts;
  vec2 i = floor(p);
  vec2 f = p - i - 0.5;
  vec2 fw = fwidth(p);
  f = clamp(f / max(fw * sharp, vec2(1e-4)) * 0.5, -0.5, 0.5);
  return texture(tex, (i + 0.5 + f) / ts);
}
`;

export const GLSL_UTIL = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 screenBlend(vec3 a, vec3 b){ return a + b - a*b; }
`;

// Text layout helper for FC bitmap fonts: glyphs = {charCode: [x, w]}
export function layoutText(glyphs, str, spacing = 2) {
  let w = 0;
  const items = [];
  for (const ch of str) {
    const g = glyphs[ch.charCodeAt(0)] || glyphs[32];
    items.push({ x: w, src: g[0], w: g[1] });
    w += g[1] + spacing;
  }
  return { items, width: w };
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
