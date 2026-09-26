// Scream Tracker 3 module player, modelled on STMIK 3.00 (the replayer
// Second Reality shipped with). Effect semantics are ported from a
// disassembly of MAIN/STMIK.300: shared effect memory, "fast" volume
// slides (ST3.00 behaviour), 64-step vibrato tables, the order-list
// 0xFE marker logic that drives dis_musplus(), and the pattern
// descrambling Future Crew used to stop people ripping the tunes.
//
// Output side is where the "HD" happens: cubic interpolation, declicking
// ramps and float mixing instead of 8-bit nearest-neighbour.

const PERIODS = [27392, 25856, 24384, 23040, 21696, 20480, 19328, 18240, 17216, 16256, 15360, 14512];
const SINE = [0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253, 255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24,
  0, -24, -49, -74, -97, -120, -141, -161, -180, -197, -212, -224, -235, -244, -250, -253, -255, -253, -250, -244, -235, -224, -212, -197, -180, -161, -141, -120, -97, -74, -49, -24];
const RAMP = [];
const SQUARE = [];
for (let i = 0; i < 64; i++) {
  RAMP.push(i === 0 ? 0 : (i < 32 ? -256 + i * 8 : (i - 32) * 8));
  SQUARE.push(i < 32 ? 255 : 0);
}
const WAVES = [SINE, RAMP, SQUARE, SINE];
const RETRIG_ADD = [0, -1, -2, -4, -8, -16, 0, 0, 0, 1, 2, 4, 8, 16, 0, 0];
const RETRIG_MUL = [0, 0, 0, 0, 0, 0, 10, 8, 0, 0, 0, 0, 0, 0, 24, 32];
// S2x finetune -> c2spd (ST3 table)
const FINETUNE = [7895, 7941, 7985, 8046, 8107, 8169, 8232, 8280, 8363, 8413, 8463, 8529, 8581, 8651, 8723, 8757];

const PAD = 16; // interpolation guard samples after loop end / sample end

export function parseS3M(buffer) {
  const d = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  const str = (o, n) => { let s = ''; for (let i = 0; i < n && d[o + i]; i++) s += String.fromCharCode(d[o + i]); return s; };
  const ordnum = u16(0x20), insnum = u16(0x22), patnum = u16(0x24);
  const mod = {
    title: str(0, 28),
    flags: u16(0x26),
    cwt: u16(0x28),
    ffi: u16(0x2a),
    globalVol: d[0x30],
    initSpeed: d[0x31],
    initTempo: d[0x32],
    masterVol: d[0x33] & 0x7f,
    stereo: !!(d[0x33] & 0x80),
    chanSet: Array.from(d.subarray(0x40, 0x60)),
    orders: Array.from(d.subarray(0x60, 0x60 + ordnum)),
    instruments: [],
    patterns: [],
  };
  let p = 0x60 + ordnum;
  const insPtr = [], patPtr = [];
  for (let i = 0; i < insnum; i++) insPtr.push(u16(p + i * 2) * 16);
  p += insnum * 2;
  for (let i = 0; i < patnum; i++) patPtr.push(u16(p + i * 2) * 16);

  for (let i = 0; i < insnum; i++) {
    const o = insPtr[i];
    const ins = {
      type: d[o], filename: str(o + 1, 12), name: str(o + 48, 28),
      length: u32(o + 16), lbeg: u32(o + 20), lend: u32(o + 24),
      vol: d[o + 28], flags: d[o + 31], c2spd: u32(o + 32), data: null, loop: false,
    };
    if (ins.type === 1 && ins.length > 0) {
      // clamps from STARTEMS.C checkins()
      if (ins.vol > 64) ins.vol = 64;
      if (ins.c2spd > 65535) ins.c2spd = 65535;
      if (ins.length > 64000) ins.length = 64000;
      ins.loop = !!(ins.flags & 1);
      if (ins.lend <= ins.lbeg) ins.loop = false;
      if (ins.lbeg > ins.length) ins.lbeg = ins.length;
      if (ins.lend > ins.length) ins.lend = ins.length;
      const off = ((d[o + 13] << 16) | u16(o + 14)) * 16;
      const len = ins.length;
      const end = ins.loop ? ins.lend : len;
      const buf = new Float32Array(end + PAD);
      const signed = mod.ffi === 1;
      for (let k = 0; k < end; k++) {
        const b = d[off + k];
        buf[k] = (signed ? ((b << 24) >> 24) : (b - 128)) / 128;
      }
      if (ins.loop) {
        const ll = ins.lend - ins.lbeg;
        for (let k = 0; k < PAD; k++) buf[end + k] = buf[ins.lbeg + (k % ll)];
      }
      ins.data = buf;
    } else if (ins.type === 1) {
      ins.type = 0;
    }
    mod.instruments.push(ins);
  }

  // Patterns: descramble (byte ^= (4*off ^ off), off counted from the
  // start of the pattern block including its 2-byte length) and unpack
  // into 64 rows x 32 channels x 5 bytes.
  for (let i = 0; i < patnum; i++) {
    const pat = new Uint8Array(64 * 32 * 5);
    for (let k = 0; k < 64 * 32; k++) { pat[k * 5] = 255; pat[k * 5 + 2] = 255; }
    const o = patPtr[i];
    if (o) {
      const len = u16(o);
      const raw = d.slice(o, o + len);
      for (let si = 2; si < len; si++) raw[si] ^= ((si * 4) ^ si) & 0xff;
      let q = 2;
      for (let r = 0; r < 64 && q < len; r++) {
        for (;;) {
          const b = raw[q++];
          if (!b) break;
          const e = (r * 32 + (b & 31)) * 5;
          if (b & 32) { pat[e] = raw[q++]; pat[e + 1] = raw[q++]; }
          if (b & 64) { pat[e + 2] = raw[q++]; }
          if (b & 128) { pat[e + 3] = raw[q++]; pat[e + 4] = raw[q++]; }
        }
      }
    }
    mod.patterns.push(pat);
  }
  return mod;
}

