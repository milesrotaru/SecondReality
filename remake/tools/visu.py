"""VISU 3D object/scene reader (VISU/VISU.C + CD.H formats)."""
import struct
import fcdata as fc


def load_object(data):
    p = 0
    o = {'lists': []}
    while p < len(data):
        tag = data[p:p + 4]
        ln = struct.unpack('<I', data[p + 4:p + 8])[0]
        d = data[p + 8:p + 8 + ln]
        if tag == b'END ':
            break
        if tag == b'NAME':
            o['name'] = d.split(b'\0')[0].decode('latin1').strip('"')
        elif tag == b'VERT':
            n = struct.unpack('<h', d[:2])[0]
            vs = []
            for i in range(n):
                x, y, z, nrm, _ = struct.unpack('<iiihh', d[4 + i * 16:4 + i * 16 + 16])
                vs.append((x, y, z, nrm))
            o['verts'] = vs
        elif tag == b'NORM':
            n, n1 = struct.unpack('<hh', d[:4])
            ns = [struct.unpack('<hhh', d[4 + i * 8:4 + i * 8 + 6]) for i in range(n)]
            o['norms'] = ns
            o['nnum1'] = n1
        elif tag == b'POLY':
            o['pd'] = d
        elif tag[:3] == b'ORD':
            cnt = struct.unpack('<h', d[:2])[0]
            words = struct.unpack('<%dh' % cnt, d[:cnt * 2])
            o['lists'].append({'kind': chr(tag[3]), 'sortv': words[1], 'polys': [w & 0xffff for w in words[2:] if w != 0]})
        p += 8 + ln
    # decode polygons referenced by any list
    pd = o['pd']
    polys = {}
    for L in o['lists']:
        for off in L['polys']:
            if off in polys:
                continue
            sides, flags, color, res, normal = struct.unpack('<BBBBh', pd[off:off + 6])
            vs = struct.unpack('<%dh' % sides, pd[off + 6:off + 6 + 2 * sides])
            polys[off] = dict(sides=sides, flags=flags << 8, color=color, hidden=(color == 0xff and res == 0xff), normal=normal, v=list(vs))
    o['polys'] = polys
    return o


def load_scene(name, root='MAIN/DATA'):
    m = fc.read(root, name + '.00M')
    off = struct.unpack('<I', m[4:8])[0]
    conum = struct.unpack('<h', m[off:off + 2])[0]
    idx = list(struct.unpack('<%dh' % conum, m[off:off + 2 * conum]))
    pal = m[16:16 + 768]
    aa = fc.read(root, name + '.0AA')
    anims = []
    for i in range(0, len(aa) - 1, 4):
        a = struct.unpack('<h', aa[i:i + 2])[0]
        if a == 0 or a == -1:
            break
        anims.append('%s.0%c%c' % (name, chr(a // 10 + 65), chr(a % 10 + 65)))
    return dict(conum=conum, index=idx, pal=pal, anims=anims, city=chr(m[15]) if m[15] else '')


if __name__ == '__main__':
    import sys
    name = sys.argv[1]
    sc = load_scene(name)
    print(sc['conum'], sc['index'], sc['anims'], repr(sc['city']))
    seen = set()
    for i in sc['index'][1:]:
        if i in seen:
            continue
        seen.add(i)
        o = load_object(fc.read('MAIN/DATA', '%s.%03d' % (name, i)))
        fl = {}
        for pp in o['polys'].values():
            fl[hex(pp['flags'])] = fl.get(hex(pp['flags']), 0) + 1
        cols = sorted(set(pp['color'] for pp in o['polys'].values()))
        print(i, o['name'], 'v', len(o['verts']), 'n', len(o['norms']), o['nnum1'], 'p', len(o['polys']), 'lists', [(L['kind'], L['sortv'], len(L['polys'])) for L in o['lists']][:3], fl, cols)
