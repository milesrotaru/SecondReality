"""Per-part asset extraction. Each function takes the Pack and adds entries."""
import struct
import fcdata as fc


def alku(pk):
    # Horizon picture as linked into ALKU.EXE (HOI.IN0/1 - text colours 1..3
    # differ from HOI.U on disk).
    data = fc.inc_bytes('ALKU/HOI.IN0', 'ALKU/HOI.IN1')
    w, h, pix, pal = fc.read_u(data)
    pk.pic('alku.hoi', w, h, pix, pal)
    font = bytes(v & 3 for v in fc.parse_inc('ALKU/FONA.INC')[:1500 * 30])
    pk.add('alku.font', font, type='u8', w=1500, h=30)
    # glyph table exactly like init() in ALKU/MAIN.C
    # byte-exact copy of fonaorder from ALKU/MAIN.C (0x8f = Dolby logo, 0x99 = small print)
    order = "ABCDEFGHIJKLMNOPQRSTUVWXabcdefghijklmnopqrstuvwxyz0123456789!?,.:\x8f\x8f()+-*='\x8f\x99"
    glyphs = {}
    x = 0
    for ch in order:
        while x < 1500 and not any(font[y * 1500 + x] for y in range(30)):
            x += 1
        b = x
        while x < 1500 and any(font[y * 1500 + x] for y in range(30)):
            x += 1
        glyphs[str(ord(ch))] = [b, x - b]
    glyphs['32'] = [1500 - 20, 16]
    pk.json('alku.glyphs', glyphs)


ALL = [alku]


def visu_scene(pk, name):
    import visu
    sc = visu.load_scene(name)
    objs = {}
    for i in sorted(set(sc['index'][1:])):
        o = visu.load_object(fc.read('MAIN/DATA', '%s.%03d' % (name, i)))
        offs = [off for off in o['lists'][0]['polys'] if not o['polys'][off]['hidden']]
        pidx = {off: k for k, off in enumerate(offs)}
        polys = []
        for off in offs:
            p = o['polys'][off]
            polys.append([p['flags'], p['color'], p['normal']] + p['v'])
        # directional painter's lists (ORDE), as indices into polys
        lists = []
        for L in o['lists'][1:] or o['lists'][:1]:
            lists.append([L['sortv'], [pidx[off] for off in L['polys'] if off in pidx]])
        objs[i] = dict(name=o['name'], v=[c for v in o['verts'] for c in v[:3]], vn=[v[3] for v in o['verts']],
                       n=[c for n in o['norms'] for c in n], nnum1=o['nnum1'], p=polys, lists=lists)
    key = name.lower()
    pk.json(key + '.scene', dict(conum=sc['conum'], index=sc['index'], objs=objs))
    pk.add(key + '.pal', sc['pal'])
    pk.add(key + '.anim', fc.read('MAIN/DATA', sc['anims'][0]))


def u2a(pk):
    visu_scene(pk, 'U2A')


def u2e(pk):
    visu_scene(pk, 'U2E')


ALL += [u2a, u2e]


def pam(pk):
    """Praxis explosion flic (OUT.ANI via OUT.IN0-4) + palette + the LUT that
    maps horizon-picture indices to the flic's quantised background, used to
    extract the explosion layer for compositing over the HD landscape."""
    from collections import Counter, defaultdict
    d = fc.inc_bytes('PAM/OUT.IN0', 'PAM/OUT.IN1', 'PAM/OUT.IN2', 'PAM/OUT.IN3', 'PAM/OUT.IN4')
    pk.add('pam.anim', d)
    pal = bytes(fc.parse_inc('PAM/PAL.INC')[:768])
    pk.add('pam.pal', pal)
    # frame 0 to learn the LUT
    page = bytearray(64000)
    si, di = 0, 0
    while True:
        al = d[si] - 256 if d[si] > 127 else d[si]
        si += 1
        if al < 0:
            di += -al
            continue
        if al == 0:
            break
        page[di:di + al] = bytes([d[si]]) * al
        si += 1
        di += al
    hw, hh, hp, hpal = fc.read_u(fc.inc_bytes('ALKU/HOI.IN0', 'ALKU/HOI.IN1'))
    m = defaultdict(Counter)
    for y in range(25, 175):
        for x in range(320):
            m[hp[(y - 25) * 640 + 320 + x]][page[y * 320 + x]] += 1
    lut = bytearray(256)
    for k, c in m.items():
        lut[k] = c.most_common(1)[0][0]
    pk.add('pam.lut', bytes(lut))


ALL += [pam]


def beg(pk):
    w, h, pix, pal = fc.read_u(fc.read('BEG', 'SRTITLE.UP'))
    pk.pic('beg.title', w, h, pix, pal)