function note2period(note, c2spd) {
  if (note === 0xfe) return 0;
  const base = PERIODS[Math.min(11, note & 15)] >> (note >> 4);
  if (!c2spd) return 0x7fff;
  const p = Math.floor(base * 8363 / c2spd);
  return p > 0x7fff ? 0x7fff : p;
}

class Voice {
  constructor() { this.reset(); }
  reset() {
    this.data = null; this.pos = 0; this.step = 0; this.end = 0; this.loopStart = -1; this.loopLen = 0;
    this.gain = 0; this.pan = 0.5; this.on = false;
  }
  copy(v) {
    this.data = v.data; this.pos = v.pos; this.step = v.step; this.end = v.end; this.loopStart = v.loopStart;
    this.loopLen = v.loopLen; this.gain = v.gain; this.pan = v.pan; this.on = v.on;
  }
}

class Channel {
  constructor(idx, pan) {
    this.idx = idx; this.pan = pan;
    this.active = 0;
    this.note = 255; this.ins = 0; this.vol = 255; this.cmd = 0; this.info = 0;
    this.lastNote = 0; this.insIdx = 0; this.c2spd = 8363; this.sample = null;
    this.volume = 0; this.baseVol = 0;
    this.period = 0; this.basePeriod = 0; this.target = 0;
    this.mem = 0; this.portaMem = 0; this.vibMem = 0; this.vibPos = 0; this.wave = 0;
    this.counter = 0; this.offset = 0; this.zeroRows = 3;
    this.voice = new Voice(); this.ghost = new Voice();
    this.gainNow = 0; // smoothed gain actually used by the mixer
    this.freq = 0;
  }
}

export class S3MPlayer {
  constructor(mod, sampleRate, opts = {}) {
    this.mod = mod;
    this.rate = sampleRate;
    this.stereoSep = opts.stereoSep ?? 0.6; // 0=mono, 1=hard pan
    this.channels = [];
    for (let c = 0; c < 32; c++) {
      const cs = mod.chanSet[c];
      const pan = cs < 8 ? 0.5 - this.stereoSep / 2 : 0.5 + this.stereoSep / 2;
      this.channels.push(new Channel(c, pan));
    }
    this.masterGain = opts.gain ?? 0.30;
    this.fade = 1; // module "master volume" fade (fademusic)
    this.fadeTarget = 1; this.fadeRate = 0;
    this.playing = false;
    this.rampLen = Math.max(1, Math.round(sampleRate * 0.0015));
  }

