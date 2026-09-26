"""Deluxe Paint IFF decoder (ILBM planar and PBM chunky, ByteRun1).

Returns (width, height, indices: bytes, palette: list of (r,g,b) 0..255).
"""
import struct
import sys


def _byterun1(data, pos, out_len):
    out = bytearray()
    while len(out) < out_len:
        n = data[pos]
        pos += 1
        if n < 128:
            out += data[pos:pos + n + 1]
            pos += n + 1
        elif n > 128:
            out += bytes([data[pos]]) * (257 - n)
            pos += 1
    return bytes(out[:out_len]), pos


def load(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'FORM'
    kind = d[8:12]
    p = 12
    w = h = planes = comp = masking = 0
    pal = None
    body = None
    while p < len(d) - 8:
        cid = d[p:p + 4]
        ln = struct.unpack('>I', d[p + 4:p + 8])[0]
        cdat = d[p + 8:p + 8 + ln]
        if cid == b'BMHD':
            w, h, _, _, planes, masking, comp = struct.unpack('>HHhhBBB', cdat[:11])
        elif cid == b'CMAP':
            pal = [tuple(cdat[i:i + 3]) for i in range(0, len(cdat) - 2, 3)]
        elif cid == b'BODY':
            body = cdat
        p += 8 + ln + (ln & 1)
    pix = bytearray(w * h)
    if kind == b'PBM ':
        rowlen = w + (w & 1)
        pos = 0
        for y in range(h):
            if comp:
                row, pos = _byterun1(body, pos, rowlen)
            else:
                row = body[pos:pos + rowlen]
                pos += rowlen
            pix[y * w:(y + 1) * w] = row[:w]
    else:
        rowbytes = ((w + 15) // 16) * 2
        nplanes = planes + (1 if masking == 1 else 0)
        pos = 0
        for y in range(h):
            rowv = [0] * w
            for pl in range(nplanes):
                if comp:
                    row, pos = _byterun1(body, pos, rowbytes)
                else:
                    row = body[pos:pos + rowbytes]
                    pos += rowbytes
                if pl >= planes:
                    continue
                bit = 1 << pl
                for x in range(w):
                    if row[x >> 3] & (0x80 >> (x & 7)):
                        rowv[x] |= bit
            pix[y * w:(y + 1) * w] = bytes(rowv)
    if pal is None:
        pal = [(i, i, i) for i in range(256)]
    while len(pal) < 256:
        pal.append((0, 0, 0))
    return w, h, bytes(pix), pal


def to_image(path):
    from PIL import Image
    w, h, pix, pal = load(path)
    im = Image.frombytes('P', (w, h), pix)
    flat = []
    for c in pal[:256]:
        flat += list(c)
    im.putpalette(flat)
    return im


if __name__ == '__main__':
    for f in sys.argv[1:-1]:
        pass
    src, dst = sys.argv[1], sys.argv[2]
    to_image(src).save(dst)
