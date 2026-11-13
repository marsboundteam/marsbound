/* MarsBound — science core: Mars time, environment models, site + source catalogue.
   Every real-world value carries a status and a source. Statuses:
   MEASURED  – instrument measurement, with observation date
   REFERENCE – published summary/typical range from a mission paper
   COMPUTED  – deterministic calculation (orbital mechanics, geometry)
   MODELLED  – physical model estimate (approximate)
   SIMULATED – gameplay/educational simulation, not a real-world value */
(function () {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const mod = (a, n) => ((a % n) + n) % n;

  // ---------- Mars time: Allison & McEwen (2000) / NASA GISS Mars24 algorithm ----------
  function marsTime(ms) {
    const jdUT = ms / 86400000 + 2440587.5;
    const jdTT = jdUT + (37 + 32.184) / 86400;            // TAI-UTC = 37 s since 2017
    const dt = jdTT - 2451545.0;
    const M = mod(19.3871 + 0.52402073 * dt, 360);
    const aFMS = mod(270.3871 + 0.524038496 * dt, 360);
    const A = [0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.0020, 0.0018];
    const T = [2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493];
    const P = [49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095];
    let pbs = 0; for (let i = 0; i < 7; i++) pbs += A[i] * Math.cos(D2R * ((0.985626 * dt / T[i]) + P[i]));
    const Mr = M * D2R;
    const eoc = (10.691 + 3.0e-7 * dt) * Math.sin(Mr) + 0.623 * Math.sin(2 * Mr) + 0.050 * Math.sin(3 * Mr) +
      0.005 * Math.sin(4 * Mr) + 0.0005 * Math.sin(5 * Mr) + pbs;
    const Ls = mod(aFMS + eoc, 360);
    const Lr = Ls * D2R;
    const eot = 2.861 * Math.sin(2 * Lr) - 0.071 * Math.sin(4 * Lr) + 0.002 * Math.sin(6 * Lr) - eoc; // degrees
    const msd = (dt - 4.5) / 1.0274912517 + 44796.0 - 0.0009626;
    const mtc = mod(24 * msd, 24);
    const rAU = 1.52368 * (1.00436 - 0.09309 * Math.cos(Mr) - 0.004336 * Math.cos(2 * Mr) - 0.00031 * Math.cos(3 * Mr) - 0.00003 * Math.cos(4 * Mr));
    const decl = Math.asin(0.42565 * Math.sin(Lr)) * R2D + 0.25 * Math.sin(Lr);
    const marsYear = Math.floor((jdUT - 2435208.5) / 686.9726) + 1;   // MY1 began 1955-04-11 (Clancy et al. 2000 convention)
    return { jdUT, msd, mtc, Ls, eot, rAU, decl, marsYear, toa: 1361 / (rAU * rAU) };
  }
  function localTimes(mt, lonE) {
    const lmst = mod(mt.mtc + lonE / 15, 24);
    const ltst = mod(lmst + mt.eot / 15, 24);
    return { lmst, ltst };
  }
  // Sun direction in local East-North-Up for latitude, declination and true solar time
  function sunENU(latDeg, declDeg, ltst) {
    const H = (ltst - 12) * 15 * D2R, d = declDeg * D2R, p = latDeg * D2R;
    const E = -Math.cos(d) * Math.sin(H);
    const N = Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.cos(H) * Math.sin(p);
    const U = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(H) * Math.cos(p);
    const el = Math.asin(Math.max(-1, Math.min(1, U))) * R2D;
    const az = mod(Math.atan2(E, N) * R2D, 360);
    return { E, N, U, el, az };
  }
  function seasonName(Ls, lat) {
    const north = ['spring', 'summer', 'autumn', 'winter'][Math.floor(Ls / 90) % 4];
    const south = ['autumn', 'winter', 'spring', 'summer'][Math.floor(Ls / 90) % 4];
    return lat >= 0 ? north : south;
  }
  const fmtClock = h => { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };

  // ---------- Models ----------
  // Hydrostatic pressure estimate from MOLA elevation (approximate; seasonal CO2 cycle changes pressure by ~25%).
  const P_DATUM = 610, H_SCALE = 11100;
  const pressureModel = elevM => P_DATUM * Math.exp(-elevM / H_SCALE);
  // Horizontal visibility from dust optical depth (Koschmieder relation with dust scale height ~11 km) — approximate
  const visibilityKm = tau => 3.912 * 11.1 / Math.max(0.05, tau);
  // Simulated diurnal temperature (gameplay): sinusoid between min (06:00) and max (14:00)
  function simTemp(range, ltst) {
    const [tmin, tmax] = range;
    let f;
    if (ltst >= 6 && ltst <= 14) f = 0.5 - 0.5 * Math.cos(Math.PI * (ltst - 6) / 8);
    else { const h = ltst < 6 ? ltst + 24 : ltst; f = 0.5 + 0.5 * Math.cos(Math.PI * (h - 14) / 16); }
    return tmin + (tmax - tmin) * f;
  }

  // ---------- Sources ----------
  const SRC = {
    mola: { t: 'MarsTopo719 spherical-harmonic shape model of MGS MOLA altimetry (M. Wieczorek, distributed with SHTOOLS)', u: 'https://github.com/SHTOOLS/SHTOOLS' },
    gmm3: { t: 'GMM-3 Mars gravity model (Genova et al. 2016) — used to compute the areoid (elevation reference)', u: 'https://pds-geosciences.wustl.edu/mro/mro-m-rss-5-sdp-v1/mrors_1xxx/data/shadr/' },
    insightWx: { t: 'NASA/JPL InSight daily weather report (APSS/TWINS), reported 2019', u: 'https://gizmodo.com/you-can-now-check-the-weather-on-mars-every-day-1832752785' },
    insightApi: { t: 'NASA InSight Weather Service API documentation (field definitions)', u: 'https://api.nasa.gov/assets/insight/InSight%20Weather%20API%20Documentation.pdf' },
    medaFirst: { t: "NASA/JPL: \"NASA's first weather report from Jezero Crater on Mars\" (6 Apr 2021)", u: 'https://phys.org/news/2021-04-nasa-weather-jezero-crater-mars.html' },
    medaYear: { t: 'Univ. of the Basque Country / Nature Geoscience (Jan 2023): MEDA first Mars year at Jezero', u: 'https://www.eurekalert.org/news-releases/977001' },
    medaNG: { t: 'Rodriguez-Manfredi et al. 2023, Nature Geoscience — MEDA first 250 sols', u: 'https://doi.org/10.1038/s41561-022-01084-0' },
    remsEarly: { t: 'NASA / REMS team via LiveScience (Oct 2012): early Curiosity weather at Gale', u: 'https://www.livescience.com/23646-mars-weather-curiosity-rover-discovery.html' },
    remsSeason: { t: 'Harri et al. 2014, JGR Planets — REMS pressure observations (seasonal ~25% variation)', u: 'https://core.ac.uk/download/36184997.pdf' },
    rad: { t: 'Hassler et al. 2014, Science 343 — RAD surface radiation (Aug 2012–Jun 2013)', u: 'https://www.swri.org/press-release/swri-scientists-publish-first-radiation-measurements-surface-mars' },
    rocknest: { t: 'Bish et al. 2013, Science 341 — CheMin XRD mineralogy of Rocknest, Gale crater', u: 'https://doi.org/10.1126/science.1238932' },
    phoenix: { t: 'Hecht et al. 2009, Science 325 — perchlorate & soluble chemistry at the Phoenix site', u: 'https://experts.arizona.edu/en/publications/detection-of-perchlorate-and-the-soluble-chemistry-of-martian-soi/' },
    terraform: { t: 'Jakosky & Edwards 2018, Nature Astronomy 2 — Inventory of CO2 available for terraforming Mars', u: 'https://lasp.colorado.edu/maven/files/2018/08/Inventory-of-CO2-available-for-terraforming-Mars.pdf' },
    mars24: { t: 'Allison & McEwen 2000 / NASA GISS Mars24 sunclock algorithm', u: 'https://www.giss.nasa.gov/tools/mars24/help/algorithm.html' },
    factsheet: { t: 'NASA Mars Fact Sheet (scale height 11.1 km)', u: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html' },
    curiosityElev: { t: 'Remote Sensing 2025, 17, 368 — Curiosity landing elevation −4500.97 m', u: 'https://doi.org/10.3390/rs17030368' },
  };

  // ---------- Sites ----------
  const SITES = {
    jezero: {
      lat: 18.38, lon: 77.58, mission: 'Perseverance (NASA, landed 18 Feb 2021)', landing: [18.4447, 77.4508], kind: 'crater',
      facts: [
        ['Diameter', '≈ 45 km impact crater'],
        ['Setting', 'Inner NW slopes of Isidis Planitia'],
        ['Why it matters', 'Ancient lake basin with a river delta — a prime place to look for preserved signs of past life'],
      ],
      simple: 'Billions of years ago a river flowed into this crater and filled it with a lake. Perseverance is collecting rock samples here that could one day come to Earth.',
      detail: 'Jezero hosts a fan-shaped sedimentary delta on its western rim. Perseverance found igneous crater-floor units (the basaltic Máaz and the olivine-rich Séítah formations) beneath delta sediments, and is caching samples for possible return. Note: at ~7 km effective resolution the crater rim (≈45 km across) is only coarsely resolved in this terrain model.',
      tempSim: [-82, -27],
      measured: [
        { k: 'temp', v: '−20 °C, falling to −25.6 °C within 30 min', date: '2021-02-19', src: 'medaFirst', st: 'MEASURED' },
        { k: 'pressure', v: '718 Pa', date: '2021-02-19', src: 'medaFirst', st: 'MEASURED' },
        { k: 'temp', v: 'Seasonal mean air temperature ≈ −55 °C; typical day–night difference 50–60 °C (first Mars year)', date: '2021–2023', src: 'medaYear', st: 'REFERENCE' },
      ],
      pois: [
        { id: 'jz-land', name: 'Octavia E. Butler Landing', lat: 18.4447, lon: 77.4508, info: 'Perseverance touchdown point, 18 Feb 2021.' },
        { id: 'jz-delta', name: 'Western delta front (approx.)', lat: 18.51, lon: 77.40, info: 'Sediment fan built by an ancient river entering the crater lake. Position approximate.' },
        { id: 'jz-center', name: 'Crater centre', lat: 18.38, lon: 77.58, info: 'Approximate centre of the ≈45 km crater.' },
      ],
      samples: [
        { name: 'Crater-floor igneous rock (Máaz-like)', minerals: 'Pyroxene, plagioclase — basaltic', analogue: true },
        { name: 'Olivine-rich cumulate (Séítah-like)', minerals: 'Olivine-dominated igneous rock', analogue: true },
        { name: 'Delta sediment', minerals: 'Fine-grained layered sediment; clays and carbonates detected from orbit', analogue: true },
      ],
    },
    gale: {
      lat: -5.4, lon: 137.8, mission: 'Curiosity (NASA, landed 6 Aug 2012)', landing: [-4.5895, 137.4417], kind: 'crater',
      facts: [
        ['Diameter', '≈ 154 km impact crater'],
        ['Central mound', 'Aeolis Mons (Mount Sharp), ≈5 km of layered rock'],
        ['Why it matters', 'Layers record a change from wetter to drier conditions'],
      ],
      simple: 'Gale is a huge crater with a mountain of stacked rock layers in the middle. Reading those layers is like reading pages of a history book about Mars’s climate.',
      detail: 'Curiosity found evidence that Gale held long-lived lakes. Its climb up Mount Sharp moves from clay-bearing to sulfate-bearing strata, a transition interpreted as drying of the climate. REMS shows the largest daily pressure swings of any landing site, explained by the crater’s strong topographic relief.',
      tempSim: [-78, 2],
      measured: [
        { k: 'pressure', v: 'Daily cycle ≈ 685 Pa (min) to ≈ 780 Pa (max)', date: 'Aug–Oct 2012', src: 'remsEarly', st: 'MEASURED' },
        { k: 'temp', v: 'Afternoon air temperatures up to +6 °C (late winter)', date: 'Aug–Oct 2012', src: 'remsEarly', st: 'MEASURED' },
        { k: 'radiation', v: '0.67 mSv/day average GCR dose equivalent', date: 'Aug 2012 – Jun 2013', src: 'rad', st: 'MEASURED' },
      ],
      pois: [
        { id: 'gl-land', name: 'Bradbury Landing', lat: -4.5895, lon: 137.4417, info: 'Curiosity touchdown point, 6 Aug 2012. Published elevation −4500.97 m; this model gives ≈ −4370 m (smoothing at ~7 km resolution).' },
        { id: 'gl-sharp', name: 'Aeolis Mons (Mount Sharp) summit area', lat: -5.08, lon: 137.85, info: 'Layered central mound rising ≈5 km above the crater floor.' },
        { id: 'gl-rim', name: 'Northern crater rim', lat: -4.2, lon: 137.6, info: 'Eroded rim of the ≈154 km crater.' },
      ],
      samples: [
        { name: 'Eolian sand (Rocknest-type)', minerals: 'Plagioclase, olivine, augite, pigeonite + ~27% amorphous', measured: 'rocknest' },
        { name: 'Lacustrine mudstone', minerals: 'Clay-bearing lake sediment', analogue: true },
        { name: 'Sulfate-bearing layered rock', minerals: 'Sulfate-bearing strata higher on Mount Sharp', analogue: true },
      ],
    },
    olympus: {
      lat: 18.4, lon: 226.6, mission: 'No landed mission (orbital data only)', landing: null, kind: 'volcano',
      facts: [
        ['Summit', '≈ 21 km above datum (this model: ' + '21.2 km' + ')'],
        ['Width', '≈ 600 km; bounded by cliffs up to several km high'],
        ['Type', 'Shield volcano — tallest known in the Solar System'],
      ],
      simple: 'Olympus Mons is a volcano so wide it would cover much of a country, and more than twice as tall as Mount Everest above sea level. Its slopes are gentle — you could walk up them.',
      detail: 'A basaltic shield built by fluid lava flows over long periods. The summit holds a nested caldera complex. Because the summit sits ~20 km above datum, surface pressure there is only ~10–15% of the datum value (hydrostatic estimate below).',
      tempSim: [-105, -45],
      measured: [],
      pois: [
        { id: 'om-caldera', name: 'Summit caldera complex', lat: 18.3, lon: 226.7, info: 'Nested collapse calderas, ≈3 km deep in this model. Centre located from the MOLA data itself.' },
        { id: 'om-scarp', name: 'Basal escarpment (approx.)', lat: 18.4, lon: 222.7, info: 'Cliff bounding the volcano edge. Position approximate.' },
      ],
      samples: [{ name: 'Basaltic lava (orbital inference)', minerals: 'Basalt — composition inferred from orbit, no sample analysed', analogue: true }],
    },
    valles: {
      lat: -8.8, lon: 288.0, mission: 'No landed mission (orbital data only)', landing: null, kind: 'canyon',
      facts: [
        ['Length', '≈ 4,000 km canyon system'],
        ['Depth', 'Up to ≈ 7 km (this patch: ' + '≈10.8 km rim-to-floor range' + ')'],
        ['Here', 'Melas & Candor Chasmata, central Valles Marineris'],
      ],
      simple: 'Valles Marineris is a canyon system long enough to stretch across a continent. Its walls show many layers of rock stacked like a cake.',
      detail: 'A tectonic rift system on the flank of the Tharsis rise, later widened by collapse and erosion. Interior layered deposits in Candor and Melas contain hydrated sulfates detected by orbital spectrometers (e.g. CRISM, OMEGA).',
      tempSim: [-85, -15],
      measured: [],
      pois: [
        { id: 'vm-candor', name: 'Candor Chasma', lat: -6.5, lon: 289.0, info: 'Deep trough with interior layered deposits.' },
        { id: 'vm-melas', name: 'Melas Chasma', lat: -10.2, lon: 287.0, info: 'Widest section of central Valles Marineris.' },
      ],
      samples: [{ name: 'Interior layered deposit', minerals: 'Hydrated sulfates detected from orbit', analogue: true }],
    },
    elysium: {
      lat: 4.502, lon: 135.623, mission: 'InSight (NASA, landed 26 Nov 2018; mission ended Dec 2022)', landing: [4.502, 135.623], kind: 'plain',
      facts: [
        ['Setting', 'Flat, smooth volcanic plain near the equator'],
        ['Why chosen', 'Safe, flat and sunny — ideal for a stationary geophysics lander'],
        ['Science', 'First Mars seismometer: detected marsquakes and mapped the interior'],
      ],
      simple: 'InSight sat on this very flat plain and listened for “marsquakes”. It also had a weather station, so we know how cold and windy it gets here.',
      detail: 'InSight’s APSS suite (pressure sensor + TWINS wind/temperature booms) recorded continuous meteorology to remove atmospheric noise from the seismometer. The daily pressure amplitude here is smaller than at Gale.',
      tempSim: [-95, -16],
      measured: [
        { k: 'temp', v: 'High −16 °C, low −95 °C', date: '2019-02-14', src: 'insightWx', st: 'MEASURED' },
        { k: 'pressure', v: '721.7 Pa (daily average)', date: '2019-02-14', src: 'insightWx', st: 'MEASURED' },
        { k: 'wind', v: 'Top wind speed 58 km/h (≈16 m/s)', date: '2019-02-14', src: 'insightWx', st: 'MEASURED' },
      ],
      pois: [{ id: 'el-insight', name: 'InSight lander', lat: 4.502, lon: 135.623, info: 'InSight’s landing site, Elysium Planitia.' }],
      samples: [{ name: 'Plains regolith', minerals: 'Fine basaltic regolith', analogue: true }],
    },
  };

  // Rocknest (Gale) CheMin crystalline phases — approximate shares of the crystalline fraction
  // as tabulated in Bish et al. 2013 (rounded). The sample also has 27 ± 14 wt% X-ray amorphous material.
  const ROCKNEST = {
    amorphousWt: 27, amorphousErr: 14,
    crystalline: [['Plagioclase (~An57)', 40.8], ['Forsteritic olivine (~Fo62)', 22.4], ['Augite', 14.6], ['Pigeonite', 13.8], ['Magnetite', 2.1], ['Anhydrite', 1.5], ['Quartz', 1.4], ['K-feldspar', 1.3], ['Hematite', 1.1], ['Ilmenite', 0.9]],
  };
  const PHOENIX = { perchlorateWt: [0.4, 0.6], pH: 7.7, pHErr: 0.5 };

  window.MB_SCI = { marsTime, localTimes, sunENU, seasonName, fmtClock, pressureModel, visibilityKm, simTemp, SRC, SITES, ROCKNEST, PHOENIX, P_DATUM, H_SCALE, mod, D2R, R2D };
})();