  // zplaysong(order)
  play(order) {
    const m = this.mod;
    this.speed = m.initSpeed || 6;
    this.tempo = m.initTempo || 125;
    this.globalVol = m.globalVol;
    this.orderIdx = order; // [0x940]: index of next order to read
    this.breakFlag = 0; this.breakRow = 0;
    this.patDelay = 0;
    this.tick = 0; this.row = 0; this.pattern = 0;
    this.zplus = 0; this.ord = -1;
    this.loopCount = 0;
    this.tickCounter = 0; // np_zframe equivalent (total ticks)
    for (const ch of this.channels) {
      ch.voice.reset(); ch.ghost.reset();
      ch.period = ch.basePeriod = ch.target = 0; ch.volume = 0; ch.active = 0; ch.insIdx = 0;
      ch.mem = ch.portaMem = ch.vibMem = ch.vibPos = 0; ch.wave = 0;
    }
    this.nextOrder();
    this.row = this.breakRow; this.breakRow = 0;
    this.playing = true;
    this.samplesLeft = 0; // samples until next tick
    this.tickFrac = 0;
    this.rowChanged = true;
  }

  setTempo(t) { this.tempo = t; }
  tickSamples() {
    // exact (fractional) number of output samples per tick, accumulate
    const exact = this.rate * 2.5 / this.tempo + this.tickFrac;
    const n = Math.floor(exact);
    this.tickFrac = exact - n;
    return n;
  }

  // [0x442d]: advance to next order, handling 0xFE markers ("plus") and 0xFF end.
  nextOrder() {
    const ords = this.mod.orders;
    this.zplus = 0;
    let guard = 0;
    for (;;) {
      if (guard++ > 512) { this.playing = false; return; }
      const i = this.orderIdx;
      this.orderIdx++;
      const cur = i < ords.length ? ords[i] : 0xff;
      const nxt = i + 1 < ords.length ? ords[i + 1] : 0xff;
      if (nxt === 0xfe) this.zplus |= 1;
      if (cur === 0xfe) { this.zplus |= 2; continue; }
      if (cur === 0xff) {
        this.loopCount++;
        this.orderIdx = 0;
        if (ords[0] === 0xff) { this.playing = false; return; }
        continue;
      }
      this.pattern = cur;
      this.ord = this.orderIdx - 1;
      return;
    }
  }

  // one tick of sequencing ([0x4353])
  doTick() {
    this.tickCounter++;
    if (this.tick === 0) {
      if (this.patDelay === 0) {
        this.readRow();
        this.tick0Effects();
      } else {
        this.tick0Effects();
        this.row--; this.patDelay--;
      }
    } else {
      this.tickNEffects();
    }
    this.tick++;
    if (this.tick >= this.speed) {
      let r = this.row + 1;
      if (this.breakFlag || r >= 64) {
        this.breakFlag = 0;
        this.nextOrder();
        r = this.breakRow; this.breakRow = 0;
      }
      this.row = r;
      this.tick = 0;
      this.rowChanged = true;
    }
  }

  readRow() {
    const pat = this.mod.patterns[this.pattern];
    const base = this.row * 32 * 5;
    for (let c = 0; c < 32; c++) {
      const ch = this.channels[c];
      ch.note = 255; ch.ins = 0; ch.vol = 255; ch.cmd = 0; ch.info = 0;
    }
    if (!pat) return;
    for (let c = 0; c < 32; c++) {
      if (this.mod.chanSet[c] >= 16) continue;
      const e = base + c * 5;
      if (pat[e] === 255 && pat[e + 1] === 0 && pat[e + 2] === 255 && pat[e + 3] === 0) continue;
      const ch = this.channels[c];
      ch.note = pat[e]; ch.ins = pat[e + 1]; ch.vol = pat[e + 2]; ch.cmd = pat[e + 3]; ch.info = pat[e + 4];
      ch.active = 1;
      if (ch.cmd === 0x13 && (ch.info & 0xf0) === 0xd0) continue; // SDx: delayed
      this.triggerRow(ch);
    }
  }

