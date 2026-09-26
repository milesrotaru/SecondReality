// Minimal WebGL2 toolkit shared by all parts.

export const FS_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

export class GL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: /capture=1/.test(location.search), powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.canvas = canvas;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.maxSamples = gl.getParameter(gl.MAX_SAMPLES);
    // fullscreen triangle
    this.fsVao = gl.createVertexArray();
    gl.bindVertexArray(this.fsVao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // unit quad (two triangles over -1..1)
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.programs = new Map();
    this.viewport = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  }

  shader(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
      throw new Error('Shader compile error: ' + log + '\n' + lines);
    }
    return s;
  }

  program(vs, fs) {
    if (this.machine) {
      // "P3" machine mode: shaders get #define P3 (see common.js filters)
      const inj = (src) => src.replace(/^(#version[^\n]*\n)/, '$1#define P3 1\n');
      vs = inj(vs); fs = inj(fs);
    }
    const key = vs + '\u0000' + fs;
    if (this.programs.has(key)) return this.programs.get(key);
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this.shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
    const prog = new Program(gl, p);
    this.programs.set(key, prog);
    return prog;
  }

  fsProgram(fs) { return this.program(FS_VERT, fs); }

  drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  drawFullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  texture(w, h, opts = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const ifmt = opts.internal ?? gl.RGBA8;
    const fmt = opts.format ?? gl.RGBA;
    const type = opts.type ?? gl.UNSIGNED_BYTE;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, opts.data ?? null);
    const filt = opts.filter ?? gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mipmap ? gl.LINEAR_MIPMAP_LINEAR : filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    const wrap = opts.wrap ?? gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS ?? wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrapT ?? wrap);
    if (opts.mipmap && opts.data) gl.generateMipmap(gl.TEXTURE_2D);
    if (opts.aniso) {
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(opts.aniso, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    return { tex: t, w, h };
  }

  update(tex, data, opts = {}) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tex.w, tex.h, opts.format ?? gl.RGBA, opts.type ?? gl.UNSIGNED_BYTE, data);
    if (opts.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  }

  // Render target. samples>1 creates an MSAA renderbuffer that resolves into tex.
  target(w, h, opts = {}) {
    const gl = this.gl;
    const color = this.texture(w, h, { internal: opts.internal ?? gl.RGBA8, format: opts.format ?? gl.RGBA, type: opts.type ?? gl.UNSIGNED_BYTE, filter: opts.filter ?? gl.LINEAR, wrap: opts.wrap });
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color.tex, 0);
    let depth = null;
    if (opts.depth && !(opts.samples > 1)) {
      depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      const df = opts.depthFormat ?? gl.DEPTH_COMPONENT24;
      gl.renderbufferStorage(gl.RENDERBUFFER, df, w, h);
      const att = (df === gl.DEPTH24_STENCIL8 || df === gl.DEPTH32F_STENCIL8) ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, att, gl.RENDERBUFFER, depth);
    }
    const t = { fb, color, w, h, depth, msfb: null };
    if (opts.samples > 1) {
      const s = Math.min(opts.samples, this.maxSamples);
      const msfb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, msfb);
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, s, opts.internal ?? gl.RGBA8, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      if (opts.depth) {
        const db = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, db);
        const df = opts.depthFormat ?? gl.DEPTH_COMPONENT24;
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, s, df, w, h);
        const att = (df === gl.DEPTH24_STENCIL8 || df === gl.DEPTH32F_STENCIL8) ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, att, gl.RENDERBUFFER, db);
      }
      t.msfb = msfb;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }

  bindTarget(t) {
    const gl = this.gl;
    this.cur = t || null;
    if (!t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.screen ? (this.screen.msfb || this.screen.fb) : null);
      const v = this.viewport;
      gl.viewport(v.x, v.y, v.w, v.h);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.msfb || t.fb);
    gl.viewport(0, 0, t.w, t.h);
  }

  // Shared multisampled scene target (viewport sized, with depth).
  // Machine mode: every part renders into a fixed w x h true-colour frame
  // (no multisampling, bilinear filtering), which is then scaled to the
  // screen - the output of a software renderer on a faster PC.
  setMachine(w, h) {
    this.machine = this.target(w, h, { filter: this.gl.NEAREST });
    this.screen = this.machine;
    Object.assign(this, { vw: w, vh: h, vx: 0, vy: 0 });
    this.viewport = { x: 0, y: 0, w, h };
  }

  sceneTarget(samples = 4) {
    if (this.machine) samples = 1;
    const w = this.vw, h = this.vh;
    const k = w + 'x' + h + 'x' + samples;
    if (!this._scene || this._scene.key !== k) {
      this._scene = this.target(w, h, { samples, depth: true, depthFormat: this.gl.DEPTH32F_STENCIL8 });
      this._scene.key = k;
    }
    return this._scene;
  }

  // Resolve a target and copy it into the 4:3 viewport of the canvas.
  present(t) {
    const gl = this.gl;
    if (t.msfb) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msfb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fb);
      gl.blitFramebuffer(0, 0, t.w, t.h, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.screen ? (this.screen.msfb || this.screen.fb) : null);
    const v = this.viewport;
    gl.blitFramebuffer(0, 0, t.w, t.h, v.x, v.y, v.x + v.w, v.y + v.h, gl.COLOR_BUFFER_BIT, t.w === v.w && t.h === v.h ? gl.NEAREST : gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.bindTarget(null);
  }

  // Scissor in VGA coordinates (y down) on the current target / viewport.
  scissorVGA(x, y, w, h, sw = 320, sh = 200) {
    const gl = this.gl;
    const t = this.cur;
    const tw = t ? t.w : this.vw, th = t ? t.h : this.vh;
    const ox = t ? 0 : this.vx, oy = t ? 0 : this.vy;
    const x0 = Math.round(x / sw * tw), x1 = Math.round((x + w) / sw * tw);
    const y0 = Math.round((1 - (y + h) / sh) * th), y1 = Math.round((1 - y / sh) * th);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(ox + x0, oy + y0, x1 - x0, y1 - y0);
  }

  resolve(t) {
    if (!t.msfb) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msfb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fb);
    gl.blitFramebuffer(0, 0, t.w, t.h, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  buffer(data, target) {
    const gl = this.gl;
    const b = gl.createBuffer();
    gl.bindBuffer(target ?? gl.ARRAY_BUFFER, b);
    gl.bufferData(target ?? gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }
}

export class Program {
  constructor(gl, p) {
    this.gl = gl; this.p = p; this.loc = new Map();
    this.texUnit = 0;
  }
  use() { this.gl.useProgram(this.p); this.texUnit = 0; return this; }
  u(name) {
    let l = this.loc.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(this.p, name); this.loc.set(name, l); }
    return l;
  }
  f(name, ...v) {
    const l = this.u(name); if (l === null) return this;
    const gl = this.gl;
    if (v.length === 1) gl.uniform1f(l, v[0]);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    return this;
  }
  i(name, v) { const l = this.u(name); if (l !== null) this.gl.uniform1i(l, v); return this; }
  fv(name, arr, size = 1) {
    const l = this.u(name); if (l === null) return this;
    const gl = this.gl;
    if (size === 1) gl.uniform1fv(l, arr);
    else if (size === 2) gl.uniform2fv(l, arr);
    else if (size === 3) gl.uniform3fv(l, arr);
    else gl.uniform4fv(l, arr);
    return this;
  }
  m4(name, m) { const l = this.u(name); if (l !== null) this.gl.uniformMatrix4fv(l, false, m); return this; }
  m3(name, m) { const l = this.u(name); if (l !== null) this.gl.uniformMatrix3fv(l, false, m); return this; }
  tex(name, t, unit) {
    const gl = this.gl;
    const u = unit ?? this.texUnit++;
    gl.activeTexture(gl.TEXTURE0 + u);
    gl.bindTexture(gl.TEXTURE_2D, t.tex || t);
    const l = this.u(name); if (l !== null) gl.uniform1i(l, u);
    return this;
  }
}

