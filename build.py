import json,re
src='src/'
assets=json.load(open('/home/claude/data/assets.json'))
css=open(src+'style.css').read(); body=open(src+'body.html').read()
sci=open(src+'science.js').read(); i18n=open(src+'i18n.js').read(); app=open(src+'app.js').read()
html=f'''<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MarsBound — Immersive Martian Exploration Simulator</title>
<meta name="description" content="Explore real Martian terrain from MOLA altimetry, a provenance-labelled environment monitor, soil lab, underground greenhouse and atmosphere what-if simulation.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+Arabic:wght@300;400;500&family=Noto+Sans+Devanagari:wght@300;400;500&display=swap" rel="stylesheet">
<style>{css}</style>
<script type="importmap">{{"imports":{{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}}}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
</head>
<body class="m-explore">
{body}
<script>window.MB_ASSETS={json.dumps(assets,separators=(',',':'))};</script>
<script>{sci}</script>
<script>{i18n}</script>
<script type="module">{app}</script>
</body>
</html>'''
open('index.html','w').write(html)
print('size MB', len(html)/1e6)
