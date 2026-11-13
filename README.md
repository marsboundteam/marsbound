# MarsBound — source

- `index.html` — the built, self-contained app (open in a current Chrome/Edge/Firefox/Safari; needs internet for three.js, Chart.js and fonts from CDNs).
- `src/` — app source: `app.js` (three.js app), `science.js` (Mars time, models, sources, sites), `i18n.js` (6 languages), `style.css`, `body.html`.
- `build.py` — inlines `src/` + `data/assets.json` into `index.html`.
- `pipeline/` — reproducible data pipeline:
  1. `pip install pyshtools scipy pillow`
  2. Download `MarsTopo719.shape` and `gmm3_120_sha.tab` from the SHTOOLS repo (examples/ExampleDataFiles) into `data/`.
  3. `python pipeline/build_topo.py` → areoid-referenced elevation grid (0.125°).
  4. `python pipeline/build_assets.py` → `data/assets.json` (globe textures, 0.25° global grid, 5 site patches).
- Adding a language: add an entry in `LANGS` and a dictionary in `T` inside `src/i18n.js`; missing keys fall back to English.

Prototype for research and education; not a validated scientific instrument.
