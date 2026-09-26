#!/usr/bin/env python3
"""Extract Second Reality's original data into a single deflated asset pack
(build/assets.pack) that the HD remake loads at startup.

Pack layout (before zlib): u32 json_len | json manifest | blob data.
Manifest entries: name -> {off, len, type, ...meta}.
"""
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
import fcdata as fc  # noqa: E402
import parts_assets  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', 'build')


class Pack:
    def __init__(self):
        self.entries = {}
        self.blob = bytearray()

    def add(self, name, data, type='u8', **meta):
        if isinstance(data, (list, tuple)):
            data = bytes(data)
        while len(self.blob) % 8:
            self.blob.append(0)
        self.entries[name] = dict(off=len(self.blob), len=len(data), type=type, **meta)
        self.blob += data

    def json(self, name, obj):
        self.entries[name] = dict(type='json', value=obj)

    def pic(self, name, w, h, pix, pal6):
        self.add(name, bytes(pix), type='pic', w=w, h=h)
        self.add(name + '.pal', bytes(pal6[:768]).ljust(768, b'\0'), type='u8')

    def write(self, fn):
        man = json.dumps(self.entries, separators=(',', ':')).encode()
        raw = struct.pack('<I', len(man)) + man + bytes(self.blob)
        comp = zlib.compress(raw, 9)
        os.makedirs(os.path.dirname(fn), exist_ok=True)
        open(fn, 'wb').write(comp)
        return len(raw), len(comp)


def main():
    pk = Pack()
    pk.add('music0', fc.read('MAIN', 'MUSIC0.S3M'))
    pk.add('music1', fc.read('MAIN', 'MUSIC1.S3M'))
    for fn in parts_assets.ALL:
        fn(pk)
    raw, comp = pk.write(os.path.join(OUT, 'assets.pack'))
    print('assets: %d entries, %.1f KB raw, %.1f KB deflated' % (len(pk.entries), raw / 1024, comp / 1024))


if __name__ == '__main__':
    main()
