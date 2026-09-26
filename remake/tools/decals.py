"""Find coplanar overlapping polygons (decals) in VISU objects and assign
layers, so a z-buffered renderer keeps the painter's-algorithm result."""
import math


def plane(pts):
    nx = ny = nz = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1, z1 = pts[i]
        x2, y2, z2 = pts[(i + 1) % n]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    l = math.sqrt(nx * nx + ny * ny + nz * nz)
    if l < 1e-9:
        return None
    nx, ny, nz = nx / l, ny / l, nz / l
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    cz = sum(p[2] for p in pts) / n
    return (nx, ny, nz, nx * cx + ny * cy + nz * cz)


def proj2(pts, n):
    # 2D basis on the plane
    ax = (1, 0, 0) if abs(n[0]) < 0.9 else (0, 1, 0)
    u = (n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0])
    ul = math.sqrt(sum(c * c for c in u))
    u = tuple(c / ul for c in u)
    v = (n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0])
    return [(p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) for p in pts]


def poly_overlap(a, b):
    # separating axis test for convex 2D polygons (shrunk slightly)
    def axes(P):
        for i in range(len(P)):
            x1, y1 = P[i]
            x2, y2 = P[(i + 1) % len(P)]
            yield (y1 - y2, x2 - x1)
    for ax in list(axes(a)) + list(axes(b)):
        l = math.hypot(*ax)
        if l < 1e-9:
            continue
        pa = [(p[0] * ax[0] + p[1] * ax[1]) / l for p in a]
        pb = [(p[0] * ax[0] + p[1] * ax[1]) / l for p in b]
        if max(pa) <= min(pb) + 0.5 or max(pb) <= min(pa) + 0.5:
            return False
    return True


def layers(verts, polys, order):
    """verts: [(x,y,z)], polys: {key: [vertex indices]}, order: list of keys in
    painter order. Returns {key: layer}."""
    info = {}
    for k, vs in polys.items():
        pts = [verts[i] for i in vs]
        pl = plane(pts)
        info[k] = (pts, pl)
    pos = {k: i for i, k in enumerate(order)}
    keys = [k for k in order if info[k][1] is not None]
    above = {k: [] for k in keys}  # k -> polys directly below k
    for i, a in enumerate(keys):
        pa = info[a][1]
        for b in keys[i + 1:]:
            pb = info[b][1]
            dot = pa[0] * pb[0] + pa[1] * pb[1] + pa[2] * pb[2]
            if dot < 0.995:
                continue
            tol = 4 + 0.002 * abs(pa[3])
            if abs(pa[3] - pb[3]) > tol:
                continue
            A = proj2(info[a][0], pa[:3])
            B = proj2(info[b][0], pa[:3])
            if poly_overlap(A, B):
                # b later in painter order -> b on top of a
                above[b].append(a)
    layer = {}

    def L(k, depth=0):
        if k in layer:
            return layer[k]
        if depth > 50:
            return 0
        v = 0
        for b in above.get(k, []):
            v = max(v, L(b, depth + 1) + 1)
        layer[k] = v
        return v
    for k in polys:
        L(k)
    return layer
