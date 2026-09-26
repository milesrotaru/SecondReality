"""Readers for Future Crew's data formats used in Second Reality."""
import re
import struct
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.dirname(__file__))
import lbm  # noqa: E402


def path(*p):
    return os.path.join(ROOT, *p)


def read(*p):
    return open(path(*p), 'rb').read()


def parse_inc(fn, kind='db'):
    """Parse TASM 'db'/'dw' include files into a list of ints (bytes masked)."""
    vals = []
    txt = open(path(fn), 'rb').read().decode('latin1')
    for line in txt.splitlines():
        line = line.split(';')[0].strip()
        m = re.match(r'(?:[\w@]+\s+)?(db|dw|dd)\s+(.*)', line, re.I)
        if not m:
            continue
        k = m.group(1).lower()
        for v in m.group(2).split(','):
            v = v.strip()
            if not v:
                continue
            if 'dup' in v.lower():
                mm = re.match(r'(\d+)\s+dup\s*\((.*)\)', v, re.I)
                n = int(mm.group(1))
                inner = mm.group(2).strip()
                x = 0 if inner == '?' else int(inner)
                vals += [x] * n
                continue
            if v.startswith("'") or v.startswith('"'):
                vals += [ord(c) for c in v[1:-1]]
                continue
            if v.lower().endswith('h'):
                x = int(v[:-1], 16)
            else:
                x = int(v)
            if k == 'db':
                vals.append(x & 0xff)
            elif k == 'dw':
                vals.append(x & 0xffff if kind == 'raw' else x)
            else:
                vals.append(x)
    return vals


def inc_bytes(*files):
    out = []
    for f in files:
        out += [v & 0xff for v in parse_inc(f)]
    return bytes(out)


def read_u(data):
    """FC picture: 'fcfc' header (raw) or 'fdfc' (row RLE, READP.C) or 'Uh'.
    Returns (w, h, pix bytes, pal6 bytes[768])."""
    magic = data[:2]
    if magic == b'\xfc\xfc':
        w, h, cols, add = struct.unpack('<HHHH', data[2:10])
        pal = data[16:16 + cols * 3]
        pix = data[add * 16:add * 16 + w * h]
        return w, h, pix, pal.ljust(768, b'\0')
    if magic == b'\xfd\xfc':
        w, h, cols, add = struct.unpack('<HHHH', data[2:10])
        pal = data[16:16 + cols * 3]
        p = add * 16
        out = bytearray()
        for _ in range(h):
            n = struct.unpack('<H', data[p:p + 2])[0]
            p += 2
            end = p + n
            row = bytearray()
            while p < end:
                b = data[p]
                p += 1
                if b & 0x80:
                    c = data[p]
                    p += 1
                    row += bytes([c]) * (b & 0x7f)
                else:
                    row.append(b)
            out += row[:w].ljust(w, b'\0')
        return w, h, bytes(out), pal.ljust(768, b'\0')
    if magic == b'Uh':
        _, w, h, _ = struct.unpack('<HHHH', data[2:10])
        pal = data[16:16 + 768]
        pix = data[16 + 768:16 + 768 + w * h]
        return w, h, pix, pal
    raise ValueError('unknown picture format %r' % magic)


def read_lbm(fn):
    w, h, pix, pal = lbm.load(path(fn))
    pal6 = bytes(c >> 2 for rgb in pal[:256] for c in rgb)
    return w, h, pix, pal6


def save_png(fn, w, h, pix, pal6):
    from PIL import Image
    im = Image.frombytes('P', (w, h), bytes(pix))
    im.putpalette([min(255, c * 255 // 63) for c in pal6[:768]])
    im.save(fn)