  // [0x4762]+[0x4810]
  triggerRow(ch) {
    if (ch.ins > 0x65) ch.ins = 0;
    if (ch.vol !== 255 && ch.vol > 0x3f) ch.vol = 0x3f;
    const m = this.mod;
    if (ch.ins) {
      ch.offset = 0;
      ch.insIdx = ch.ins;
      const ins = m.instruments[ch.ins - 1];
      if (!ins || ins.type !== 1) {
        ch.insIdx = 0;
      } else {
        ch.c2spd = ins.c2spd;
        const v = Math.max(0, Math.min(63, ins.vol));
        ch.volume = v; ch.baseVol = v;
        ch.sample = ins;
        // instrument swap without retrigger keeps playing position, new data
        if (ch.voice.on && ch.voice.data !== ins.data) this.bindSample(ch.voice, ins, false);
      }
    }
    if (!ch.insIdx) return;
    if (ch.cmd === 0x0f) ch.offset = ch.info << 8;
    if (ch.note !== 255) {
      if (ch.note === 0xfe) {
        this.declick(ch);
        ch.voice.on = false;
        ch.volume = 0;
        ch.basePeriod = 0; ch.target = 0;
      } else {
        const porta = ch.basePeriod !== 0 && ch.cmd === 7;
        if (!porta) {
          this.declick(ch);
          this.bindSample(ch.voice, ch.sample, true);
          ch.voice.pos = ch.offset;
          ch.voice.on = true;
          ch.snap = true; // attack is part of the sound: no ramp-in
        }
        ch.lastNote = ch.note;
        const per = note2period(ch.note, ch.c2spd);
        if (!porta) {
          ch.period = per;
          ch.vibPos = 0;
        }
        ch.basePeriod = per; ch.target = per;
      }
    }
    if (ch.vol !== 255) { ch.volume = ch.vol; ch.baseVol = ch.vol; }
  }

  bindSample(v, ins, restart) {
    v.data = ins.data;
    if (ins.loop) { v.loopStart = ins.lbeg; v.end = ins.lend; v.loopLen = ins.lend - ins.lbeg; }
    else { v.loopStart = -1; v.end = ins.length + 0; v.loopLen = 0; }
    if (restart) v.pos = 0;
  }

  declick(ch) {
    // hand the currently sounding voice to a ghost that fades out quickly
    if (ch.voice.on && ch.gainNow > 0.0005) {
      ch.ghost.copy(ch.voice);
      ch.ghost.gain = ch.gainNow;
      ch.ghost.on = true;
    }
  }

  tick0Effects() {
    const zeroOpt = this.mod.flags & 8;
    for (const ch of this.channels) {
      if (!ch.active) continue;
      if (zeroOpt) {
        if (ch.volume === 0 && ch.vol === 255 && ch.ins === 0 && ch.note === 255) {
          if (--ch.zeroRows === 0) { ch.voice.on = false; ch.active = 0; ch.zeroRows = 3; continue; }
        } else ch.zeroRows = 3;
      }
      const cmd = ch.cmd;
      let info = ch.info;
      if (info) ch.mem = info;
      if (cmd === 0) {
        ch.counter = 0;
        if (ch.period !== ch.basePeriod) ch.period = ch.basePeriod;
        continue;
      }
      if (cmd === 4) {
        ch.counter = 0;
        if (ch.period !== ch.basePeriod) ch.period = ch.basePeriod;
      }
      if (cmd !== 8 && cmd !== 0x0b && cmd !== 0x12) ch.vibPos |= 0x80;
      this.effect(ch, cmd, info, true);
    }
  }

  tickNEffects() {
    for (const ch of this.channels) {
      if (!ch.active || !ch.cmd) continue;
      this.effect(ch, ch.cmd, ch.info, false);
    }
  }

  effect(ch, cmd, info, t0) {
    switch (cmd) {
      case 1: // A speed
        if (t0 && info) this.speed = info;
        break;
      case 2: // B jump
        if (t0) { this.breakFlag = 1; if (info !== 0xff) this.orderIdx = info; }
        break;
      case 3: // C break
        if (t0) { this.breakRow = (info >> 4) * 10 + (info & 15); this.breakFlag = 1; }
        break;
      case 4: this.volSlide(ch, info); break;
      case 5: this.portaDown(ch, info, t0); break;
      case 6: this.portaUp(ch, info, t0); break;
      case 7: if (!t0) this.tonePorta(ch, info); break;
      case 8: if (!t0) this.vibrato(ch, info); break;
      case 10: this.arpeggio(ch, info); break;
      case 11: if (!t0) { this.volSlide(ch, info); this.vibrato(ch, 0, true); } break;
      case 12: if (!t0) { this.volSlide(ch, info); this.tonePorta(ch, 0, true); } break;
      case 17: this.retrig(ch, info); break;
      case 19: this.special(ch, info, t0); break;
      case 20: if (t0 && info > 0x20) this.tempo = info; break;
      case 22: if (!t0 && info <= 0x40) this.globalVol = info; break;
      default: break;
    }
  }

