// GLENZ (Psi). The title tilts away, a checkerboard drops in and bounces,
// a jelly "glenz" polyhedron falls onto it, then a huge red glenz grows
// around it. GLENZ/MAIN.C + ZOOMER.C + VEC.ASM + NEW.ASM.
//
// The original draws transparent polygons with an XOR edge-list scanline
// filler ORed over the background index, and gives every visible front
// face of the small glenz its own 16-entry palette slot holding
// "face light + 1/4 of the 16 background colours". Here the XOR runs in
// the stencil buffer (INVERT per bit, per MSAA sample) and each palette
// slot becomes a stencil-selected colour pass - same maths, antialiased.
import { FPS } from '../demo.js';
import { Picture } from '../gfx/picture.js';
import { REMIX_FS } from './glenz_remix.js';

const trunc = Math.trunc;
const w16 = (x) => (x << 16) >> 16; // 16-bit int wrap (MSC large model ints)

const ZZZ = 50, QQQ = 99;
const POINTS1 = [
  [-100, -100, -100], [100, -100, -100], [100, 100, -100], [-100, 100, -100],
  [-100, -100, 100], [100, -100, 100], [100, 100, 100], [-100, 100, 100],
  [0, 0, -170], [0, 0, 170], [170, 0, 0], [-170, 0, 0], [0, 170, 0], [0, -170, 0]].map((p) => p.map((v) => v * ZZZ));
const POINTSB = [
  [-60, -60, -60], [60, -60, -60], [60, 60, -60], [-60, 60, -60],
  [-60, -60, 60], [60, -60, 60], [60, 60, 60], [-60, 60, 60],
  [0, 0, -105], [0, 0, 105], [105, 0, 0], [-105, 0, 0], [0, 105, 0], [0, -105, 0]].map((p) => p.map((v) => v * QQQ));
// [color, v0, v1, v2]
const EPOLYS = [
  [0x02, 0, 1, 8], [0x04, 1, 2, 8], [0x06, 2, 3, 8], [0x08, 3, 0, 8],
  [0x0a, 2, 1, 10], [0x0c, 1, 5, 10], [0x0e, 5, 6, 10], [0x10, 6, 2, 10],
  [0x12, 2, 6, 12], [0x14, 6, 7, 12], [0x16, 7, 3, 12], [0x18, 3, 2, 12],
  [0x1a, 0, 3, 11], [0x1c, 3, 7, 11], [0x1e, 7, 4, 11], [0x20, 4, 0, 11],
  [0x22, 5, 1, 13], [0x24, 1, 0, 13], [0x26, 0, 4, 13], [0x28, 4, 5, 13],
  [0x2a, 5, 4, 9], [0x2c, 4, 7, 9], [0x2e, 7, 6, 9], [0x30, 6, 5, 9]];
const EPOLYSB = [
  [4, 0, 1, 8], [2, 1, 2, 8], [4, 2, 3, 8], [2, 3, 0, 8],
  [4, 2, 1, 10], [2, 1, 5, 10], [4, 5, 6, 10], [2, 6, 2, 10],
  [4, 2, 6, 12], [2, 6, 7, 12], [4, 7, 3, 12], [2, 3, 2, 12],
  [4, 0, 3, 11], [2, 3, 7, 11], [4, 7, 4, 11], [2, 4, 0, 11],
  [4, 5, 1, 13], [2, 1, 0, 13], [4, 0, 4, 13], [2, 4, 5, 13],
  [4, 5, 4, 9], [2, 4, 7, 9], [4, 7, 6, 9], [2, 6, 5, 9]];

// MATH.ASM calcmatrix (note: its "X" is the roty argument, "Y" is rotx)
function matrixYXZ(rotx, roty, rotz) {
  const d = Math.PI / 1800;
  const Xs = Math.sin(roty * d), Xc = Math.cos(roty * d);
  const Ys = Math.sin(rotx * d), Yc = Math.cos(rotx * d);
  const Zs = Math.sin(rotz * d), Zc = Math.cos(rotz * d);
  return [
    Yc * Zc - Xs * Ys * Zs, Xs * Ys * Zc + Yc * Zs, -Xc * Ys,
    -Xc * Zs, Xc * Zc, Xs,
    Xs * Yc * Zs + Ys * Zc, Ys * Zs - Xs * Yc * Zc, Xc * Yc,
  ];
}

