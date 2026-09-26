"""Decode VISU animation stream (U2A.C main loop) into per-frame states."""
import fcdata as fc


def lsget(sp, d, f):
    f &= 3
    if f == 0:
        return 0, sp
    if f == 1:
        v = d[sp]
        return (v - 256 if v > 127 else v), sp + 1
    if f == 2:
        v = d[sp] | (d[sp + 1] << 8)
        return (v - 65536 if v > 32767 else v), sp + 2
    v = d[sp] | (d[sp + 1] << 8) | (d[sp + 2] << 16) | (d[sp + 3] << 24)
    return (v - (1 << 32) if v >= 1 << 31 else v), sp + 4


def decode(d, conum):
    """Returns list of frames; each frame = (fov, [(on, m9, pos3) per object])."""
    sp = 0
    on = [0] * conum
    mats = [[0] * 9 for _ in range(conum)]
    pos = [[0, 0, 0] for _ in range(conum)]
    fov = 0
    frames = []
    while True:
        onum = 0
        end = False
        while True:
            a = d[sp]; sp += 1
            if a == 0xff:
                a = d[sp]; sp += 1
                if a <= 0x7f:
                    fov = a << 8
                    break
                elif a == 0xff:
                    end = True
                    break
            if (a & 0xc0) == 0xc0:
                onum = (a & 0x3f) << 4
                a = d[sp]; sp += 1
            onum = (onum & 0xff0) | (a & 0xf)
            if (a & 0xc0) == 0x80:
                on[onum] = 1
            elif (a & 0xc0) == 0x40:
                on[onum] = 0
            pf = 0
            k = a & 0x30
            if k == 0x10:
                pf = d[sp]; sp += 1
            elif k == 0x20:
                pf = d[sp] | (d[sp + 1] << 8); sp += 2
            elif k == 0x30:
                pf = d[sp] | (d[sp + 1] << 8) | (d[sp + 2] << 16); sp += 3
            for i in range(3):
                l, sp = lsget(sp, d, pf >> (2 * i))
                pos[onum][i] += l
            wide = 2 if pf & 0x40 else 1
            for b in range(9):
                if pf & (0x80 << b):
                    l, sp = lsget(sp, d, wide)
                    mats[onum][b] += l
        if end:
            break
        frames.append((fov, [(on[i], list(mats[i]), list(pos[i])) for i in range(conum)]))
    return frames


if __name__ == '__main__':
    import sys
    import visu
    name = sys.argv[1]
    sc = visu.load_scene(name)
    d = fc.read('MAIN/DATA', sc['anims'][0])
    fr = decode(d, sc['conum'])
    print(name, 'frames', len(fr), 'bytes', len(d))
    for k in (0, 1, 100, len(fr) // 2, len(fr) - 1):
        fov, st = fr[k]
        print(k, 'fov', fov, [(i, s[0], s[2]) for i, s in enumerate(st) if s[0] or i == 0][:8])
        print('   cam m', st[0][1])
