import numpy as np, gzip, base64, json, io
def enc(a):
    a=np.asarray(a,dtype=np.int32)
    d=np.diff(a,axis=1,prepend=0).astype('<i2').view(np.uint16)
    lo=(d&255).astype(np.uint8); hi=(d>>8).astype(np.uint8)
    return base64.b64encode(gzip.compress(lo.tobytes()+hi.tobytes(),9)).decode()

from scipy.ndimage import map_coordinates
from PIL import Image
D='/home/claude/data/'
elev = np.load(D+'elev719.npy').astype(np.float64)   # (1440,2880), row i lat=90-i*0.125, col j lon=j*0.125
NR, NC = elev.shape
ext = np.concatenate([elev, elev[:, :4]], axis=1)   # wrap for interpolation
def sample(lat, lonE, order=1):
    r = (90.0 - lat)/0.125
    c = (np.mod(lonE, 360.0))/0.125
    return map_coordinates(ext, [np.clip(r,0,NR-1), c], order=order, mode='nearest')

out = {}
# ---- global 0.25 deg grid ----
gl = 720; gw = 1440
LAT = 90 - (np.arange(gl)+0.5)*0.25
LON = (np.arange(gw)+0.5)*0.25
LA, LO = np.meshgrid(LAT, LON, indexing='ij')
g = sample(LA, LO, 1)
gi = np.round(g).astype('<i2')
out['global'] = {'w':gw,'h':gl,'res':0.25,'b64':enc(gi)}
print('global gz kb', len(out['global']['b64'])/1024)

# ---- globe textures ----
TW, TH = 2048, 1024
LAT = 90 - (np.arange(TH)+0.5)*180/TH
LON = (np.arange(TW)+0.5)*360/TW
LA, LO = np.meshgrid(LAT, LON, indexing='ij')
t = sample(LA, LO, 1)
# hillshade
dy = np.gradient(t, axis=0) / (np.pi*3389500/TH)
dx = np.gradient(t, axis=1) / (2*np.pi*3389500*np.maximum(np.cos(np.radians(LA)),0.05)/TW)
ex = 6.0
nx, ny = -dx*ex, dy*ex  # north up
nz = np.ones_like(t)
n = np.sqrt(nx**2+ny**2+nz**2)
L = np.array([-0.6, 0.6, 0.55]); L/=np.linalg.norm(L)
shade = (nx*L[0] + ny*L[1] + nz*L[2])/n
shade = np.clip(shade,0,1)
def ramp(v, stops):
    xs = [s[0] for s in stops]; cs = np.array([s[1] for s in stops], float)
    return np.stack([np.interp(v, xs, cs[:,k]) for k in range(3)], -1)
nat = ramp(t, [(-8000,(70,40,30)),(-5000,(105,58,38)),(-3000,(140,78,48)),(-1000,(170,100,62)),(1000,(190,122,80)),(3000,(196,138,96)),(6000,(184,132,96)),(12000,(176,128,98)),(21000,(200,160,128))])
# subtle large-scale albedo variation noise to avoid flatness (documented as stylistic)
img = nat * (0.45 + 0.75*shade[...,None])
img = np.clip(img,0,255).astype(np.uint8)
b = io.BytesIO(); Image.fromarray(img).save(b, 'JPEG', quality=84); out['texNatural'] = base64.b64encode(b.getvalue()).decode()
sci = ramp(t, [(-8000,(40,20,120)),(-6000,(30,70,200)),(-4000,(40,160,220)),(-2000,(60,190,120)),(0,(200,210,80)),(2000,(240,170,60)),(4000,(220,90,50)),(8000,(160,60,60)),(14000,(200,170,160)),(21000,(255,255,255))])
img2 = np.clip(sci*(0.55+0.55*shade[...,None]),0,255).astype(np.uint8)
b = io.BytesIO(); Image.fromarray(img2).save(b, 'JPEG', quality=82); out['texScience'] = base64.b64encode(b.getvalue()).decode()
print('tex kb', len(out['texNatural'])/1024, len(out['texScience'])/1024)
Image.fromarray(img).save('/home/claude/data/globe_nat.jpg'); Image.fromarray(img2).save('/home/claude/data/globe_sci.jpg')

# ---- site patches ----
R = 3389.5
sites = {
 'jezero':  dict(lat=18.40, lon=77.55, half=55, start=(18.4447,77.4508)),
 'gale':    dict(lat=-5.20, lon=137.70, half=110, start=(-4.5895,137.4417)),
 'olympus': dict(lat=18.65, lon=226.20, half=420, start=(18.40,227.20)),
 'valles':  dict(lat=-8.80, lon=288.0, half=260, start=(-6.2,288.6)),
 'elysium': dict(lat=4.502, lon=135.623, half=50, start=(4.502,135.623)),
}
N = 257
for k,s in sites.items():
    xs = np.linspace(-s['half'], s['half'], N)   # km east
    ys = np.linspace(s['half'], -s['half'], N)   # km north, row 0 = north
    X, Y = np.meshgrid(xs, ys)
    lat = s['lat'] + np.degrees(Y/R)
    lon = s['lon'] + np.degrees(X/(R*np.cos(np.radians(lat))))
    h = sample(lat, lon, 3)
    hi = np.round(h).astype('<i2')
    out['site_'+k] = dict(lat0=s['lat'], lon0=s['lon'], halfKm=s['half'], n=N, min=float(h.min()), max=float(h.max()),
        b64=enc(hi))
    print(k, 'min', h.min(), 'max', h.max(), 'center', h[N//2,N//2], 'kb', len(out['site_'+k]['b64'])/1024)
json.dump(out, open('/home/claude/data/assets.json','w'))