const VS = `#version 300 es
layout(location=0) in vec2 aPos; // VGA 320x200 coordinates
void main(){ gl_Position = vec4(aPos.x / 160.0 - 1.0, 1.0 - aPos.y / 100.0, 0.0, 1.0); }`;

// colour pass: bg index (4 texels, palette-evaluated, bilinear) | L
const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uBg;       // R8 background indices (bgpic), 320x200
uniform vec3 uPal[16];       // entries 0..15 (copper-faded), 0..1
uniform vec3 uBack[16];      // unfaded backpal, 6-bit units
uniform vec3 uBase;          // front face base colour (6-bit units)
uniform int uFront;          // 1 = inside a small-glenz front face
uniform int uL;              // low index bits from the XOR
uniform vec4 uVp;            // viewport x,y,w,h in pixels
uniform int uClearTo;        // bgpic rows 150..uClearTo are cleared
vec3 col(int bg){
  int idx = bg | uL;
  if (uFront == 1) return min(uBase + floor(uBack[idx] / 4.0), vec3(63.0)) / 63.0;
  return uPal[idx];
}
int bgAt(ivec2 p){
  p = clamp(p, ivec2(0), ivec2(319, 199));
  if (p.y >= 150 && p.y <= uClearTo) return 0;
  return int(texelFetch(uBg, p, 0).r * 255.0 + 0.5);
}
void main(){
  vec2 q = (gl_FragCoord.xy - uVp.xy) / uVp.zw;
  vec2 s = vec2(q.x * 320.0, (1.0 - q.y) * 200.0) - 0.5;
  ivec2 i = ivec2(floor(s));
  vec2 f = s - vec2(i);
  vec3 c00 = col(bgAt(i)), c10 = col(bgAt(i + ivec2(1, 0)));
  vec3 c01 = col(bgAt(i + ivec2(0, 1))), c11 = col(bgAt(i + ivec2(1, 1)));
  o = vec4(mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y), 1.0);
}`;

export default {
  name: 'Glenz',
  credit: 'Psi',

  init(R, A) {
    const gl = R.gl;
    this.R = R;
    this.title = new Picture(R, A.pic('beg.title'));
    const fc = A.pic('glenz.fc');
    this.fc = fc;
    this.board = new Picture(R, fc);
    this.sin = A.i16('sin1024');
    this.prog = R.program(VS, FS);
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.bgTex = R.texture(320, 200, { internal: gl.R8, format: gl.RED, filter: gl.NEAREST });
    this.simulate();
  },

  // ---- exact re-runs of the original integer state machines ----
  simulate() {
    // zoomer2: black curtains closing over the title
    const zoom = [];
    let zy = 0, zya = 0;
    for (;;) {
      if (zy === 260) break;
      zya++; zy += trunc(zya / 4); if (zy > 260) zy = 260;
      zoom.push({ zy, zy2: trunc(125 * zy / 260) });
    }
    this.zoom = zoom;
    // board bounce
    const bounce = [];
    let yy = 0, ya = 0;
    for (;;) {
      ya++; yy += ya;
      if (yy > 48 * 16) {
        yy -= ya; ya = trunc(-ya * 2 / 3);
        if (ya > -4 && ya < 4) break;
      }
      bounce.push(trunc(yy / 16));
    }
    this.bounce = bounce;
    const yr = bounce[bounce.length - 1];
    this.restY = yr;
    // bgpic = the board as last drawn
    const bg = new Uint8Array(320 * 200);
    const y1 = 130 + trunc(yr / 2), y2 = 130 + trunc(yr * 3 / 2);
    const b = trunc(25600 / (y2 - y1));
    let ry = y1, c = 0;
    for (; ry < y2; ry++, c += b) if (ry <= 199) bg.set(this.fc.pix.subarray(trunc(c / 256) * 320, trunc(c / 256) * 320 + 320), ry * 320);
    for (c = 0; c < 16; c++, ry++) if (ry <= 199 && c <= 7) bg.set(this.fc.pix.subarray((100 + c) * 320, (100 + c) * 320 + 320), ry * 320);
    this.bgpic = bg;
    this.R.update(this.bgTex, bg, { format: this.R.gl.RED });
    // backpal (fc palette 0..15) and the later red scheme
    const back0 = [];
    for (let a = 0; a < 16; a++) back0.push([this.fc.pal[a * 3], this.fc.pal[a * 3 + 1], this.fc.pal[a * 3 + 2]]);
    const red = [];
    for (let a = 0; a < 16; a++) {
      let r = 0, g = 0, bb = 0;
      if (a & 1) r += 10; if (a & 2) r += 30; if (a & 4) r += 20;
      if (a & 8) { r += 16; g += 16; bb += 16; }
      red.push([Math.min(63, r), Math.min(63, g), Math.min(63, bb)]);
    }
    this.back0 = back0; this.backRed = red;
    // main glenz loop, one entry per retrace frame
    const S = this.sin;
    const sn = (i) => S[i & 1023];
    const st = [];
    let rx = 0, ry2 = 0, rz = 0, ypos = -9000, yposa = 0, boingm = 6, boingd = 7;
    let jello = 0, jelloa = 0, xscale = 120, yscale = 120, zscale = 120, bscale = 0;
    let oxp = 0, oyp = 0, ozp = 0, oxb = 0, oyb = 0, ozb = 0, lightshift = 9;
    let palK = 64, redPal = false, palSet = 'back0', clearTo = 0;
    const push = (frame) => st.push({ frame, rx, ry: ry2, rz, ypos, xscale, yscale, zscale, bscale, oxp, oyp, ozp, oxb, oyb, ozb, lightshift, palK, redPal, palSet, clearTo });
    push(0);
    for (let frame = 1; frame < 2600; frame++) {
      rx += 32; ry2 += 7; rx %= 3 * 3600; ry2 %= 3 * 3600; rz %= 3 * 3600;
      if (frame > 900) {
        let a = frame - 900;
        let bq = frame - 900; if (bq > 50) bq = 50;
        oxp = trunc(sn(a * 3) * bq / 10);
        oyp = trunc(sn(a * 5) * bq / 10);
        ozp = trunc((trunc(sn(a * 4) / 2) + 128) * bq / 16);
        if (frame > 1800) {
          a = frame - 1800 + 64; if (a > 1024) a = 1024;
          oxb = trunc(-sn(a * 6) * a / 40);
          oyb = trunc(-sn(a * 7) * a / 40);
          ozb = trunc((sn(a * 8) + 128) * a / 40);
        } else {
          oxb = -sn(a * 6); oyb = -sn(a * 7); ozb = sn(a * 8) + 128;
        }
        let bb = 1800 - frame;
        if (bb < 0) { if (bb < -99) bb = -99; oyp -= trunc(bb * bb / 2); }
      }
      if (frame > 800) {
        if (frame > 1220 + 789) {
          if (xscale > 0) xscale--; if (yscale > 0) yscale--; if (zscale > 0) zscale--; if (bscale > 0) bscale--;
        } else {
          if (bscale < 180) bscale += 2; else bscale = 180;
        }
        if (bscale > xscale) lightshift = 10;
      } else {
        if (frame < 640 + 70) {
          yposa = w16(yposa + 31);
          ypos = w16(ypos + trunc(yposa / 40));
          if (ypos > -300) {
            ypos = w16(ypos - trunc(yposa / 40));
            yposa = trunc(w16(w16(-yposa) * boingm) / boingd);
            boingm += 2; boingd++;
          }
          if (ypos > -900 && yposa > 0) { jello = trunc((ypos + 900) * 5 / 3); jelloa = 0; }
        } else {
          if (ypos > -2800) ypos -= 16; else if (ypos < -2800) ypos += 16;
        }
        yscale = xscale = 120 + trunc(jello / 30);
        zscale = 120 - trunc(jello / 30);
        const a = jello;
        jello = w16(jello + jelloa);
        if ((a < 0 && jello > 0) || (a > 0 && jello < 0)) jelloa = trunc(w16(jelloa * 5) / 6);
        jelloa = w16(jelloa - trunc(jello / 20));
      }
      if (frame > 1280 + 789) {
        let bb = 1280 + 789 + 64 - frame; if (bb < 0) bb = 0; palK = bb;
      } else if (frame > 700) {
        if (frame < 765) { let bb = 764 - frame; if (bb < 0) bb = 0; palK = bb; }
        else if (frame < 790) {
          clearTo = 150 + (frame - 765) * 2 + 1;
          if (frame > 785) redPal = true;
        } else if (frame < 795) { palK = 64; palSet = 'red'; }
      }
      push(frame);
    }
    this.states = st;
  },

  plan(P, t0) {
    this.t0 = t0;
    this.ts = P.until(t0, (p) => p.musplus >= -19);
    this.tZoomEnd = this.ts + this.zoom.length / FPS;
    this.tBounce = this.tZoomEnd + 1 / FPS;
    this.tBounceEnd = this.tBounce + this.bounce.length / FPS;
    this.t300 = P.ticks(this.ts, 300);
    this.t333 = P.ticks(this.ts, 333);
    const end = P.until(this.t333, (p) => p.musplus < 0 && p.musplus > -16);
    this.tEnd = end;
    return end;
  },

  lerpState(f) {
    const S = this.states;
    const i = Math.max(0, Math.min(S.length - 2, Math.floor(f)));
    const a = Math.max(0, Math.min(1, f - i));
    const A = S[i], B = S[i + 1];
    const out = Object.assign({}, A);
    for (const k of ['ypos', 'xscale', 'yscale', 'zscale', 'bscale', 'oxp', 'oyp', 'ozp', 'oxb', 'oyb', 'ozb']) out[k] = A[k] + (B[k] - A[k]) * a;
    // rotation angles advance linearly (wrap at 10800)
    out.rx = A.rx + 32 * a; out.ry = A.ry + 7 * a;
    return out;
  },

  project(points, M, scale, t, clip) {
    const out = [];
    for (const p of points) {
      // rotation (units of 1.0) then scale matrix (scale*64/32768)
      let x = M[0] * p[0] + M[1] * p[1] + M[2] * p[2];
      let y = M[3] * p[0] + M[4] * p[1] + M[5] * p[2];
      let z = M[6] * p[0] + M[7] * p[1] + M[8] * p[2];
      x = x * scale[0] * 64 / 32768 + t[0];
      y = y * scale[1] * 64 / 32768 + t[1];
      z = z * scale[2] * 64 / 32768 + t[2];
      if (clip && y >= 1500) y = 1500;
      if (z < 128) z = 128;
      out.push([160 + x * 256 / z, 130 + y * 213 / z]);
    }
    return out;
  },

  // ---- remix: the same states, raytraced (see glenz_remix.js) ----
  // World: camera at the origin looking +z, y down, the original's projection
  // (x*256/z, y*213/z around 160,130). The board picture spans rows
  // 130+y/2 .. 130+3y/2, i.e. a floor at height H between depths z0 and 3*z0;
  // with H = 1500*y/restY the depths stay fixed and the board lowers from eye
  // level as the original's does.
  planes(points, M, scale, tr, tintOf, polys, clipY) {
    const V = points.map((p) => {
      const x = M[0] * p[0] + M[1] * p[1] + M[2] * p[2];
      const y = M[3] * p[0] + M[4] * p[1] + M[5] * p[2];
      const z = M[6] * p[0] + M[7] * p[1] + M[8] * p[2];
      return [x * scale[0] * 64 / 32768 + tr[0], y * scale[1] * 64 / 32768 + tr[1], z * scale[2] * 64 / 32768 + tr[2]];
    });
    const c = [0, 0, 0];
    for (const v of V) for (let k = 0; k < 3; k++) c[k] += v[k] / V.length;
    let r = 0;
    for (const v of V) r = Math.max(r, Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]));
    const P = [], T = [];
    for (const [col, a, b, d] of polys) {
      const A = V[a], B = V[b], D = V[d];
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n) || 1;
      n = n.map((x) => x / l);
      if (n[0] * (A[0] - c[0]) + n[1] * (A[1] - c[1]) + n[2] * (A[2] - c[2]) < 0) n = n.map((x) => -x);
      P.push(n[0], n[1], n[2], n[0] * A[0] + n[1] * A[1] + n[2] * A[2]);
      T.push(tintOf(col));
    }
    if (clipY !== undefined) { P.push(0, 1, 0, clipY); T.push(0); }
    return { P: new Float32Array(P), T: new Float32Array(T), n: T.length, sph: [c[0], c[1], c[2], r * 1.02 + 10] };
  },

  renderRemix(R, t, post) {
    if (t < this.tBounce) return false;
    if (!this.rprog) this.rprog = R.fsProgram(REMIX_FS);
    const pr = this.rprog;
    let H = 1500, board = 1, wipe = 1e9, red = 0, boardL = 1, fade = 0;
    let A = null, B = null;
    if (t < this.t333) {
      const k = (t - this.tBounce) * FPS, n = this.bounce.length;
      let y;
      if (k >= n - 1) y = this.bounce[n - 1];
      else { const i = Math.floor(k); y = this.bounce[i] + (this.bounce[i + 1] - this.bounce[i]) * (k - i); }
      H = 1500 * y / this.restY;
    } else {
      const s = this.lerpState((t - this.t333) * FPS);
      const f = (t - this.t333) * FPS;
      if (s.xscale > 4) {
        const M = matrixYXZ(s.rx, s.ry, s.rz);
        A = this.planes(POINTS1, M, [s.xscale, s.yscale, s.zscale], [s.oxp, s.ypos + 1500 + s.oyp, 7500 + s.ozp], (c) => (c & 2 ? 1 : 0), EPOLYS, s.frame < 800 ? 1505 : undefined);
      }
      if (s.frame > 800 && s.bscale > 4) {
        const M = matrixYXZ(3600 - s.rx / 3, 3600 - s.ry / 3, 3600 - s.rz / 3);
        B = this.planes(POINTSB, M, [s.bscale, s.bscale, s.bscale], [s.oxb, s.ypos + 1500 + s.oyb, 7500 + s.ozb], (c) => (c === 4 ? 1 : 0), EPOLYSB);
      }
      // 700..765 the board's palette fades out; 765..790 its rows are cleared
      // (invisible in the original: the palette is already black), here the
      // tiles dissolve with glowing edges; from 785 the red scheme.
      if (f > 700 && f < 790) boardL = Math.max(0, Math.min(1, (764 - f) / 64)) * 0.85 + 0.15;
      if (f > 765) wipe = 1500 * 213 / Math.max(1, 150 + (f - 765) * 2 + 1 - 130);
      if (f >= 792) board = 0;
      red = Math.max(0, Math.min(1, (f - 785) / 8));
      if (f > 2069) fade = 1 - s.palK / 64;
    }
    post.begin({ samples: 1 }); // one ray per pixel; MSAA would not help
    const z4 = new Float32Array(4);
    pr.use()
      .fv('uPA', A ? A.P : new Float32Array(100), 4).fv('uTA', A ? A.T : new Float32Array(25), 1).i('uNA', A ? A.n : 0)
      .fv('uPB', B ? B.P : new Float32Array(96), 4).fv('uTB', B ? B.T : new Float32Array(24), 1).i('uNB', B ? B.n : 0)
      .f('uSphA', ...(A ? A.sph : z4)).f('uSphB', ...(B ? B.sph : z4))
      .f('uH', H).f('uBoard', board).f('uWipeZ', wipe).f('uRed', red).f('uBoardL', boardL).f('uTime', t);
    R.drawFullscreen();
    post.end(t, { exposure: 1.0, bloom: 0.08, fade: [0, 0, 0, fade] });
    return true;
  },

  render(R, t) {
    const gl = R.gl;
    if (t < this.tZoomEnd) return this.renderZoom(R, t);
    if (t < this.t333) return this.renderBoard(R, t);
    this.renderGlenz(R, t);
  },

  renderZoom(R, t) {
    const gl = R.gl;
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const k = (t - this.ts) * FPS - 1;
    if (k < 0) { this.title.draw({ screen: [320, 400] }); return; }
    const i = Math.min(this.zoom.length - 1, Math.floor(k));
    const fr = k - i;
    const A = this.zoom[i], B = this.zoom[Math.min(this.zoom.length - 1, i + 1)];
    const zy = A.zy + (B.zy - A.zy) * fr, zy2 = A.zy2 + (B.zy2 - A.zy2) * fr;
    const c = Math.min(32, k) / 32;
    this.title.draw({ screen: [320, 400], mix: [30 / 63, 30 / 63, 30 / 63, c] });
    // curtains (palette entry 255 = black)
    R.scissorVGA(0, 0, 320, zy + 1, 320, 400); gl.clear(gl.COLOR_BUFFER_BIT);
    R.scissorVGA(0, 399 - zy2, 320, zy2 + 1, 320, 400); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  },

  drawBoardAt(R, y) {
    const y1 = 130 + y / 2, y2 = 130 + y * 3 / 2;
    if (y2 > y1) this.board.draw({ screen: [320, 200], dst: [0, y1, 320, y2], src: [0, 0, 320, 100] });
    this.board.draw({ screen: [320, 200], dst: [0, y2, 320, y2 + 8], src: [0, 100, 320, 108] });
  },

  renderBoard(R, t) {
    const gl = R.gl;
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const k = (t - this.tBounce) * FPS;
    if (k < 0) return;
    const n = this.bounce.length;
    let y;
    if (k >= n - 1) y = this.bounce[n - 1];
    else { const i = Math.floor(k); y = this.bounce[i] + (this.bounce[i + 1] - this.bounce[i]) * (k - i); }
    R.scissorVGA(0, 0, 320, 200);
    this.drawBoardAt(R, y);
    gl.disable(gl.SCISSOR_TEST);
  },

  renderGlenz(R, t) {
    const gl = R.gl;
    const f = (t - this.t333) * FPS;
    const s = this.lerpState(f);
    const T = R.sceneTarget();
    R.bindTarget(T);
    gl.clearColor(0, 0, 0, 1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    // --- geometry ---
    const tri1 = [], tri2 = [];
    const back = s.palSet === 'red' || s.redPal ? this.backRed : this.back0;
    if (s.xscale > 4) {
      const M = matrixYXZ(s.rx, s.ry, s.rz);
      const P = this.project(POINTS1, M, [s.xscale, s.yscale, s.zscale], [s.oxp, s.ypos + 1500 + s.oyp, 7500 + s.ozp], s.frame < 800);
      EPOLYS.forEach(([c, a, b, d], id) => {
        const p0 = P[a], p1 = P[b], p2 = P[d];
        const area = (p0[0] - p1[0]) * (p0[1] - p2[1]) - (p0[1] - p1[1]) * (p0[0] - p2[0]);
        const vis = area >= 0;
        let base = null;
        if (vis) {
          let v = s.lightshift === 9 ? Math.floor(area / 128) : Math.floor(area / 256) * 1.5;
          v = Math.max(0, Math.min(63, v));
          base = (c & 2) ? [s.lightshift === 9 ? 7 : 10, Math.floor(v / 2), v] : [v, v, v];
        }
        tri1.push({ pts: [p0, p1, p2], vis, id, base, bit: ((c >> 1) & 1) << 2 });
      });
    }
    if (s.frame > 800 && s.bscale > 4) {
      const M = matrixYXZ(3600 - s.rx / 3, 3600 - s.ry / 3, 3600 - s.rz / 3);
      const P = this.project(POINTSB, M, [s.bscale, s.bscale, s.bscale], [s.oxb, s.ypos + 1500 + s.oyb, 7500 + s.ozb], false);
      EPOLYSB.forEach(([c, a, b, d]) => {
        const p0 = P[a], p1 = P[b], p2 = P[d];
        const area = (p0[0] - p1[0]) * (p0[1] - p2[1]) - (p0[1] - p1[1]) * (p0[0] - p2[0]);
        const vis = area >= 0;
        tri2.push({ pts: [p0, p1, p2], bit: vis ? ((c >> 1) & 1) : c });
      });
    }
    const draw = (tri) => {
      const d = new Float32Array([tri.pts[0][0], tri.pts[0][1], tri.pts[1][0], tri.pts[1][1], tri.pts[2][0], tri.pts[2][1]]);
      gl.bufferData(gl.ARRAY_BUFFER, d, gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const prog = this.prog.use();
    // --- stencil: XOR low bits, REPLACE front id ---
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    for (const tr of tri1) if (!tr.vis && tr.bit) { gl.stencilMask(tr.bit); draw(tr); }
    for (const tr of tri2) if (tr.bit & 7) { gl.stencilMask(tr.bit & 7); draw(tr); }
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.stencilMask(0xf8);
    for (const tr of tri1) if (tr.vis) { gl.stencilFunc(gl.ALWAYS, (tr.id + 1) << 3, 0xff); draw(tr); }
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    // --- colour passes ---
    const pal = new Float32Array(48), bk = new Float32Array(48);
    for (let a = 0; a < 16; a++) for (let k = 0; k < 3; k++) {
      pal[a * 3 + k] = Math.trunc(back[a][k] * s.palK / 64) / 63;
      bk[a * 3 + k] = back[a][k];
    }
    prog.tex('uBg', this.bgTex).fv('uPal', pal, 3).fv('uBack', bk, 3).f('uVp', 0, 0, T.w, T.h).i('uClearTo', s.clearTo || 0);
    const full = { pts: [[-400, -400], [1200, -400], [-400, 1200]] };
    prog.i('uFront', 0).f('uBase', 0, 0, 0);
    for (let L = 0; L < 8; L++) { gl.stencilFunc(gl.EQUAL, L, 0xff); prog.i('uL', L); draw(full); }
    prog.i('uFront', 1);
    for (const tr of tri1) {
      if (!tr.vis) continue;
      prog.f('uBase', ...tr.base);
      for (let L = 0; L < 8; L++) { gl.stencilFunc(gl.EQUAL, ((tr.id + 1) << 3) | L, 0xff); prog.i('uL', L); draw(tr); }
    }
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.bindVertexArray(null);
    R.present(T);
  },
};
