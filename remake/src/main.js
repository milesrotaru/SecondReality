// Second Reality HD - entry point.
import { GL } from './gfx/gl.js';
import { Assets, inflate } from './assets.js';
import { Music } from './audio/music.js';
import { Demo } from './demo.js';
import { PARTS } from './parts/index.js';
import { Post } from './gfx/post.js';

const qs = new URLSearchParams(location.search);
// renderer: 'p3' (640x400 true-colour software renderer, the default), 'hd',
// or 'remix' (new effects on the original choreography; HD where a part has none)
const MODE = (() => {
  const h = location.hash.slice(1);
  let saved = null;
  try { saved = localStorage.getItem('sr-mode'); } catch (e) { /* storage unavailable */ }
  const m = qs.get('mode') || (['hd', 'p3', 'remix'].includes(h) ? h : null) || saved || 'p3';
  return ['hd', 'remix'].includes(m) ? m : 'p3';
})();

// Display names for the parts (after the comments in MAIN/U2.ASM)
const TITLES = {
  Alku: 'Opening credits', U2A: 'Vector part I', PAM: 'Explosion', Title: 'Title picture', Glenz: 'Glenz vectors',
  Tunneli: 'Dot tunnel', Techno: 'Techno circles', Panic: 'Panic', Mountain: 'Hill scroller', Lens: 'Lens and rotozoomer',
  Plasma: 'Plasma and plasma cube', Minvball: 'Vector balls', Rayscrl: 'Mirror-ball scroller', '3DSinfld': 'Sine landscape',
  JPLogo: 'Jelly picture', U2E: 'Vector part II', EndLogo: 'End picture', Cred: 'Credits', EndScroll: 'Greetings',
};
const clock = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');

