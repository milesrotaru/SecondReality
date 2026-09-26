// Main-thread side of the music: parses modules, precomputes row timelines
// (for dis_musplus / dis_musrow / dis_sync style queries) and drives the
// AudioWorklet. Also owns the demo clock, which follows the audio clock.
import { parseS3M, buildTimeline, musplus } from './s3m.js';

const TL_RATE = 48000;

export class Music {
  constructor() {
    this.mods = [];
    this.timelines = new Map();
    this.plan = [];
    this.fades = [];
    this.ctx = null;
    this.node = null;
    this.playing = false;
    this.anchor = { demo: 0, perf: performance.now() };
    this.muted = false;
  }

  load(buffers) {
    this.mods = buffers.map((b) => parseS3M(b));
    // STARTMUS.C: module[50]=0x78 -> MUSIC0 initial tempo forced to 120
    this.mods[0].initTempo = 0x78;
  }

  timeline(song, order) {
    const key = song + ':' + order;
    let tl = this.timelines.get(key);
    if (!tl) {
      tl = buildTimeline(this.mods[song], order, TL_RATE, 900);
      this.timelines.set(key, tl);
    }
    return tl;
  }

  // Plan = [{song, order, start}] in demo seconds
  setPlan(plan, fades) { this.plan = plan; this.fades = fades || []; }

  segmentAt(t) {
    let s = null;
    for (const p of this.plan) if (p.start <= t + 1e-9) s = p;
    return s;
  }

  // Position of `song` started at `order` at demo time `segStart`, queried at time t.
  posIn(song, order, segStart, t) {
    const tl = this.timeline(song, order);
    const lt = t - segStart;
    if (lt < 0) return { ord: -1, row: 0, zplus: 0, ticks: 0, musplus: -32, rowTime: segStart };
    let lo = 0, hi = tl.time.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tl.time[mid] <= lt) lo = mid; else hi = mid - 1; }
    // ticks elapsed (np_zframe)
    let a = 0, b = tl.tickTime.length - 1;
    while (a < b) { const mid = (a + b + 1) >> 1; if (tl.tickTime[mid] <= lt) a = mid; else b = mid - 1; }
    const row = tl.row[lo], zp = tl.zplus[lo];
    return { ord: tl.ord[lo], row, zplus: zp, ticks: a + 1, musplus: musplus(zp, row), rowTime: segStart + tl.time[lo], idx: lo };
  }

  pos(t) {
    const s = this.segmentAt(t);
    if (!s) return { ord: -1, row: 0, zplus: 0, ticks: 0, musplus: -32 };
    return this.posIn(s.song, s.order, s.start, t);
  }

  // First demo time >= from at which predicate(pos) holds, scanning row starts
  // of the segment that is active from `segStart`. Used to precompute part
  // boundaries that the original code found by polling the player.
  findRow(song, order, segStart, from, pred) {
    const tl = this.timeline(song, order);
    const lt0 = from - segStart;
    for (let i = 0; i < tl.time.length; i++) {
      const rt = tl.time[i];
      const next = i + 1 < tl.time.length ? tl.time[i + 1] : Infinity;
      if (next <= lt0) continue;
      const p = { ord: tl.ord[i], row: tl.row[i], zplus: tl.zplus[i], musplus: musplus(tl.zplus[i], tl.row[i]) };
      if (pred(p)) return segStart + Math.max(rt, lt0);
    }
    return Infinity;
  }

  // Demo time at which `n` ticks have elapsed since demo time `from` (dis_getmframe)
  tickTimeAfter(song, order, segStart, from, n) {
    const tl = this.timeline(song, order);
    const lt = from - segStart;
    let a = 0, b = tl.tickTime.length - 1;
    while (a < b) { const mid = (a + b) >> 1; if (tl.tickTime[mid] < lt) a = mid + 1; else b = mid; }
    const k = a + n;
    return segStart + (k < tl.tickTime.length ? tl.tickTime[k] : tl.end);
  }

  // ---- audio output ----

  async initAudio(src) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'playback' });
    const url = src.url || URL.createObjectURL(new Blob([src.source], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    this.node = new AudioWorkletNode(this.ctx, 'sr-music', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.gain = this.ctx.createGain();
    this.node.connect(this.gain).connect(this.ctx.destination);
    this.node.port.postMessage({ type: 'load', mods: this.mods, plan: this.plan, fades: this.fades });
    this.node.port.onmessage = (e) => {
      if (e.data.type === 'seeked') this.anchor = { demo: e.data.time, ctx: e.data.ctxTime };
    };
  }

  play(t) {
    this.playing = true;
    this._last = null;
    this.anchor = { demo: t, perf: performance.now() };
    if (this.node) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      this.node.port.postMessage({ type: 'seek', time: t, play: true });
      this.anchor.ctx = null;
    }
  }

  pause() {
    this.anchor = { demo: this.now(), perf: performance.now() };
    this.playing = false;
    if (this.node) this.node.port.postMessage({ type: 'pause' });
  }

  setMuted(m) {
    this.muted = m;
    if (this.gain) this.gain.gain.value = m ? 0 : 1;
  }

  // Current demo time in seconds.
  now() {
    if (!this.playing) return this.anchor.demo;
    if (this.ctx && this.anchor.ctx != null && this.ctx.state === 'running') {
      let ctxNow = this.ctx.currentTime;
      if (this.ctx.getOutputTimestamp) {
        const ts = this.ctx.getOutputTimestamp();
        if (ts.contextTime > 0) ctxNow = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
      const t = this.anchor.demo + (ctxNow - this.anchor.ctx);
      // never run backwards across frames
      if (this._last != null && t < this._last && this._last - t < 0.05) return this._last;
      this._last = t;
      return t;
    }
    return this.anchor.demo + (performance.now() - this.anchor.perf) / 1000;
  }
}
