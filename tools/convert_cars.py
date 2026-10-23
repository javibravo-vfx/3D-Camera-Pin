import json, struct, io, sys
import numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
L = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + L])
off = 20 + L; BL = struct.unpack('<I', b[off:off + 4])[0]; BIN = b[off + 8:off + 8 + BL]
CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
def acc(i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); n = NC[a['type']]; dt = CT[a['componentType']]
    stride = bv.get('byteStride', 0); isz = np.dtype(dt).itemsize * n
    if stride and stride != isz:
        raw = np.frombuffer(BIN, np.uint8, count=stride * a['count'], offset=o).reshape(a['count'], stride)[:, :isz].copy()
        return raw.view(dt).reshape(a['count'], n)
    return np.frombuffer(BIN, dt, count=a['count'] * n, offset=o).reshape(a['count'], n).copy()
texcache = {}
def tex(ti):
    if ti not in texcache:
        im = j['images'][j['textures'][ti]['source']]; bv = j['bufferViews'][im['bufferView']]
        o = bv.get('byteOffset', 0)
        texcache[ti] = np.asarray(Image.open(io.BytesIO(BIN[o:o + bv['byteLength']])).convert('RGB').resize((512, 512), Image.BILINEAR), np.float32) / 255
    return texcache[ti]
def sample(ti, uv):
    t = tex(ti); h, w = t.shape[:2]
    u = np.mod(uv[:, 0], 1); v = np.mod(uv[:, 1], 1)
    return t[np.clip((v * h).astype(int), 0, h - 1), np.clip((u * w).astype(int), 0, w - 1)]
# world matrices
nodes = j['nodes']; W = {}
def walk(i, M):
    n = nodes[i]
    m = np.array(n['matrix'], np.float64).reshape(4, 4).T if 'matrix' in n else np.eye(4)
    W[i] = M @ m
    for c in n.get('children', []): walk(c, W[i])
for r in j['scenes'][0]['nodes']: walk(r, np.eye(4))
def meshes_under(i):
    out = []
    def rec(k):
        if 'mesh' in nodes[k]: out.append(k)
        for c in nodes[k].get('children', []): rec(c)
    rec(i); return out
bodies = {n['name'].split()[0].lower(): i for i, n in enumerate(nodes) if n.get('name', '').lower().endswith(' body')}
wheels = [i for i, n in enumerate(nodes) if n.get('name', '').startswith('Wheel') and 'mesh' not in n]
centers = {k: W[i][:3, 3] for k, i in bodies.items()}
wheel_of = {k: [] for k in bodies}
for wi in wheels:
    p = W[wi][:3, 3]; k = min(centers, key=lambda k: np.linalg.norm(centers[k] - p)); wheel_of[k].append(wi)
PAINT = {'compact': (0, 255, 255), 'coupe': (0, 70, 233), 'hatchback': (255, 255, 0), 'minivan': (95, 0, 0), 'pickup': (6, 82, 39),
         'sedan': (159, 141, 46), 'wagon': (96, 151, 161), 'suv': None, 'offroad': None, 'sport': (254, 0, 0)}
SKIP = {'sport'}
def prim_data(ni):
    mesh = j['meshes'][nodes[ni]['mesh']]; out = []
    for p in mesh['primitives']:
        P = acc(p['attributes']['POSITION']).astype(np.float64); N = acc(p['attributes']['NORMAL']).astype(np.float64)
        UV = acc(p['attributes']['TEXCOORD_0']).astype(np.float64)
        I = acc(p['indices']).reshape(-1).astype(np.int64) if 'indices' in p else np.arange(len(P))
        M = W[ni]; P = (np.c_[P, np.ones(len(P))] @ M.T)[:, :3]
        Nm = np.linalg.inv(M[:3, :3]).T; N = N @ Nm.T; N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
        mat = j['materials'][p['material']]; pbr = mat.get('pbrMetallicRoughness', {})
        out.append(dict(P=P, N=N, UV=UV, I=I, mat=mat, tex=pbr.get('baseColorTexture', {}).get('index'), col=pbr.get('baseColorFactor')))
    return out
