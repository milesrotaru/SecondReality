// Asset pack loader: zlib-deflated [u32 manifest length][json manifest][blobs]

export async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class Assets {
  constructor(raw) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const n = dv.getUint32(0, true);
    this.man = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + n)));
    this.data = raw.subarray(4 + n);
  }
  has(name) { return name in this.man; }
  meta(name) {
    const e = this.man[name];
    if (!e) throw new Error('missing asset ' + name);
    return e;
  }
  bytes(name) {
    const e = this.meta(name);
    return this.data.subarray(e.off, e.off + e.len);
  }
  buffer(name) {
    const b = this.bytes(name);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  json(name) { return this.meta(name).value; }
  i16(name) { const b = this.bytes(name); return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  u16(name) { const b = this.bytes(name); return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  i32(name) { const b = this.bytes(name); return new Int32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  f32(name) { const b = this.bytes(name); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  // indexed picture: {w, h, pix: Uint8Array, pal: Uint8Array(768, 6-bit)}
  pic(name) {
    const e = this.meta(name);
    return { w: e.w, h: e.h, pix: this.bytes(name), pal: this.bytes(name + '.pal') };
  }
}
