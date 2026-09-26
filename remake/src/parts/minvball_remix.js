// MINVBALL, remixed: the 512 simulated balls as glossy spheres (ray-traced
// impostors, one quad each) standing on a polished floor that mirrors them,
// with soft contact shadows that widen and fade with height. The floor gets
// a faint grid fixed in the world, so the scene's yaw reads on the ground too.
//
// Camera space comes straight from the original projection:
//   cz = bp, cx = (sx-160)*bp/288, cy = (sy-100)*bp/257
// (isotropic: x and z are scaled by rc/65536 = 0.249, y by 64/257 = 0.249).

export const FLOOR_Y = 2073;      // bounce line y=8105 in camera units + ball radius
export const BALL_R = 64;

// clip position for a camera-space point (depth unused: passes are ordered)
const PROJ = `
vec4 proj(vec3 c){ return vec4(1.8 * c.x, -2.57 * c.y, 0.0, c.z); }`;

export const BALL_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aBall;   // camera-space centre, radius
layout(location=2) in float aMirror;
uniform float uFloor;
out vec2 vS;          // VGA coordinates
flat out vec4 vBall;
void main(){
  vec3 c = aBall.xyz;
  if (aMirror > 0.5) c.y = 2.0 * uFloor - c.y;
  vBall = vec4(c, aBall.w);
  float zc = max(c.z - aBall.w, 10.0);
  vec2 s = vec2(160.0 + 288.0 * c.x / c.z, 100.0 + 257.0 * c.y / c.z);
  vec2 rad = vec2(288.0, 257.0) * aBall.w / zc * 1.15 + 1.5;
  vS = s + aCorner * rad;
  gl_Position = vec4(vS.x / 160.0 - 1.0, 1.0 - vS.y / 100.0, 0.0, 1.0);
}`;

const COMMON = `
const vec3 LDIR = normalize(vec3(-0.5, -1.0, 0.45));  // towards the key light (y down)
uniform float uFloor;
uniform vec2 uRot;      // yaw (sin, cos), for the world grid
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// what a reflected ray sees: dark studio above, the lit floor below
vec3 sky(vec3 d){
  float up = -d.y;
  vec3 c = vec3(0.004, 0.008, 0.012) + vec3(0.01, 0.03, 0.04) * smoothstep(-0.05, 0.5, up);
  vec2 q = d.xz / max(up, 1e-3);
  if (up > 0.0) c += vec3(2.2, 2.6, 2.8) * smoothstep(0.55, 0.35, length((q - vec2(-0.5, 0.45)) * vec2(1.0, 1.6)));
  return c;
}
vec3 floorAlbedo(vec3 p){
  // world position (undo the yaw) for the grid
  vec2 w = vec2(p.x * uRot.y - (p.z - 9000.0) * uRot.x, p.x * uRot.x + (p.z - 9000.0) * uRot.y);
  vec2 g = abs(fract(w / 900.0 + 0.5) - 0.5) * 900.0;
  float fw = max(fwidth(w.x), fwidth(w.y)) + 1e-3;
  float line = 1.0 - smoothstep(0.0, fw + 3.0, min(g.x, g.y));
  float fade = exp(-length(w) / 9000.0);
  vec3 base = vec3(0.028, 0.032, 0.038);
  return base + vec3(0.006, 0.035, 0.042) * line * fade;
}
vec3 floorLight(vec3 p){
  // a broad pool of light centred on the drop zone
  vec2 w = vec2(p.x, p.z - 9000.0);
  return vec3(0.9, 1.0, 1.1) * (0.35 + 2.4 * exp(-dot(w, w) / (5200.0 * 5200.0)));
}
vec3 floorSeen(vec3 d){
  if (d.y <= 1e-4) return sky(d);
  return floorAlbedo(d * (uFloor / d.y)) * floorLight(d * (uFloor / d.y));
}
`;

export const BALL_FS = `#version 300 es
precision highp float;
in vec2 vS;
flat in vec4 vBall;
out vec4 o;
uniform float uMirror;
${COMMON}
void main(){
  vec3 d = vec3((vS.x - 160.0) / 288.0, (vS.y - 100.0) / 257.0, 1.0);
  vec3 C = vBall.xyz; float r = vBall.w;
  float dd = dot(d, d), b = dot(d, C), c = dot(C, C) - r * r;
  // coverage from the ray's miss distance, in pixels
  float perp = sqrt(max(dot(C, C) - b * b / dd, 0.0));
  float edge = perp - r;
  float aa = fwidth(edge) + 1e-4;
  float cov = clamp(0.5 - edge / aa, 0.0, 1.0);
  if (cov <= 0.0) discard;
  float disc = max(b * b - dd * c, 0.0);
  float t = (b - sqrt(disc)) / dd;
  vec3 p = d * t;
  vec3 n = normalize(p - C);
  vec3 v = -normalize(d);
  if (uMirror > 0.5) {   // shade the real ball at the mirrored point
    n.y = -n.y; v.y = -v.y; p.y = 2.0 * uFloor - p.y;
  }
  // glossy cyan enamel, dimmer with distance as in the original palette
  vec3 alb = pow(vec3(16.0, 55.0, 60.0) / 63.0, vec3(2.2)) * 0.55;
  float fog = mix(1.0, 0.35, smoothstep(6000.0, 14000.0, p.z));
  float ndl = max(dot(n, LDIR), 0.0);
  float ao = 0.55 + 0.45 * smoothstep(-0.2, 0.9, -n.y);            // floor bounce misses the underside
  vec3 col = alb * (ndl * 1.9 + 0.08 * ao);
  // bounce light from the floor
  col += alb * vec3(0.05, 0.12, 0.13) * max(n.y, 0.0);
  vec3 h = normalize(LDIR + v);
  col += vec3(1.0) * pow(max(dot(n, h), 0.0), 180.0) * 5.0;
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 rr = reflect(-v, n);
  col += F * (rr.y > 0.0 ? floorSeen(rr) : sky(rr)) * 1.2;
  col *= fog;
  o = vec4(col * cov, cov);
}`;

export const SHADOW_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aBall;
uniform float uFloor;
out vec2 vQ;
out float vK;
${PROJ}
void main(){
  float h = max(uFloor - aBall.y - aBall.w, 0.0);   // height of the ball's bottom
  float s = aBall.w * (1.25 + h / 700.0);
  vK = 0.9 * exp(-h / 1600.0);
  vQ = aCorner;
  // light slightly from the side: shadows lean away from it
  vec3 c = vec3(aBall.x + h * 0.25, uFloor, aBall.z - h * 0.2) + vec3(aCorner.x * s, 0.0, aCorner.y * s);
  gl_Position = proj(c);
}`;

export const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vQ;
in float vK;
out vec4 o;
void main(){
  float r = length(vQ);
  float k = vK * (1.0 - smoothstep(0.2, 1.0, r));
  o = vec4(vec3(1.0 - k), 1.0);
}`;

export const FLOOR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${COMMON}
void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  vec3 d = vec3((s.x - 160.0) / 288.0, (s.y - 100.0) / 257.0, 1.0);
  if (d.y <= 1e-4) { o = vec4(sky(normalize(d)) * 0.4, 1.0); return; }
  vec3 p = d * (uFloor / d.y);
  vec3 col = floorAlbedo(p) * floorLight(p);
  // reflectance rises toward grazing; the mirrored balls are already below
  float cosv = normalize(d).y;
  float R = 0.18 + 0.6 * pow(1.0 - cosv, 5.0);
  // far floor melts into the dark
  float haze = smoothstep(9000.0, 26000.0, p.z);
  col = mix(col, vec3(0.0), haze);
  R *= 1.0 - haze;
  // the studio light in the floor's mirror (added under the mirrored balls too;
  // they cover little of it)
  vec3 m = normalize(d); m.y = -m.y;
  o = vec4(col * (1.0 - R) + sky(m) * R * 0.5, 1.0 - R);
}`;