parts_all = {}
for k, bi in bodies.items():
    if k in SKIP: continue
    # yaw of the car from the body's world X axis projected to the ground
    groups = {'paint': [], 'trim': [], 'wheel': [], 'glass': [], 'optics': []}
    allP = []
    for ni in meshes_under(bi) + [m for wi in wheel_of[k] for m in meshes_under(wi)]:
        nm = nodes[ni]['name']
        for d in prim_data(ni):
            allP.append(d['P'])
            matname = d['mat']['name'].lower()
            if 'glass' in matname: groups['glass'].append((d, None)); continue
            C = sample(d['tex'], d['UV']) if d['tex'] is not None else np.tile(np.array(d['col'][:3] if d['col'] else [0.5] * 3), (len(d['P']), 1))
            if 'optics' in matname: groups['optics'].append((d, C)); continue
            if 'wheel' in nm.lower() and not matname.startswith('body'): groups['wheel'].append((d, C)); continue
            pc = PAINT[k]
            if pc is None: groups['trim'].append((d, C)); continue
            pc = np.array(pc, np.float64) / 255
            lum = lambda c: c @ np.array([0.2126, 0.7152, 0.0722])
            dirc = pc / np.linalg.norm(pc); cn = C / (np.linalg.norm(C, axis=1, keepdims=True) + 1e-6)
            sat = C.max(1) - C.min(1)
            isp = (cn @ dirc > 0.94) & (sat > 0.035)
            T = d['I'].reshape(-1, 3); tp = isp[T].sum(1) >= 2
            fac = np.clip(lum(C) / lum(pc), 0.05, 1.25)
            for sel, g in ((tp, 'paint'), (~tp, 'trim')):
                if sel.any():
                    dd = dict(d); dd['I'] = T[sel].reshape(-1)
                    groups[g].append((dd, np.repeat(fac[:, None], 3, 1) if g == 'paint' else C))
    allP = np.vstack(allP)
    # orientation from the 4 wheel centres: principal horizontal axis = length
    wc = np.array([W[wi][:3, 3] for wi in wheel_of[k]])
    xz = wc[:, [0, 2]] - wc[:, [0, 2]].mean(0)
    ev, evec = np.linalg.eigh(xz.T @ xz); dxz = evec[:, -1]
    fwd = np.array([dxz[0], 0, dxz[1]])
    yaw = np.arctan2(fwd[0], fwd[2])  # rotate so fwd -> +Z
    c, s_ = np.cos(-yaw), np.sin(-yaw)
    Ry = np.array([[c, 0, s_], [0, 1, 0], [-s_, 0, c]])
    cen = (allP.max(0) + allP.min(0)) / 2
    def tf(P): return (P - cen) @ Ry.T
    Q = tf(allP)
    cen = cen + np.linalg.inv(Ry) @ np.array([(Q[:, 0].max() + Q[:, 0].min()) / 2, 0, (Q[:, 2].max() + Q[:, 2].min()) / 2])
    Q = tf(allP)
    # front: the end whose lights are less red (tail lights are red); front ends up at -Z
    red = {1: [], -1: []}
    for d, C in groups['optics']:
        z = tf(d['P'])[:, 2]; r = C[:, 0] - (C[:, 1] + C[:, 2]) / 2
        for sg in (1, -1):
            m = (z * sg) > 0.25 * np.ptp(Q[:, 2])
            if m.any(): red[sg].append(r[m])
    rp = np.concatenate(red[1]).mean() if red[1] else 0; rn = np.concatenate(red[-1]).mean() if red[-1] else 0
    front_sign = 1 if rp >= rn else -1   # tail (redder) should be at +Z
    if k in ('suv',): front_sign = -front_sign  # checked visually: its tail lights aren't red enough to tell
    zs = [('red+', round(float(rp), 3)), ('red-', round(float(rn), 3))]
    F = np.diag([front_sign, 1, front_sign])
    ymin = (Q[:, 1]).min()
    def final(P): return tf(P) @ F.T - np.array([0, ymin, 0])
    def finaln(N): return (N @ Ry.T) @ F.T
    sz = np.ptp(final(allP), axis=0)
    out = {}
    for g, lst in groups.items():
        if not lst: continue
        Ps, Ns, Cs, Is = [], [], [], []; base = 0
        for d, C in lst:
            used = np.unique(d['I']); remap = -np.ones(len(d['P']), np.int64); remap[used] = np.arange(len(used))
            Ps.append(final(d['P'][used])); Ns.append(finaln(d['N'][used]))
            Cs.append(C[used] if C is not None else np.zeros((len(used), 3)))
            Is.append(remap[d['I']] + base); base += len(used)
        out[g] = dict(P=np.vstack(Ps).astype(np.float32), N=np.vstack(Ns).astype(np.float32), C=np.vstack(Cs), I=np.concatenate(Is))
    parts_all[k] = out
    print(k, 'size L×W×H m', np.round([sz[2], sz[0], sz[1]], 2), {g: len(v['I']) // 3 for g, v in out.items()}, 'front', front_sign, 'optics', [(t, round(z, 2)) for t, z in zs])
# write GLB
bin_ = bytearray(); bvs = []; accs = []; meshes = []; gnodes = []; root_children = []
def add(arr, target=None, comp=5126, typ='VEC3', norm=False, minmax=False):
    while len(bin_) % 4: bin_.append(0)
    o = len(bin_); bin_.extend(arr.tobytes())
    bvs.append(dict(buffer=0, byteOffset=o, byteLength=arr.nbytes, **({'target': target} if target else {})))
    a = dict(bufferView=len(bvs) - 1, componentType=comp, count=int(arr.shape[0]), type=typ)
    if norm: a['normalized'] = True
    if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
MATS = ['paint', 'trim', 'wheel', 'glass', 'optics']
mats = [dict(name=m, pbrMetallicRoughness=dict(baseColorFactor=[1, 1, 1, 1], metallicFactor=0, roughnessFactor=0.6)) for m in MATS]
mats[3]['pbrMetallicRoughness']['baseColorFactor'] = [0.03, 0.035, 0.04, 0.82]; mats[3]['alphaMode'] = 'BLEND'
for k, out in parts_all.items():
    kids = []
    for g, d in out.items():
        lin = np.clip(d['C'], 0, 1) ** 2.2  # glTF vertex colours are linear
        col = np.clip(np.c_[lin, np.ones(len(lin))] * 255 + 0.5, 0, 255).astype(np.uint8)
        ia = add(d['I'].astype(np.uint16 if d['I'].max() < 65535 else np.uint32), 34963, 5123 if d['I'].max() < 65535 else 5125, 'SCALAR')
        attrs = dict(POSITION=add(d['P'], 34962, minmax=True), NORMAL=add(d['N'], 34962))
        if g != 'glass': attrs['COLOR_0'] = add(col, 34962, 5121, 'VEC4', norm=True)
        meshes.append(dict(name=f'{k}_{g}', primitives=[dict(attributes=attrs, indices=ia, material=MATS.index(g))]))
        gnodes.append(dict(name=f'{k}_{g}', mesh=len(meshes) - 1)); kids.append(len(gnodes) - 1)
    gnodes.append(dict(name=k, children=kids)); root_children.append(len(gnodes) - 1)
gl = dict(asset=dict(version='2.0', generator='camerapin convert_cars', copyright='"Generic passenger car pack" by Comrade1280 (Sketchfab), CC BY 4.0'),
          scene=0, scenes=[dict(nodes=root_children)], nodes=gnodes, meshes=meshes, materials=mats, accessors=accs, bufferViews=bvs, buffers=[dict(byteLength=len(bin_))])
while len(bin_) % 4: bin_.append(0)
gl['buffers'][0]['byteLength'] = len(bin_)
js = json.dumps(gl, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
open(dst, 'wb').write(out); print('wrote', dst, len(out))