  volSlide(ch, info) {
    if (!info) info = ch.mem;
    const lo = info & 15, hi = info >> 4;
    const down = (n) => { ch.volume -= n; if (ch.volume < 0) ch.volume = 0; };
    const up = (n) => { ch.volume += n; if (ch.volume >= 0x40) ch.volume = 0x3f; };
    if (lo === 15) {
      if (hi === 0) down(15);
      else if (this.tick === 0) up(hi);
    } else if (hi === 15) {
      if (lo === 0) up(15);
      else if (this.tick === 0) down(lo);
    } else if (lo) down(lo);
    else up(hi);
  }

  portaDown(ch, info, t0) {
    if (!ch.basePeriod) return;
    if (!info) info = ch.mem;
    let a = 0;
    if (!t0) { if (info < 0xe0) a = info * 4; }
    else if (info > 0xf0) a = (info & 15) * 4;
    else if (info > 0xe0) a = info & 15;
    if (a) { ch.period += a; ch.basePeriod += a; }
  }

  portaUp(ch, info, t0) {
    if (!ch.basePeriod) return;
    if (!info) info = ch.mem;
    let a = 0;
    if (!t0) { if (info < 0xe0) a = info * 4; }
    else if (info > 0xf0) a = (info & 15) * 4;
    else if (info > 0xe0) a = info & 15;
    if (a) { ch.period -= a; ch.basePeriod -= a; if (ch.period < 0) ch.period = 0; if (ch.basePeriod < 0) ch.basePeriod = 0; }
  }

  tonePorta(ch, info, cont) {
    if (!ch.basePeriod) return;
    if (cont) info = ch.portaMem;
    else { if (!info) info = ch.portaMem; ch.portaMem = info; }
    if (ch.period === ch.target) return;
    const s = info * 4;
    let p = ch.period;
    if (p < ch.target) { p += s; if (p > ch.target) p = ch.target; }
    else { p -= s; if (p < ch.target) p = ch.target; }
    ch.basePeriod = p; ch.period = p;
  }

  vibrato(ch, info, cont) {
    if (cont) info = ch.vibMem;
    else {
      if (!info) info = ch.vibMem;
      if (!(info & 0xf0)) info = (info & 15) | (ch.vibMem & 0xf0);
      ch.vibMem = info;
    }
    if (!ch.basePeriod) return;
    const depth = info & 15, speed = info >> 4;
    let pos = ch.vibPos;
    const w = ch.wave & 7;
    if (w < 4) { if (pos & 0x80) pos = 0; } else pos &= 0x7f;
    let idx = (pos >> 1) & 63;
    let tbl = WAVES[w & 3];
    let v = tbl[idx];
    if ((w & 3) === 3) v = SINE[(idx + ((Math.random() * 16) | 0)) & 63];
    const delta = (v * depth) >> 5;
    ch.period = ch.basePeriod + delta;
    pos = (pos & 0x7f) + speed * 2;
    ch.vibPos = pos & 0x7e;
  }

  arpeggio(ch, info) {
    if (!info) info = ch.mem;
    const t = this.tick % 3;
    const add = t === 1 ? info >> 4 : t === 2 ? info & 15 : 0;
    let oct = ch.lastNote & 0xf0, n = (ch.lastNote & 15) + add;
    if (n >= 12) { n -= 12; oct += 0x10; }
    if (n >= 12) n = 11;
    ch.period = note2period(oct | n, ch.c2spd);
  }

