import { parseS3M, S3MPlayer, buildTimeline, musplus } from '../src/audio/s3m.js';
import fs from 'fs';
const [,, file, order, secs, out, tempo] = process.argv;
const buf = fs.readFileSync(file);
const mod = parseS3M(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
if (tempo) mod.initTempo = +tempo;
const rate = 44100;
const t0 = Date.now();
const tl = buildTimeline(mod, +order, rate, +secs);
console.log('timeline rows', tl.time.length, 'end', tl.end.toFixed(2), 'ms', Date.now() - t0);
const p = new S3MPlayer(mod, rate);
p.play(+order);
const n = Math.min(Math.round(+secs * rate), Math.round(tl.end * rate));
const L = new Float32Array(n), R = new Float32Array(n);
const t1 = Date.now();
p.render(L, R, 0, n);
console.log('render ms', Date.now() - t1, 'for', (n / rate).toFixed(1), 's');
let peak = 0, rms = 0;
for (let i = 0; i < n; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); rms += L[i] * L[i] + R[i] * R[i]; }
console.log('peak', peak.toFixed(3), 'rms', Math.sqrt(rms / (2 * n)).toFixed(4));
const wav = Buffer.alloc(44 + n * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
  wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
}
fs.writeFileSync(out, wav);
// print order change times + plus markers
let last = -1;
for (let i = 0; i < tl.time.length; i++) {
  if (tl.ord[i] !== last) { process.stdout.write(`[${tl.time[i].toFixed(2)} o${tl.ord[i]} z${tl.zplus[i]}] `); last = tl.ord[i]; }
}
console.log();