// VGA 6-bit palette (768 bytes, 0..63) -> Float32Array rgb 0..1
export function vgaPal(p6, n = 256) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) out[i] = (p6[i] ?? 0) / 63;
  return out;
}

// Build an RGBA8 texture from indexed pixels + 6-bit palette
export function palToRGBA(pix, pal6, alphaIndex = -1) {
  const out = new Uint8Array(pix.length * 4);
  for (let i = 0; i < pix.length; i++) {
    const c = pix[i] * 3;
    out[i * 4] = Math.round(pal6[c] * 255 / 63);
    out[i * 4 + 1] = Math.round(pal6[c + 1] * 255 / 63);
    out[i * 4 + 2] = Math.round(pal6[c + 2] * 255 / 63);
    out[i * 4 + 3] = pix[i] === alphaIndex ? 0 : 255;
  }
  return out;
}

export const mat4 = {
  identity() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
    }
    return o;
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far);
    return m;
  },
  // Projection from a "screen-space" camera: x' = cx + x*sx/z, y' = cy + y*sy/z on a WxH screen.
  // Maps to clip space with depth from z (z in [near, far]).
  screenProj(W, H, cx, cy, sx, sy, near, far, flipY = true) {
    const m = new Float32Array(16);
    // clip.x = (2*(cx*z + x*sx)/W - z)  / z -> x_ndc
    m[0] = 2 * sx / W; m[8] = 2 * cx / W - 1;
    m[5] = (flipY ? -1 : 1) * 2 * sy / H; m[9] = flipY ? 1 - 2 * cy / H : 2 * cy / H - 1;
    m[10] = (far + near) / (far - near); m[14] = -2 * far * near / (far - near);
    m[11] = 1;
    return m;
  },
};