  retrig(ch, info) {
    if (!info) info = ch.mem;
    const vt = info >> 4, iv = info & 15;
    if (iv && iv <= ch.counter) {
      ch.counter = 0;
      if (ch.voice.data) { this.declick(ch); ch.voice.pos = 0; ch.voice.on = true; ch.snap = true; }
      let v = ch.volume;
      const mul = RETRIG_MUL[vt];
      if (mul) v = (v * mul) >> 4; else v += RETRIG_ADD[vt];
      ch.volume = Math.max(0, Math.min(63, v));
    }
    ch.counter++;
  }

  special(ch, info, t0) {
    const x = info & 15;
    switch (info >> 4) {
      case 2: if (t0) { ch.c2spd = FINETUNE[x]; } break;
      case 3: if (t0) ch.wave = x & 7; break;
      case 0xc:
        if (t0) ch.counter = x;
        else if (ch.counter) { if (--ch.counter === 0) { this.declick(ch); ch.voice.on = false; } }
        break;
      case 0xd:
        if (t0) ch.counter = x;
        else if (ch.counter) { if (--ch.counter === 0) { ch.active = 1; this.triggerRow(ch); } }
        break;
      case 0xe:
        if (t0 && this.patDelay === 0) this.patDelay = x;
        break;
      default: break;
    }
  }

  // ---- mixing ----

  updateVoices() {
    const gv = this.globalVol / 64;
    for (const ch of this.channels) {
      const v = ch.voice;
      let per = ch.period;
      if (per > 0x7fff) per = 0x7fff;
      if (per > 0 && per < 64) per = 64;
      if (per <= 0) { v.step = 0; }
      else v.step = (14317056 / per) / this.rate;
      ch.targetGain = v.on ? (ch.volume / 64) * gv : 0;
    }
  }

  // Render n stereo frames into L/R starting at offset. mix=false just advances.
  render(L, R, off, n, mix = true) {
    let done = 0;
    while (done < n) {
      if (!this.playing) {
        if (mix) for (let i = done; i < n; i++) { L[off + i] = 0; R[off + i] = 0; }
        return;
      }
      if (this.samplesLeft <= 0) {
        this.doTick();
        this.updateVoices();
        this.samplesLeft = this.tickSamples();
      }
      const cnt = Math.min(n - done, this.samplesLeft);
      if (mix) {
        for (let i = 0; i < cnt; i++) { L[off + done + i] = 0; R[off + done + i] = 0; }
        for (const ch of this.channels) {
          if (ch.ghost.on) this.mixGhost(ch, L, R, off + done, cnt);
          this.mixVoice(ch, L, R, off + done, cnt);
        }
        this.applyMaster(L, R, off + done, cnt);
      } else {
        for (const ch of this.channels) { this.skipVoice(ch.voice, cnt); ch.ghost.on = false; ch.gainNow = ch.targetGain || 0; }
        this.advanceFade(cnt);
      }
      this.samplesLeft -= cnt;
      done += cnt;
    }
  }

  advanceFade(cnt) {
    if (this.fadeRate) {
      this.fade += this.fadeRate * cnt;
      if ((this.fadeRate < 0 && this.fade <= this.fadeTarget) || (this.fadeRate > 0 && this.fade >= this.fadeTarget)) {
        this.fade = this.fadeTarget; this.fadeRate = 0;
      }
    }
  }

  applyMaster(L, R, off, cnt) {
    const g = this.masterGain;
    for (let i = 0; i < cnt; i++) {
      if (this.fadeRate) this.advanceFade(1);
      const f = g * this.fade;
      let l = L[off + i] * f, r = R[off + i] * f;
      // gentle soft-clip above ~0.8
      if (l > 0.8) l = 0.8 + 0.2 * Math.tanh((l - 0.8) / 0.2); else if (l < -0.8) l = -0.8 + 0.2 * Math.tanh((l + 0.8) / 0.2);
      if (r > 0.8) r = 0.8 + 0.2 * Math.tanh((r - 0.8) / 0.2); else if (r < -0.8) r = -0.8 + 0.2 * Math.tanh((r + 0.8) / 0.2);
      L[off + i] = l; R[off + i] = r;
    }
  }

  skipVoice(v, cnt) {
    if (!v.on || !v.data) return;
    v.pos += v.step * cnt;
    if (v.pos >= v.end) {
      if (v.loopStart >= 0 && v.loopLen > 0) v.pos = v.loopStart + ((v.pos - v.loopStart) % v.loopLen);
      else v.on = false;
    }
  }