async function loadPack() {
  let bytes;
  if (window.SR_PACK_B64) {
    const bin = atob(window.SR_PACK_B64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new Uint8Array(await (await fetch('build/assets.pack')).arrayBuffer());
  }
  return new Assets(await inflate(bytes));
}

class App {
  constructor() {
    this.canvas = document.getElementById('c');
    this.R = new GL(this.canvas);
    // ?mode=p3: render as a 640x400 true-colour software renderer would
    if (MODE === 'p3') this.R.setMachine(640, 400); // exact 2x of the 320x200 art, 4:3 display
    if (MODE === 'remix') { this.post = new Post(this.R); this.dtN = 0; }
    this.status = document.getElementById('status');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const q = parseFloat(qs.get('scale') || '1');
    const W = Math.round(window.innerWidth * dpr * q), H = Math.round(window.innerHeight * dpr * q);
    this.canvas.width = W; this.canvas.height = H;
    // 4:3 viewport, letter/pillarboxed
    let vw = W, vh = Math.round(W * 3 / 4);
    if (vh > H) { vh = H; vw = Math.round(H * 4 / 3); }
    const vx = Math.floor((W - vw) / 2), vy = Math.floor((H - vh) / 2);
    this.out = { x: vx, y: vy, w: vw, h: vh };
    if (this.R.machine) Object.assign(this.R, { W, H });
    else {
      Object.assign(this.R, { vw, vh, vx, vy, W, H });
      this.R.viewport = { x: vx, y: vy, w: vw, h: vh };
    }
    for (const p of PARTS) if (p.resize) p.resize(this.R);
  }

  async load() {
    this.setStatus('Loading...');
    this.assets = await loadPack();
    this.music = new Music();
    this.music.load([this.assets.buffer('music0'), this.assets.buffer('music1')]);
    for (const p of PARTS) if (p.init) p.init(this.R, this.assets);
    this.demo = new Demo(this.music, PARTS);
    this.demo.build();
    for (const p of PARTS) p.demo = this.demo; // parts that show other parts (CRED)
    this.setStatus('');
    window.SR = this; // debugging / automated capture hooks
  }

  setStatus(s) { if (this.status) this.status.textContent = s; }

  async start(t0) {
    if (!this.music.node && qs.get('mute') !== '1') {
      try {
        const src = window.SR_WORKLET_SRC;
        await this.music.initAudio(src ? { source: src } : { url: 'src/audio/worklet.js' });
      } catch (e) { console.warn('audio unavailable', e); }
    }
    this.music.play(t0);
    this.running = true;
    requestAnimationFrame((t) => this.frame(t));
  }

  // Video clock: advanced by exact vsync intervals (rAF timestamps) so motion
  // is even at any refresh rate, and slewed gently toward the audio clock,
  // whose timestamps arrive in audio-callback-sized steps. Seeks and pauses snap.
  frame(ts) {
    if (!this.running) return;
    const audio = this.music.now();
    if (ts === undefined || this.vt == null || !this.music.playing || this.lastTs == null) this.vt = audio;
    else {
      const dt = Math.min(0.1, (ts - this.lastTs) / 1000);
      this.vt += dt;
      const err = audio - this.vt;
      if (Math.abs(err) > 0.08) this.vt = audio;      // seek, stall or tab switch
      else this.vt += err * 0.03;                      // ~0.5 s to absorb drift
    }
    // remix: adapt the HDR buffer's pixel budget to the GPU (the raytraced
    // parts cost per pixel); the budget follows smoothed frame times
    if (this.post && this.lastTs != null && ts !== undefined) {
      const dt = Math.min(0.1, (ts - this.lastTs) / 1000);
      this.dtAvg = this.dtAvg == null ? dt : this.dtAvg * 0.95 + dt * 0.05;
      if (++this.dtN % 30 === 0) {
        const P = this.post;
        if (this.dtAvg > 1 / 45) P.budget = Math.max(0.5e6, P.budget * 0.8);
        else if (this.dtAvg < 1 / 58 && P.budget < 2.6e6) P.budget = Math.min(2.6e6, P.budget * 1.1);
      }
    }
    this.lastTs = ts;
    this.renderAt(this.vt);
    requestAnimationFrame((t) => this.frame(t));
  }

  renderAt(t) {
    const R = this.R, gl = R.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, R.W, R.H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    R.bindTarget(null);
    if (R.machine) gl.clear(gl.COLOR_BUFFER_BIT);
    const part = this.demo.partAt(t);
    const last = this.demo.timeline[this.demo.timeline.length - 1];
    if (part && (t < this.demo.end || part === last)) { // the end screen stays up
      if (!(this.post && part.renderRemix && part.renderRemix(R, t, this.post))) part.render(R, t);
    }
    if (R.machine) this.scaleOut();
    this.t = t;
    this.partName = part && part.name;
  }

  // machine frame -> screen: crisp pixels, antialiased only at the seams
  scaleOut() {
    const R = this.R, gl = R.gl, o = this.out;
    if (!this.outProg) this.outProg = R.fsProgram(`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 c;
uniform sampler2D uT;
void main(){
  vec2 ts = vec2(textureSize(uT, 0)), p = vUv * ts, i = floor(p), f = p - i - 0.5;
  f = clamp(f / max(fwidth(p), vec2(1e-4)) * 0.5, -0.5, 0.5);
  c = vec4(texture(uT, (i + 0.5 + f) / ts).rgb, 1.0);
}`);
    gl.bindTexture(gl.TEXTURE_2D, R.machine.color.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, R.W, R.H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(o.x, o.y, o.w, o.h);
    this.outProg.use().tex('uT', R.machine.color);
    R.drawFullscreen();
  }

  seekPart(dir) {
    const tl = this.demo.timeline;
    const t = this.music.now();
    let i = tl.findIndex((p) => t >= p.start && t < p.end);
    if (i < 0) i = 0;
    const j = Math.max(0, Math.min(tl.length - 1, i + dir));
    this.music.play(tl[j].start);
  }
}

async function boot() {
  const app = new App();
  try {
    await app.load();
  } catch (e) {
    app.setStatus('Error: ' + e.message);
    throw e;
  }
  const t0 = parseFloat(qs.get('t') || '0') || (qs.get('part') ? (app.demo.timeline.find((p) => p.name.toLowerCase() === qs.get('part').toLowerCase()) || { start: 0 }).start : 0);
  const overlay = document.getElementById('start');
  if (qs.get('capture') === '1') {
    // headless capture mode: render exact times on demand
    overlay.hidden = true;
    window.SR_READY = true;
    return;
  }
  const go = async (t) => {
    overlay.hidden = true;
    await app.start(t);
  };
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.checked = r.value === MODE;
    r.addEventListener('change', () => {
      try { localStorage.setItem('sr-mode', r.value); } catch (e) { /* storage unavailable */ }
      location.hash = r.value;
      location.reload();
    });
  }
  const btn = document.getElementById('go');
  btn.disabled = false;
  btn.textContent = t0 > 0 ? 'Start at ' + clock(t0) : 'Start the demo';
  btn.addEventListener('click', () => go(t0), { once: true });
  btn.focus();
  const list = document.getElementById('parts');
  for (const p of app.demo.timeline) {
    if (!TITLES[p.name]) continue;
    const li = document.createElement('li');
    li.innerHTML = `<a href="#" data-t="${p.start}">${TITLES[p.name]}</a> <span>${clock(p.start)}</span>`;
    list.appendChild(li);
  }
  list.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    go(parseFloat(a.dataset.t));
  });
  window.addEventListener('keydown', (e) => {
    if (!overlay.hidden) return;
    if (e.key === 'ArrowRight') app.seekPart(1);
    else if (e.key === 'ArrowLeft') app.seekPart(-1);
    else if (e.key === 'f' || e.key === 'F') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {});
    else if (e.key === 'm' || e.key === 'M') app.music.setMuted(!app.music.muted);
    else if (e.key === ' ') { if (app.music.playing) app.music.pause(); else app.music.play(app.music.now()); }
  });
}

boot();