def glenz(pk):
    import omf
    sd, segs, pubs = omf.parse(fc.path('GLENZ', '_FC.OBK'))
    w, h, pix, pal = fc.read_u(bytes(segs[1]))
    pk.pic('glenz.fc', w, h, pix, pal)
    sin = fc.parse_inc('GLENZ/SIN1024.INC')
    pk.add('sin1024', struct.pack('<1024h', *[(v - 65536 if v > 32767 else v) for v in sin[:1024]]))


ALL += [beg, glenz]


def tunneli(pk):
    s = fc.read('TUNNELI', 'SINIT.DAT')
    pk.add('tunneli.sinit', s[:4097 * 2])
    pk.add('tunneli.cosit', s[4097 * 2:4097 * 2 + 2049 * 2])


ALL += [tunneli]


def techno(pk):
    """Interference ring profiles (from the quadrant bitmaps _CIRCLE/_CIRCLE2)
    as boundary radii, and the troll picture."""
    import omf
    import math
    sd, segs, pubs = omf.parse(fc.path('TECHNO', '_CIRCLE.OBK'))
    c1 = bytes(segs[1])
    sd, segs, pubs = omf.parse(fc.path('TECHNO', '_CIRCLE2.OBK'))
    c2 = bytes(segs[1])

    def px1(x, y):
        v = 0
        for p in range(3):
            b = c1[(y * 3 + p) * 40 + (x >> 3)]
            if b & (0x80 >> (x & 7)):
                v |= 1 << p
        return v

    def px2(x, y):
        return 1 if c2[y * 40 + (x >> 3)] & (0x80 >> (x & 7)) else 0

    def boundaries(pix, mod, samples):
        # walk outward along several rays, unwrap the ring index, and average
        # the radius at which each unwrapped index starts
        acc = {}
        for ang in samples:
            last = None
            n = 0
            r = 0.0
            while True:
                x = 319.5 - r * math.cos(ang)
                y = 199.5 - r * math.sin(ang)
                xi, yi = int(math.floor(x)), int(math.floor(y))
                if xi < 0 or yi < 0 or xi > 319 or yi > 199:
                    break
                v = pix(xi, yi)
                if last is not None and v != last:
                    n += (v - last) % mod
                    acc.setdefault(n, []).append(r)
                last = v
                r += 0.25
        out = []
        for k in sorted(acc):
            if len(acc[k]) >= 2:
                out.append(sum(acc[k]) / len(acc[k]))
        return out
    rays = [i * (math.pi / 2) / 24 for i in range(25)]
    b1 = boundaries(px1, 8, rays)
    b2 = boundaries(px2, 2, rays)
    pk.json('techno.rings', dict(r1=[round(v, 3) for v in b1], r2=[round(v, 3) for v in b2]))
    w, h, pix, pal = fc.read_u(fc.read('TECHNO', 'TROLL.UP'))
    pk.pic('techno.troll', w, h, pix, pal)


ALL += [techno]


def mntscrl(pk):
    """Hill picture (HILLBACK.CLX), scroll font (O2.SCI) and the text surface
    map reconstructed from POS1..3.DAT: per screen pixel the font-space
    coordinate s (u + phase/3) and row v."""
    import array
    hb = fc.read('FOREST', 'HILLBACK.CLX')
    pk.pic('mnt.bg', 320, 200, hb[778:778 + 64000], hb[10:778])
    o2 = fc.read('FOREST', 'O2.SCI')
    fbuf = bytearray()
    for x in range(31):
        fbuf += o2[x * 640 + 778:x * 640 + 778 + 640]
    pk.add('mnt.font', bytes(fbuf), w=640, h=31)
    ssum = [0.0] * 64000
    vsum = [0.0] * 64000
    cnt = [0] * 64000
    for k, fn in enumerate(('POS1.DAT', 'POS2.DAT', 'POS3.DAT')):
        d = fc.read('FOREST', fn)
        p = 0
        for i in range(237 * 31):
            c = struct.unpack('<H', d[p:p + 2])[0]
            p += 2
            u, v = i % 237, i // 237
            for j in range(c):
                di = struct.unpack('<H', d[p:p + 2])[0]
                p += 2
                if di < 64000:
                    ssum[di] += u
                    vsum[di] += v
                    cnt[di] += 1
    out = array.array('f', [0.0] * (64000 * 4))
    for i in range(64000):
        if cnt[i]:
            out[i * 4] = ssum[i] / cnt[i]
            out[i * 4 + 1] = vsum[i] / cnt[i]
            out[i * 4 + 2] = 1.0
            out[i * 4 + 3] = cnt[i]
    pk.add('mnt.uv', out.tobytes())


ALL += [mntscrl]