  mixVoice(ch, L, R, off, cnt) {
    const v = ch.voice;
    const target = ch.targetGain || 0;
    let g = ch.gainNow;
    if (!v.on || !v.data || v.step === 0) {
      ch.gainNow = v.on ? g : 0;
      if (!v.on) ch.gainNow = 0;
      return;
    }
    const d = v.data;
    const pan = ch.pan;
    const pl = 1 - pan, pr = pan;
    const ramp = this.rampLen;
    if (ch.snap) { g = target; ch.snap = false; }
    const dg = (target - g) / ramp;
    let pos = v.pos;
    const step = v.step, end = v.end, ls = v.loopStart, ll = v.loopLen;
    for (let i = 0; i < cnt; i++) {
      if (pos >= end) {
        if (ls >= 0 && ll > 0) { pos = ls + ((pos - ls) % ll); }
        else { v.on = false; break; }
      }
      const ip = pos | 0;
      const t = pos - ip;
      const x0 = ip > 0 ? d[ip - 1] : d[0];
      const x1 = d[ip], x2 = d[ip + 1], x3 = d[ip + 2];
      // Catmull-Rom
      const s = x1 + 0.5 * t * (x2 - x0 + t * (2 * x0 - 5 * x1 + 4 * x2 - x3 + t * (3 * (x1 - x2) + x3 - x0)));
      if (i < ramp && g !== target) g += dg;
      else g = target;
      const o = s * g;
      L[off + i] += o * pl; R[off + i] += o * pr;
      pos += step;
    }
    ch.gainNow = g;
    v.pos = pos;
  }

  mixGhost(ch, L, R, off, cnt) {
    const v = ch.ghost;
    const d = v.data;
    const pl = 1 - v.pan, pr = v.pan;
    let g = v.gain;
    const dg = g / this.rampLen;
    let pos = v.pos;
    for (let i = 0; i < cnt && g > 0; i++) {
      if (pos >= v.end) {
        if (v.loopStart >= 0 && v.loopLen > 0) pos = v.loopStart + ((pos - v.loopStart) % v.loopLen);
        else { g = 0; break; }
      }
      const ip = pos | 0;
      const t = pos - ip;
      const s = d[ip] + (d[ip + 1] - d[ip]) * t;
      L[off + i] += s * g * pl; R[off + i] += s * g * pr;
      g -= dg;
      pos += v.step;
    }
    v.pos = pos; v.gain = g;
    if (g <= 0) v.on = false;
  }

  // position info in the DIS/STMIK sense
  get position() {
    return { ord: this.ord, row: this.row, pat: this.pattern, zplus: this.zplus, tick: this.tick, frame: this.tickCounter };
  }
}

// dis_musplus() from DISINT.ASM muscode_6
export function musplus(zplus, row) {
  const coming = () => { const dx = row - 64; return dx >= -32 ? dx : -32; };
  const after = () => (row < 32 ? row : -32);
  switch (zplus) {
    case 0: return -32;
    case 1: return coming();
    case 2: return after();
    default: return row > 32 ? coming() : after();
  }
}

// Precompute the row timeline of a song started at `order`.
// time[i] is when row i starts sounding; tickTime[k] when tick k starts.
export function buildTimeline(mod, order, rate, maxSeconds) {
  const p = new S3MPlayer(mod, rate);
  const times = [], ords = [], rows = [], zp = [], tickIdx = [];
  let t = 0;
  const rec = () => { times.push(t / rate); ords.push(p.ord); rows.push(p.row); zp.push(p.zplus); tickIdx.push(p.tickCounter); };
  p.play(order);
  rec();
  const tickTimes = [];
  const max = maxSeconds * rate;
  while (p.playing && t < max) {
    p.rowChanged = false;
    p.doTick();
    tickTimes.push(t / rate);
    t += p.tickSamples();
    if (p.rowChanged) rec();
  }
  return {
    time: Float64Array.from(times), ord: Int16Array.from(ords), row: Int16Array.from(rows), zplus: Int8Array.from(zp),
    tick: Int32Array.from(tickIdx), tickTime: Float64Array.from(tickTimes), end: t / rate,
  };
}
