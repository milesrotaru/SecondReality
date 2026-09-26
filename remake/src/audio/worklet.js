// AudioWorkletProcessor hosting the S3M player. Plays a "music plan": a
// list of segments {song, order, start} in demo seconds. The main thread
// tells it where the demo clock is (seek) and it renders from there.
import { S3MPlayer } from './s3m.js';

class SRMusic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mods = null;
    this.plan = [];
    this.player = null;
    this.segIdx = -1;
    this.demoFrame = 0; // demo time in frames at the start of next render quantum
    this.running = false;
    this.volume = 1;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  onMsg(m) {
    if (m.type === 'load') {
      this.mods = m.mods;
      this.plan = m.plan;
      this.fades = m.fades || [];
    } else if (m.type === 'seek') {
      this.seek(m.time);
      this.running = m.play !== false;
      this.port.postMessage({ type: 'seeked', time: m.time, ctxTime: currentTime, frame: currentFrame });
    } else if (m.type === 'pause') {
      this.running = false;
    } else if (m.type === 'volume') {
      this.volume = m.value;
    }
  }

  segmentAt(t) {
    let idx = -1;
    for (let i = 0; i < this.plan.length; i++) if (this.plan[i].start <= t + 1e-9) idx = i;
    return idx;
  }

  startSegment(idx, offsetSeconds) {
    this.segIdx = idx;
    if (idx < 0) { this.player = null; return; }
    const seg = this.plan[idx];
    const p = new S3MPlayer(this.mods[seg.song], sampleRate, { gain: seg.gain });
    p.play(seg.order);
    const skip = Math.round(offsetSeconds * sampleRate);
    if (skip > 0) {
      const tmpL = new Float32Array(1), tmpR = new Float32Array(1);
      p.render(tmpL, tmpR, 0, skip, false);
    }
    this.player = p;
  }

  seek(t) {
    this.demoFrame = Math.round(t * sampleRate);
    const idx = this.segmentAt(t);
    if (idx >= 0) this.startSegment(idx, t - this.plan[idx].start);
    else this.startSegment(-1, 0);
  }

  fadeAt(t) {
    // piecewise-linear master fades (fademusic at the very end)
    let g = 1;
    for (const f of this.fades) {
      if (t >= f.end) g = f.to;
      else if (t > f.start) g = f.from + (f.to - f.from) * (t - f.start) / (f.end - f.start);
    }
    return g;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const n = L.length;
    if (!this.running || !this.mods) { L.fill(0); if (R !== L) R.fill(0); return true; }
    let done = 0;
    while (done < n) {
      const t = this.demoFrame / sampleRate;
      // segment switch?
      const next = this.segIdx + 1;
      let cnt = n - done;
      if (next < this.plan.length) {
        const sf = Math.round(this.plan[next].start * sampleRate);
        if (this.demoFrame >= sf) { this.startSegment(next, 0); continue; }
        cnt = Math.min(cnt, sf - this.demoFrame);
      }
      if (this.player) this.player.render(L, R, done, cnt, true);
      else for (let i = 0; i < cnt; i++) { L[done + i] = 0; R[done + i] = 0; }
      const g0 = this.fadeAt(t) * this.volume;
      const g1 = this.fadeAt(t + cnt / sampleRate) * this.volume;
      if (g0 !== 1 || g1 !== 1) {
        for (let i = 0; i < cnt; i++) { const g = g0 + (g1 - g0) * i / cnt; L[done + i] *= g; R[done + i] *= g; }
      }
      this.demoFrame += cnt;
      done += cnt;
    }
    if (R === L) { /* mono output: already mixed into L */ }
    return true;
  }
}

registerProcessor('sr-music', SRMusic);