def lens(pk):
    """LNS&ZOOM (Psi): the face picture (LENS.EXB, linked PIC with the
    palette at +16 and pixels at 784), the lens region mask (LENS.U, top-left
    152x116: 1 glass, 2 highlight arc, 3 bright spot, 4 restore rim) and the
    precomputed paths (LENS.EXP: 715 lens positions, then 2000 rotozoom
    (x, y, xa, ya) frames)."""
    b = fc.read('LENS', 'LENS.EXB')
    pk.pic('lens.back', 320, 200, b[784:784 + 64000], b[16:16 + 768])
    u = fc.read('LENS', 'LENS.U')
    ex0 = fc.read('LENS', 'LENS.EX0')
    w, h = struct.unpack('<hh', ex0[:4])
    m = bytearray()
    for y in range(h):
        m += u[y * 320:y * 320 + w]
    pk.add('lens.mask', bytes(m), w=w, h=h, tints=list(ex0[4:13]))
    p = fc.read('LENS', 'LENS.EXP')
    n1 = struct.unpack('<h', p[2:4])[0]
    pk.add('lens.path1', p[4:4 + n1 * 2], type='i16')
    pk.add('lens.path2', p[4 + n1 * 2:], type='i16')


ALL += [lens]


def plz(pk):
    """PLZPART (Wildfire): plasma-cube spline path (RATA.INC, 8 words per key:
    tx, ty, dis, kx, ky, kz, light kx, light ky; with kkk=100 and a REPT) and
    the spline basis table (SPLINE.INC, 4 x 256 words scaled by 32768)."""
    import re
    txt = open(fc.path('PLZPART', 'RATA.INC'), 'rb').read().decode('latin1')
    env = {}
    vals = []
    lines = [ln.split(';')[0].strip() for ln in txt.splitlines()]
    i = 0
    while i < len(lines):
        ln = lines[i]
        m = re.match(r'(\w+)\s*=\s*(.+)', ln)
        if m and not ln.lower().startswith('dw'):
            env[m.group(1)] = eval(m.group(2), {}, env)
        elif ln.upper().startswith('REPT'):
            n = int(ln.split()[1])
            body = []
            i += 1
            while not lines[i].upper().startswith('ENDM'):
                body.append(lines[i])
                i += 1
            for _ in range(n):
                for b in body:
                    vals += [int(eval(v, {}, env)) for v in b[2:].split(',')]
        elif ln.lower().startswith('dw'):
            vals += [int(eval(v, {}, env)) for v in ln[2:].split(',')]
        i += 1
    assert len(vals) % 8 == 0
    pk.add('plz.rata', struct.pack('<%dh' % len(vals), *vals), type='i16')
    sp = fc.parse_inc('PLZPART/SPLINE.INC')
    assert len(sp) == 1024
    pk.add('plz.spline', struct.pack('<1024h', *sp), type='i16')


ALL += [plz]


def rayscrl(pk):
    """RAYSCRL (Trug): raytraced background (BKG.CLX), the fire+sword strip
    (MIEKKA.SCI, 400x34, its palette is used for the whole screen) and the
    texel->pixel scatter tables WAT1..3.DAT inverted into a per-pixel map of
    the 158x34 scroll buffer coordinate. The newest column is written at
    buffer column 0 of the next row, so (r, 0) is remapped to (r-1, 158)."""
    import array
    bg = fc.read('WATER', 'BKG.CLX')
    mk = fc.read('WATER', 'MIEKKA.SCI')
    pal = mk[10:778]
    pk.pic('ray.bg', 320, 200, bg[778:778 + 64000], pal)
    pk.add('ray.font', mk[778:778 + 400 * 34], w=400, h=34)
    out = array.array('f', [0.0] * (64000 * 4))
    for fn in ('WAT1.DAT', 'WAT2.DAT', 'WAT3.DAT'):
        d = fc.read('WATER', fn)
        p = 0
        for i in range(158 * 34):
            c = struct.unpack('<H', d[p:p + 2])[0]
            p += 2
            r, u = divmod(i, 158)
            if u == 0:
                r, u = r - 1, 158
            for _ in range(c):
                o = struct.unpack('<H', d[p:p + 2])[0]
                p += 2
                if o < 64000 and r >= 0:
                    out[o * 4:o * 4 + 4] = array.array('f', [u, r, 1.0, 0.0])
    pk.add('ray.uv', out.tobytes())


ALL += [rayscrl]


def coman(pk):
    """3DSINFLD (Psi): the two 32768-entry height waves of the voxel
    landscape (W1DTA.BIN, W2DTA.BIN; terrain = w1[x] + w2[y])."""
    pk.add('coman.w1', fc.read('COMAN', 'W1DTA.BIN'), type='i16')
    pk.add('coman.w2', fc.read('COMAN', 'W2DTA.BIN'), type='i16')


ALL += [coman]
