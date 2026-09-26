// Remix post-processing: remixed parts draw linear HDR radiance into a
// multisampled half-float buffer (it stands in for the screen while they
// render); end() resolves it, adds a soft-threshold bloom, tonemaps (ACES
// fit), and applies vignette and a little film grain on the way to the canvas.

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uTexel;     // source texel size
uniform vec4 uThresh;    // x: threshold, y: knee, z: 1 = prefilter
vec3 pre(vec3 c){
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThresh.x + uThresh.y, 0.0, 2.0 * uThresh.y);
  soft = soft * soft / (4.0 * uThresh.y + 1e-4);
  return c * max(soft, br - uThresh.x) / max(br, 1e-4);
}
void main(){
  // 13-tap downsample (Jimenez 2014)
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUv + t * vec2(-2, -2)).rgb, b = texture(uSrc, vUv + t * vec2(0, -2)).rgb, c = texture(uSrc, vUv + t * vec2(2, -2)).rgb;
  vec3 d = texture(uSrc, vUv + t * vec2(-2, 0)).rgb, e = texture(uSrc, vUv).rgb, f = texture(uSrc, vUv + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, vUv + t * vec2(-2, 2)).rgb, h = texture(uSrc, vUv + t * vec2(0, 2)).rgb, i = texture(uSrc, vUv + t * vec2(2, 2)).rgb;
  vec3 j = texture(uSrc, vUv + t * vec2(-1, -1)).rgb, k = texture(uSrc, vUv + t * vec2(1, -1)).rgb;
  vec3 l = texture(uSrc, vUv + t * vec2(-1, 1)).rgb, m = texture(uSrc, vUv + t * vec2(1, 1)).rgb;
  vec3 s = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uThresh.z > 0.5) s = pre(s);
  o = vec4(min(s, vec3(64.0)), 1.0);
}`;

const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
void main(){
  vec2 t = uTexel * uRadius;
  vec3 s = texture(uSrc, vUv).rgb * 4.0;
  s += (texture(uSrc, vUv + vec2(-t.x, 0)).rgb + texture(uSrc, vUv + vec2(t.x, 0)).rgb + texture(uSrc, vUv + vec2(0, -t.y)).rgb + texture(uSrc, vUv + vec2(0, t.y)).rgb) * 2.0;
  s += texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(-t.x, t.y)).rgb + texture(uSrc, vUv + vec2(t.x, t.y)).rgb;
  o = vec4(s / 16.0, 1.0);
}`;

const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene, uBloom;
uniform float uExposure, uBloomAmt, uGrain, uVignette, uTime;
uniform vec3 uFade;     // fade-to colour (display space)
uniform float uFadeAmt;
vec3 aces(vec3 x){ // Narkowicz fit
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 c = texture(uScene, vUv).rgb * uExposure + texture(uBloom, vUv).rgb * uBloomAmt;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  vec2 q = vUv - 0.5;
  c *= mix(1.0, smoothstep(0.85, 0.2, length(q * vec2(1.1, 1.0))), uVignette);
  c = mix(c, uFade, uFadeAmt);
  c += (hash(gl_FragCoord.xy + fract(uTime * 13.7) * 311.0) - 0.5) * uGrain;
  o = vec4(c, 1.0);
}`;

export class Post {
  constructor(R) {
    this.R = R;
    const gl = R.gl;
    this.down = R.fsProgram(DOWN_FS);
    this.up = R.fsProgram(UP_FS);
    this.final = R.fsProgram(FINAL_FS);
    this.hf = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR };
  }

  ensure(w, h, samples) {
    const R = this.R, gl = R.gl;
    if (this.scene && this.scene.w === w && this.scene.h === h && this.samples === samples) return;
    this.samples = samples;
    this.scene = R.target(w, h, { ...this.hf, samples, depth: true, depthFormat: gl.DEPTH32F_STENCIL8 });
    this.chain = [];
    let cw = w, ch = h;
    for (let i = 0; i < 7 && cw > 8 && ch > 8; i++) {
      cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1);
      this.chain.push(R.target(cw, ch, this.hf));
    }
  }

  // Redirect the "screen" to the HDR buffer. The buffer is capped at about
  // 2.6 Mpixel (the raytraced parts cost per pixel); the composite upsamples.
  begin({ samples = 4, maxPixels = 2.6e6 } = {}) {
    const R = this.R, gl = R.gl;
    const k = Math.min(1, Math.sqrt(maxPixels / (R.vw * R.vh)));
    const w = Math.max(1, Math.round(R.vw * k)), h = Math.max(1, Math.round(R.vh * k));
    this.ensure(w, h, samples);
    this.saved = { screen: R.screen, viewport: R.viewport, vx: R.vx, vy: R.vy, vw: R.vw, vh: R.vh };
    R.screen = this.scene;
    R.viewport = { x: 0, y: 0, w, h };
    Object.assign(R, { vx: 0, vy: 0, vw: w, vh: h });
    R.bindTarget(null);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  end(t, o = {}) {
    const R = this.R, gl = R.gl, S = this.scene;
    Object.assign(R, this.saved);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.SCISSOR_TEST);
    // resolve
    if (S.msfb) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, S.msfb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, S.fb);
      gl.blitFramebuffer(0, 0, S.w, S.h, 0, 0, S.w, S.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    // bloom: downsample chain (prefiltered first level), then tent upsample-add
    let src = S;
    this.chain.forEach((dst, i) => {
      R.bindTarget(dst);
      this.down.use().tex('uSrc', src.color).f('uTexel', 1 / src.w, 1 / src.h).f('uThresh', o.threshold ?? 1.0, o.knee ?? 0.5, i === 0 ? 1 : 0, 0);
      R.drawFullscreen();
      src = dst;
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.chain.length - 1; i > 0; i--) {
      const s = this.chain[i], d = this.chain[i - 1];
      R.bindTarget(d);
      this.up.use().tex('uSrc', s.color).f('uTexel', 1 / s.w, 1 / s.h).f('uRadius', 1.0);
      R.drawFullscreen();
    }
    gl.disable(gl.BLEND);
    // composite to the canvas viewport
    R.bindTarget(null);
    const fade = o.fade || [0, 0, 0, 0];
    this.final.use().tex('uScene', S.color).tex('uBloom', this.chain[0].color)
      .f('uExposure', o.exposure ?? 1).f('uBloomAmt', o.bloom ?? 0.06).f('uGrain', o.grain ?? 0.02)
      .f('uVignette', o.vignette ?? 0.35).f('uTime', t).f('uFade', fade[0], fade[1], fade[2]).f('uFadeAmt', fade[3]);
    R.drawFullscreen();
  }
}
