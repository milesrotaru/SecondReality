// Second Reality HD - entry point.
import { GL } from './gfx/gl.js';
import { Assets, inflate } from './assets.js';
import { Music } from './audio/music.js';
import { Demo } from './demo.js';
import { PARTS } from './parts/index.js';

const qs = new URLSearchParams(location.search);

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
    Object.assign(this.R, { vw, vh, vx, vy, W, H });
    this.R.viewport = { x: vx, y: vy, w: vw, h: vh };
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
    requestAnimationFrame(() => this.frame());
  }

  frame() {
    if (!this.running) return;
    const t = this.music.now();
    this.renderAt(t);
    requestAnimationFrame(() => this.frame());
  }

  renderAt(t) {
    const R = this.R, gl = R.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, R.W, R.H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    R.bindTarget(null);
    const part = this.demo.partAt(t);
    const last = this.demo.timeline[this.demo.timeline.length - 1];
    if (part && (t < this.demo.end || part === last)) part.render(R, t); // the end screen stays up
    this.t = t;
    this.partName = part && part.name;
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
