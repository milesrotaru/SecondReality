// TECHNO, remixed.
//  - The ring interference becomes a glossy embossed plate seen in
//    perspective: the same two ring systems (EGA ring boundaries, centres,
//    wobble, palette rotation) give an emissive pattern and a relief; the
//    palette steps are box-filtered exactly (prefix sums), so the fine outer
//    rings stay clean at a grazing angle.
//  - The light panels are four emissive slabs that drop and tip away.
//  - The delay bars are four layers of glowing slats at four depths (they
//    are four moments in time), seen by a slowly swaying camera; overlaps
//    add up like the original's layer count.

export const RINGS_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uR1, uR2;
uniform vec2 uC1, uC2;
uniform vec3 uPal[16];
uniform float uUse2;
uniform float uWobble[200];
uniform vec3 uCam; uniform vec3 uTgt;
uniform float uTime;
float ring(sampler2D t, float r){ return texture(t, vec2(r / 512.0, 0.5)).r; }
// integral of the 8-step palette ramp (base = 0 or 8) up to ring number n
vec3 cumPal(float n, int base){
  float per = floor(n / 8.0);
  vec3 tot = vec3(0.0), pre = vec3(0.0);
  int k = int(floor(n - per * 8.0));
  for (int i = 0; i < 8; i++) { vec3 c = uPal[base + i]; tot += c; if (i < k) pre += c; }
  return per * tot + pre + (n - per * 8.0 - float(k)) * uPal[base + k];
}
vec3 boxPal(float n, float w, int base){
  w = max(w, 1e-3);
  return (cumPal(n + 0.5 * w, base) - cumPal(n - 0.5 * w, base)) / w;
}
// fraction of [n-w/2, n+w/2] where floor(n) is odd
float boxOdd(float n, float w){
  w = max(w, 1e-3);
  float a = n - 0.5 * w, b = n + 0.5 * w;
  // integral of odd indicator: floor(x/2) + max(fract(x/2)*2 - 1, 0)
  float Ia = floor(a / 2.0) + max(fract(a / 2.0) * 2.0 - 1.0, 0.0);
  float Ib = floor(b / 2.0) + max(fract(b / 2.0) * 2.0 - 1.0, 0.0);
  return (Ib - Ia) / w;
}
// pattern colour at VGA point v with footprint fw (VGA px)
vec3 pattern(vec2 v, float fw){
  float r1 = length(v - uC1);
  float n1 = ring(uR1, r1);
  float dn1 = fw * (ring(uR1, r1 + 1.0) - n1) + 0.02;
  vec3 lo = boxPal(n1, dn1, 0);
  if (uUse2 < 0.5) return lo;
  vec3 hi = boxPal(n1, dn1, 8);
  int row = int(clamp(floor(v.y), 0.0, 199.0));
  vec2 c2 = uC2 - vec2(uWobble[row], 0.0);
  float r2 = length(v - c2);
  float n2 = ring(uR2, r2);
  float dn2 = fw * (ring(uR2, r2 + 1.0) - n2) + 0.02;
  return mix(lo, hi, boxOdd(n2, dn2));
}
void main(){
  // camera looking at the plate (plate z = 0, VGA px units, y down on the plate)
  vec2 s = (vUv - 0.5) * vec2(4.0 / 3.0, 1.0);
  vec3 fw = normalize(uTgt - uCam);
  vec3 rt = normalize(cross(fw, vec3(0.0, 0.0, 1.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.25 + rt * s.x + up * s.y);
  float t = -uCam.z / rd.z;
  vec3 col = vec3(0.0);
  if (t > 0.0) {
    vec3 p = uCam + rd * t;
    vec2 v = vec2(160.0 + p.x, 100.0 + p.y / 1.2);
    float fwp = length(fwidth(v)) * 0.7;
    vec3 c = pattern(v, fwp);
    // relief from brightness: sample neighbours on the plate
    float e = max(fwp, 0.35);
    float h0 = dot(c, vec3(0.3, 0.5, 0.2));
    float hx = dot(pattern(v + vec2(e, 0.0), fwp), vec3(0.3, 0.5, 0.2));
    float hy = dot(pattern(v + vec2(0.0, e), fwp), vec3(0.3, 0.5, 0.2));
    vec3 n = normalize(vec3(-(hx - h0) / e * 3.0, -(hy - h0) / (e * 1.2) * 3.0, 1.0));
    vec3 lin = pow(c, vec3(2.2));
    vec3 v2 = -rd;
    // emissive film under a lacquer: glow + sheen of two soft lights
    vec3 L1 = normalize(vec3(-0.5, -0.8, 0.9)), L2 = normalize(vec3(0.7, 0.3, 0.6));
    float s1 = pow(max(dot(reflect(-L1, n), v2), 0.0), 60.0), s2 = pow(max(dot(reflect(-L2, n), v2), 0.0), 25.0);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, v2), 0.0), 5.0);
    col = lin * 1.15 + (vec3(0.9, 0.85, 1.0) * s1 * 1.4 + vec3(0.5, 0.4, 0.8) * s2 * 0.6) * (0.3 + F);
    col *= exp(-t / 1500.0) * smoothstep(1300.0, 700.0, length(p.xy));
  }
  o = vec4(col, 1.0);
}`;

export const PANELS_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uDrop[4];    // VGA rows each slab has dropped (0..200+)
uniform vec3 uCol;         // slab emission (linear)
uniform float uTime;
// slab b: x in [b*80, b*80+80], y in [0, 200] (VGA), thickness 10, drops and tips back
float boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, out vec3 n){
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
  if (a > b || b < 0.0) return -1.0;
  n = -sign(rd) * step(tn.yzx, tn.xyz) * step(tn.zxy, tn.xyz);
  return a;
}
void main(){
  vec2 s = vec2(vUv.x * 320.0, (1.0 - vUv.y) * 200.0);
  // camera: 900 px in front of the screen plane, rays through VGA pixels
  vec3 ro = vec3(160.0, 100.0, -900.0);
  vec3 rd = normalize(vec3(s - vec2(160.0, 100.0), 900.0));
  vec3 col = vec3(0.0);
  float best = 1e9;
  for (int b = 0; b < 4; b++) {
    float dy = uDrop[b];
    float ang = min(dy / 200.0, 1.0) * 1.1;         // tips back as it drops
    // hinge at the slab's bottom edge; rotate the ray into slab space
    vec3 hp = vec3(0.0, 200.0 + dy, 0.0);
    float c = cos(ang), sn = sin(ang);
    vec3 ro2 = ro - hp, rd2 = rd;
    ro2 = vec3(ro2.x, c * ro2.y - sn * ro2.z, sn * ro2.y + c * ro2.z);
    rd2 = vec3(rd2.x, c * rd2.y - sn * rd2.z, sn * rd2.y + c * rd2.z);
    ro2 += vec3(0.0, 200.0, 0.0);
    vec3 n;
    float x0 = float(b) * 80.0 + 1.0;
    float t = boxHit(ro2, rd2, vec3(x0, 0.0, 0.0), vec3(x0 + 78.0, 200.0, 10.0), n);
    if (t > 0.0 && t < best) {
      best = t;
      vec3 p = ro2 + rd2 * t;
      float face = step(0.5, -n.z);
      float edge = min(min(p.x - x0, x0 + 78.0 - p.x), min(p.y, 200.0 - p.y));
      vec3 e = uCol * (face > 0.5 ? (0.85 + 0.15 * smoothstep(0.0, 6.0, edge)) : 0.25);
      e += uCol * 1.5 * face * exp(-edge / 2.0);   // bright rims
      col = e * (1.0 - 0.6 * min(dy / 200.0, 1.0));
    }
  }
  o = vec4(col, 1.0);
}`;

export const BARS_VS = `#version 300 es
layout(location=0) in vec3 aPos;   // VGA x,y + layer
uniform vec2 uSway;                // camera yaw/pitch (radians)
uniform float uXoff;
out float vL;
out vec2 vV;
void main(){
  vec3 p = vec3(aPos.x + uXoff - 160.0, aPos.y - 100.0, (aPos.z - 1.5) * 85.0);
  vV = aPos.xy;
  vL = aPos.z;
  float cy = cos(uSway.x), sy = sin(uSway.x), cp = cos(uSway.y), sp = sin(uSway.y);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  p = vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);
  float z = p.z + 420.0;
  gl_Position = vec4(p.x * 420.0 / 160.0, -p.y * 420.0 / 100.0, 0.0, z);
}`;
export const BARS_FS = `#version 300 es
precision highp float;
in float vL;
in vec2 vV;
out vec4 o;
uniform vec3 uCol;
void main(){
  // older layers are dimmer and cooler
  float age = vL / 3.0;
  vec3 c = uCol * mix(vec3(1.0, 0.95, 1.05), vec3(0.55, 0.5, 0.9), age) * (1.0 - 0.45 * age);
  o = vec4(c, 1.0);
}`;
