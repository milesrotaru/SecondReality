// Demo sequencer: mirrors the part order and music restarts of MAIN/U2.ASM,
// and precomputes when each part starts/ends from the music timeline (the
// original parts polled the player; we can ask the future).

export const FPS = 70.086; // VGA 320x200/400 refresh (the original frame clock)

export class Planner {
  constructor(music) {
    this.music = music;
    this.plan = []; // music segments
    this.seg = null;
  }
  setSegment(song, order, start) {
    this.seg = { song, order, start };
    this.plan.push(this.seg);
  }
  pos(t) { const s = this.seg; return this.music.posIn(s.song, s.order, s.start, t); }
  // first time >= from where pred(pos) holds (checked at row starts)
  until(from, pred) {
    const s = this.seg;
    return this.music.findRow(s.song, s.order, s.start, from, pred);
  }
  // time when n music ticks have elapsed after `from` (dis_setmframe/getmframe)
  ticks(from, n) {
    const s = this.seg;
    return this.music.tickTimeAfter(s.song, s.order, s.start, from, n);
  }
  // ordersync table from DISINT.ASM (dis_sync)
  sync(t) {
    const p = this.pos(t);
    return syncValue(p.ord, p.row);
  }
  untilSync(from, n) {
    return this.until(from, (p) => syncValue(p.ord, p.row) >= n);
  }
}

const ORDERSYNC = [[0x0000, 0], [0x0200, 1], [0x0300, 2], [0x032f, 3], [0x042f, 4], [0x052f, 5], [0x062f, 6], [0x072f, 7], [0x082f, 8], [0x0900, 9], [0x0d00, 10], [0x3d00, 1], [0x3f00, 2], [0x4100, 3], [0x4200, 4]];
export function syncValue(ord, row) {
  const dx = ((ord & 0xff) << 8) | (row & 0xff);
  for (let i = 0; i < ORDERSYNC.length; i++) {
    if (dx <= ORDERSYNC[i][0]) return i > 0 ? ORDERSYNC[i - 1][1] : 0;
  }
  return ORDERSYNC[ORDERSYNC.length - 1][1];
}

export class Demo {
  constructor(music, parts) {
    this.music = music;
    this.parts = parts; // array of part objects or {music:[song,order]} / {waitPlus:true}
    this.timeline = [];
  }

  build() {
    const P = new Planner(this.music);
    let t = 0;
    this.timeline = [];
    for (const item of this.parts) {
      if (item.music) { P.setSegment(item.music[0], item.music[1], t); continue; }
      if (item.waitPlus) {
        // U2.ASM @@zh5/@@zh4: wait until musplus<0, then until musplus>0
        const a = P.until(t, (p) => p.musplus < 0);
        t = P.until(a, (p) => p.musplus > 0);
        continue;
      }
      const part = item;
      part.start = t;
      part.seg = P.seg;
      part.planner = P;
      const end = part.plan(P, t);
      part.end = end;
      if (part.fades) (this.fades ||= []).push(...part.fades);
      this.timeline.push(part);
      t = end;
    }
    this.end = t;
    this.music.setPlan(P.plan, this.fades || []);
    return this.timeline;
  }

  partAt(t) {
    for (let i = this.timeline.length - 1; i >= 0; i--) if (t >= this.timeline[i].start) return this.timeline[i];
    return this.timeline[0];
  }
}
