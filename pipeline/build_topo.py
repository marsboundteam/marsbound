import numpy as np, pyshtools as pysh, sys
topo = pysh.SHCoeffs.from_file('MarsTopo719.shape', lmax=719)
print('loaded topo')
grav = pysh.SHGravCoeffs.from_file('gmm3_120_sha.tab', header=True, r0_index=0, gm_index=1, errors=True, header_units='km')
grav.set_omega(7.088218e-5)
geoid = grav.geoid(potref=12652804.7, r=3396000., order=2, lmax=719, extend=False)
print('geoid ok', geoid.geoid.data.shape)
rgrid = topo.expand(grid='DH2', lmax=719, extend=False)
r = rgrid.data
g = geoid.geoid.data
print(r.shape, g.shape)
elev = r - (3396000. + g)
np.save('elev719.npy', elev.astype(np.float32))
lats = rgrid.lats(); lons = rgrid.lons()
np.save('lats719.npy', lats); np.save('lons719.npy', lons)
def at(lat, lonE):
    i = np.argmin(abs(lats-lat)); j = np.argmin(abs(lons-(lonE%360)))
    return elev[i,j]
print('Curiosity landing (-4.59,137.44):', at(-4.59,137.44))
print('Olympus summit max near (18.6,226.2):', elev[(abs(lats-18.6)<3)][:, (abs(lons-226.2)<3)].max())
print('Hellas min:', elev[(abs(lats+42)<8)][:, (abs(lons-70)<10)].min())
print('Jezero (18.44,77.45):', at(18.44,77.45))
print('InSight (4.5,135.62):', at(4.502,135.623))
print('global min/max', elev.min(), elev.max())
