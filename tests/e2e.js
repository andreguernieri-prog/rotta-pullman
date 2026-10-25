/*
 * Test end-to-end con i servizi esterni simulati (mappe, ricerca, calcolo, Overpass).
 * Uso: PW_MODULE=/percorso/playwright FONTS_DIR=/percorso/@fontsource node tests/e2e.js [cartella-screenshot]
 * Le risposte simulate hanno la stessa forma di quelle vere ma dati inventati:
 * servono a provare l'interfaccia, non i risultati.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const C = require('../js/core.js');
const D = require('../tools/build-data.js');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
const FONTS = process.env.FONTS_DIR;
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- server statico ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* ---------------- servizi simulati ---------------- */
const VIA_A1 = [[45.4860, 9.2044], [45.40, 9.33], [45.31, 9.50], [45.05, 9.70], [44.80, 10.33], [44.65, 10.93], [44.50, 11.34], [44.25, 11.30], [43.95, 11.20], [43.7629, 11.2650]];
const mocks = { forceRouteError: false, lastCoords: null, corridorCalls: 0, failCorridor: new Set(), corridorSeen: 0, delay: 0, parkingFail: 0, inflight: 0, maxInflight: 0, parkingQueries: [], dati: false, datiRichieste: 0, datiCopertura: null, tomtomUrls: [], vicino: false, orario: false, dateTimes: [], parkNoBus: false, blockDest: false, unreachableDest: false, honorExclude: false, fixedCoords: null, valhallaBodies: [], viaduct: false, traceFail: false, traceCalls: 0, traffic: false, incidentCalls: 0, places: false, unreachablePlace: null, matrixCalls: 0, ztl: false, senzaLimiti: false };

function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.max(1, Math.ceil(C.haversine(a, b) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const w = Math.sin((i * 50 + k) / 6) * 0.0006;
      out.push([a[0] + (b[0] - a[0]) * t + w, a[1] + (b[1] - a[1]) * t - w]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const close = (a, b) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
const INSTR = ['Procedi in direzione sud.', 'Svolta a destra in Viale Brianza.', 'Prendi lo svincolo per A1 Bologna.', 'Mantieni la sinistra verso A1 Firenze.', 'Esci verso Firenze Sud.', 'Alla rotonda prendi la seconda uscita.'];

function mockValhalla(url) {
  const NOPATH = { status: 400, body: { error_code: 442, error: 'No path could be found for input', status_code: 400 } };
  if (mocks.forceRouteError) return NOPATH;
  const body = JSON.parse(new URL(url).searchParams.get('json'));
  mocks.valhallaBodies.push(body);
  mocks.dateTimes.push(body.date_time || null);
  const excl = body.exclude_locations && body.exclude_locations.length;
  // punti da evitare: senza un'alternativa simulata il servizio non trova percorsi
  if (excl && !mocks.honorExclude) return NOPATH;
  if (mocks.unreachableDest) {
    // l'arrivo è raggiungibile solo cercando la strada percorribile più vicina (raggio di ricerca)
    const lastLoc = body.locations[body.locations.length - 1];
    if (!lastLoc.radius) return NOPATH;
    lastLoc.lat -= 0.0012; lastLoc.lon -= 0.0008;
  }
  const locs = body.locations.map((l) => [l.lat, l.lon]);
  const legs = [];
  let all = [], totLen = 0, totTime = 0;
  for (let i = 0; i < locs.length - 1; i++) {
    const a = locs[i], b = locs[i + 1];
    let base = [a, b];
    if (close(a, VIA_A1[0]) && close(b, VIA_A1[VIA_A1.length - 1])) base = VIA_A1;
    else if (close(b, VIA_A1[0]) && close(a, VIA_A1[VIA_A1.length - 1])) base = VIA_A1.slice().reverse();
    else if (close(a, VIA_A1[0]) && close(b, [44.4949, 11.3426])) base = VIA_A1.slice(0, 7);
    // alternativa che evita i punti esclusi: la parte centrale passa più a est
    if (excl && mocks.honorExclude && base.length > 2) base = base.map((p, k) => (k === 0 || k === base.length - 1 ? p : [p[0], p[1] + 0.08]));
    else if (close(a, [44.4949, 11.3426]) && close(b, VIA_A1[VIA_A1.length - 1])) base = VIA_A1.slice(6);
    base = base.slice(); base[0] = a; base[base.length - 1] = b;
    const shape = densify(base, 400);
    let len = 0;
    for (let k = 1; k < shape.length; k++) len += C.haversine(shape[k - 1], shape[k]);
    const time = len / (85 / 3.6);
    const cuts = [0, 3, 8, Math.floor(shape.length * 0.2), Math.floor(shape.length * 0.9), shape.length - 4, shape.length - 1];
    const maneuvers = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      let segLen = 0;
      for (let j = cuts[k] + 1; j <= cuts[k + 1]; j++) segLen += C.haversine(shape[j - 1], shape[j]);
      maneuvers.push({ type: [1, 10, 18, 24, 20, 26][k], instruction: INSTR[k], street_names: [['Via Vittor Pisani'], ['Viale Brianza'], ['A1'], ['A1', 'E35'], ['Via Senese'], ['Viale Galileo']][k], time: segLen / (85 / 3.6), length: segLen / 1000, begin_shape_index: cuts[k], end_shape_index: cuts[k + 1] });
    }
    maneuvers.push({ type: 5, instruction: 'La destinazione è sulla destra.', time: 0, length: 0, begin_shape_index: shape.length - 1, end_shape_index: shape.length - 1 });
    legs.push({ shape: C.encodePolyline(shape, 6), maneuvers, summary: { length: len / 1000, time } });
    all = all.length ? all.concat(shape.slice(1)) : shape;
    totLen += len; totTime += time;
  }
  mocks.lastCoords = all;
  if (mocks.honorExclude && !excl) mocks.fixedCoords = all; // i limiti restano dove sono sul percorso più veloce
  return { status: 200, body: { trip: { legs, summary: { length: totLen / 1000, time: totTime, has_toll: true, has_highway: true, has_ferry: false }, status: 0, units: 'kilometers', language: 'it-IT' } } };
}

/* segnalazioni di traffico TomTom, poste sul percorso più veloce */
function mockIncidents(url) {
  mocks.incidentCalls++;
  const c = mocks.fixedCoords || mocks.lastCoords;
  if (!mocks.traffic || !c) return { incidents: [] };
  const bbox = new URL(url).searchParams.get('bbox').split(',').map(Number);
  const line = (frac, n) => { const i = Math.floor(c.length * frac); return c.slice(i, i + n).map(([la, lo]) => [lo, la]); };
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const f = (frac, props, reverse) => { const g = line(frac, 4); return { type: 'Feature', geometry: { type: 'LineString', coordinates: reverse ? g.reverse() : g }, properties: props }; };
  const all = [
    f(0.30, { id: 'tt-coda', iconCategory: 6, magnitudeOfDelay: 2, delay: 600, length: 1200, roadNumbers: ['A1'], from: 'Parma', to: 'Reggio Emilia', events: [{ description: 'Coda' }], timeValidity: 'present' }),
    f(0.40, { id: 'tt-opposta', iconCategory: 1, delay: 1200, roadNumbers: ['A1'], events: [{ description: 'Incidente' }], timeValidity: 'present' }, true),
    f(0.55, { id: 'tt-cantiere', iconCategory: 9, magnitudeOfDelay: 1, delay: 120, roadNumbers: ['A1'], events: [{ description: 'Lavori in corso' }], startTime: iso(now - 30 * 864e5), endTime: iso(now + 365 * 864e5), timeValidity: 'present' }),
    f(0.70, { id: 'tt-chiusura', iconCategory: 8, magnitudeOfDelay: 4, roadNumbers: ['SS65'], from: 'Pianoro', to: 'Sasso Marconi', events: [{ description: 'Strada chiusa' }], startTime: iso(now - 3600e3), endTime: iso(now + 30 * 864e5), timeValidity: 'present' }),
    f(0.45, { id: 'tt-futuro', iconCategory: 9, roadNumbers: ['A1'], events: [{ description: 'Lavori programmati' }], startTime: iso(now + 400 * 864e5), endTime: iso(now + 410 * 864e5), timeValidity: 'future' }),
  ];
  const inBox = (x) => { const [lo, la] = x.geometry.coordinates[0]; return lo >= bbox[0] && lo <= bbox[2] && la >= bbox[1] && la <= bbox[3]; };
  return { incidents: all.filter(inBox) };
}

/* strade percorse (trace_attributes): le vie dei limiti che coincidono col percorso sono quelle percorse;
   con mocks.viaduct il tratto della via 106 è un viadotto (via 777000) e la via 106 passa sotto */
function mockTrace(text) {
  mocks.traceCalls++;
  if (mocks.traceFail) return { status: 504, body: { error: 'timeout' } };
  const body = JSON.parse(text);
  const shape = C.decodePolyline(body.encoded_polyline, 6);
  const ways = (mocks.fixedCoords || mocks.lastCoords) ? mockOverpass('corridoio').elements.filter((e) => e.type === 'way' && e.geometry && !/^(services|rest_area)$/.test(e.tags.highway || '')) : [];
  const idAt = (p) => {
    for (const w of ways) {
      if (w.geometry.some((g) => C.haversine(p, [g.lat, g.lon]) < 3)) return mocks.viaduct && w.id === 106 ? 777000 : w.id;
    }
    return 900000 + Math.floor(shape.length ? 0 : 0);
  };
  const edges = [];
  let start = 0, cur = idAt(shape[0]);
  for (let i = 1; i < shape.length; i++) {
    const id = idAt(shape[i]);
    if (id !== cur || i === shape.length - 1) {
      edges.push({ way_id: cur, bridge: cur === 777000, tunnel: false, begin_shape_index: start, end_shape_index: i });
      start = i; cur = id;
    }
  }
  return { status: 200, body: { shape: body.encoded_polyline, edges } };
}

function offsetPoint(coords, frac, meters) {
  const i = Math.floor(coords.length * frac);
  const a = coords[i], b = coords[i + 1];
  const kx = 111320 * Math.cos(a[0] * Math.PI / 180), ky = 110540;
  const e = (b[1] - a[1]) * kx, n = (b[0] - a[0]) * ky, L = Math.hypot(e, n);
  // normale a destra del verso di marcia: (n, -e)
  return { lat: a[0] + (-e / L) * meters / ky, lon: a[1] + (n / L) * meters / kx };
}
function wayOn(coords, frac, count, id, tags) {
  const i = Math.floor(coords.length * frac);
  return { type: 'way', id, tags, geometry: coords.slice(i, i + count).map((c) => ({ lat: c[0], lon: c[1] })) };
}

function mockOverpass(data) {
  if (/amenity=parking/.test(data)) {
    const found = [...data.matchAll(/around:(\d+),([\d.-]+),([\d.-]+)\)\[amenity=parking\]\[~/g)];
    mocks.parkingQueries.push(found.map((m) => ({ radius: Number(m[1]), lat: Number(m[2]), lon: Number(m[3]) })));
    const pts = found.map((m) => [Number(m[2]), Number(m[3])]);
    const elements = [];
    if (mocks.parkNoBus) {
      // paese senza parcheggi per bus vicini: un piazzale grande, uno piccolo, un parcheggio bus a 2,8 km
      const sq = (lat, lon, m) => { const d = m / 2 / 110540, e = m / 2 / (111320 * Math.cos(lat * Math.PI / 180)); return [[lat - d, lon - e], [lat - d, lon + e], [lat + d, lon + e], [lat + d, lon - e], [lat - d, lon - e]].map(([a, b]) => ({ lat: a, lon: b })); };
      pts.forEach((p) => {
        elements.push({ type: 'way', id: 9400, geometry: sq(p[0] + 0.003, p[1], 60), tags: { amenity: 'parking', name: 'Piazzale del mercato', fee: 'no' } });
        elements.push({ type: 'way', id: 9401, geometry: sq(p[0] + 0.001, p[1], 15), tags: { amenity: 'parking', name: 'Parcheggio piccolo' } });
        elements.push({ type: 'node', id: 9402, lat: p[0] + 0.025, lon: p[1], tags: { amenity: 'parking', bus: 'designated', name: 'Parcheggio bus Stazione' } });
      });
      return { elements };
    }
    pts.forEach((p, k) => {
      elements.push({ type: 'way', id: 9000 + k, center: { lat: p[0] + 0.002, lon: p[1] + 0.002 }, tags: { amenity: 'parking', bus: 'designated', name: 'Parcheggio bus turistici', fee: 'yes', 'capacity:bus': '18' } });
      elements.push({ type: 'node', id: 9100 + k, lat: p[0] - 0.008, lon: p[1] + 0.001, tags: { amenity: 'parking', hgv: 'yes' } });
      elements.push({ type: 'node', id: 9200 + k, lat: p[0] + 0.012, lon: p[1], tags: { amenity: 'parking', bus: 'yes', name: 'Parcheggio troppo lontano' } });
    });
    return { elements };
  }
  const c = mocks.fixedCoords || mocks.lastCoords;
  if (!c) return { elements: [] }; // richiesta rimasta in sospeso da uno scenario già chiuso
  const sv = (frac, m, id, name) => Object.assign({ type: 'way', id, tags: { highway: 'services', name } }, { center: offsetPoint(c, frac, m) });
  const out = {
    elements: [
      wayOn(c, 0.2, 4, 101, { highway: 'primary', maxheight: '5' }),
      Object.assign(wayOn(c, 0.35, 4, 102, { highway: 'primary', maxheight: '3.5', name: 'Sottopasso ferroviario', tunnel: 'yes', 'source:maxheight': 'sign' }), { timestamp: '2014-05-02T10:00:00Z', version: 3 }),
      wayOn(c, 0.6, 4, 103, { highway: 'secondary', maxheight: '3.9', name: 'Ponte sul Reno' }),
      wayOn(c, 0.82, 6, 104, { highway: 'tertiary', hgv: 'no', name: 'Via dei Colli' }),
      sv(0.3, 160, 201, 'Area di servizio Arda'),
      sv(0.55, 150, 202, 'Area di servizio Secchia Est'),
      sv(0.56, -150, 203, 'Area di servizio Secchia Ovest'),
    ].concat(mocks.viaduct ? [wayOn(c, 0.5, 3, 106, { highway: 'service', maxheight: '2.2' })] : [])
      .concat(mocks.orario ? [wayOn(c, 0.7, 4, 105, { highway: 'secondary', name: 'Via del Mercato', 'bus:conditional': 'no @ (Mo-Fr)' })] : [])
      .concat(mocks.vicino ? [Object.assign({ type: 'node', id: 7001, tags: { maxheight: '3.2', barrier: 'height_restrictor' } }, (() => { const q = offsetPoint(c, 0.45, 4); return { lat: q.lat, lon: q.lon }; })())] : []),
  };
  // percorso senza limiti: solo le aree di servizio
  if (mocks.senzaLimiti) out.elements = out.elements.filter((e) => /^(services|rest_area)$/.test(e.tags.highway || ''));
  return out;
}

function photonFeature(name, city, lat, lon, extra) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: Object.assign({ name, city, country: 'Italia', countrycode: 'IT' }, extra || {}) };
}
function mockPhoton(url) {
  const u = new URL(url);
  if (u.pathname.startsWith('/reverse')) return { features: [photonFeature(null, 'Firenze', Number(u.searchParams.get('lat')), Number(u.searchParams.get('lon')), { street: 'Viale Galileo', housenumber: '12' })] };
  const q = (u.searchParams.get('q') || '').toLowerCase();
  if (q.startsWith('bol')) return { features: [photonFeature('Bologna', 'Bologna', 44.4949, 11.3426, { state: 'Emilia-Romagna' }), photonFeature('Bologna Centrale', 'Bologna', 44.5058, 11.3431)] };
  if (q.startsWith('ver')) return { features: [photonFeature('Arena di Verona', 'Verona', 45.4390, 10.9944)] };
  return { features: [] };
}

// comune di un punto, come lo restituisce Nominatim al livello 10
const COMUNI = [
  { nome: 'Milano', prov: 'MI', lat: 45.47, lon: 9.19 },
  { nome: 'Bologna', prov: 'BO', lat: 44.49, lon: 11.34 },
  { nome: 'Firenze', prov: 'FI', lat: 43.77, lon: 11.25 },
];
function mockNominatimReverse(url) {
  const u = new URL(url);
  const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon'));
  const c = COMUNI.find((x) => Math.abs(x.lat - lat) < 0.08 && Math.abs(x.lon - lon) < 0.08);
  if (!c) return { address: { village: 'Borgo di prova', 'ISO3166-2-lvl6': 'IT-PR', country_code: 'it' } };
  return { place_id: 1, name: c.nome, address: { city: c.nome, 'ISO3166-2-lvl6': 'IT-' + c.prov, country: 'Italia', country_code: 'it' } };
}

async function answerOverpass(route, json) {
  const data = new URLSearchParams(route.request().postData() || '').get('data') || '';
  if (/amenity=parking/.test(data) && mocks.parkingFail > 0) {
    mocks.parkingFail--;
    return route.fulfill({ status: 429, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'rate_limited' });
  }
  if (!/amenity=parking/.test(data)) {
    mocks.corridorCalls++;
    if (mocks.failCorridor.has(mocks.corridorCalls)) return route.fulfill({ status: 504, contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Gateway Timeout' });
    if (mocks.delay) await new Promise((r) => setTimeout(r, mocks.delay));
    mocks.corridorSeen = Math.max(mocks.corridorSeen, (data.match(/way\(around:10,/g) || []).length);
  }
  return json(mockOverpass(data));
}

/* dati scaricati simulati: gli stessi elementi delle risposte Overpass, divisi in riquadri */
function toFeature(el) {
  const props = Object.assign({ '@type': el.type, '@id': el.id }, el.tags);
  const geom = el.geometry ? { type: 'LineString', coordinates: el.geometry.map((g) => [g.lon, g.lat]) }
    : el.center ? { type: 'Point', coordinates: [el.center.lon, el.center.lat] }
      : { type: 'Point', coordinates: [el.lon, el.lat] };
  return { type: 'Feature', geometry: geom, properties: props };
}
function mockDati() {
  if (!mocks.lastCoords) mocks.lastCoords = densify(VIA_A1, 2000); // nessun percorso calcolato ancora
  const c = mocks.lastCoords;
  const dest = c[c.length - 1];
  const block = mocks.blockDest ? [
    // strada stretta a ~30 m dall'arrivo, come la via dell'Orrido di Ponte Alto
    { type: 'way', id: 9500, tags: { highway: 'unclassified', name: 'Via alla Cascata', maxheight: '1.9', maxwidth: '2.3' }, geometry: [{ lat: dest[0] + 0.0003, lon: dest[1] - 0.001 }, { lat: dest[0] + 0.0003, lon: dest[1] + 0.001 }] },
    { type: 'way', id: 9501, tags: { highway: 'residential', name: 'Via Lontana', maxheight: '2' }, geometry: [{ lat: dest[0] + 0.01, lon: dest[1] }, { lat: dest[0] + 0.011, lon: dest[1] }] },
  ] : [];
  let luoghi = [];
  if (mocks.places) {
    const pt = (frac, m, id, tags) => Object.assign({ type: 'node', id, tags }, offsetPoint(c, frac, m));
    const museo = pt(0.6, 1500, 9602, { tourism: 'museum', name: 'Museo nel centro storico', wikidata: 'Q102' });
    mocks.unreachablePlace = [museo.lat, museo.lon];
    luoghi = [
      pt(0.3, 8000, 9600, { historic: 'archaeological_site', name: 'Area archeologica di Prova', heritage: '1', wikidata: 'Q100' }),
      pt(0.5, 3000, 9601, { historic: 'castle', name: 'Castello di Prova', wikipedia: 'it:Castello di Prova', wikidata: 'Q101', opening_hours: 'Sa-Su 10:00-18:00' }),
      museo,
      pt(0.4, 40000, 9603, { tourism: 'museum', name: 'Museo lontano', wikidata: 'Q103' }),
      pt(0.45, 2000, 9604, { tourism: 'museum', name: 'Museo minore' }),
    ];
  }
  let zone = [];
  if (mocks.ztl) {
    // ZTL sempre attiva a metà del percorso più veloce, e una ZTL intorno all'arrivo
    const cz = mocks.fixedCoords || c;
    const sq = (lat, lon, m) => { const d = m / 110540, e = m / (111320 * Math.cos(lat * Math.PI / 180)); return [[lat - d, lon - e], [lat - d, lon + e], [lat + d, lon + e], [lat + d, lon - e], [lat - d, lon - e]].map(([a, b]) => ({ lat: a, lon: b })); };
    const mid = cz[Math.floor(cz.length * 0.5)], end = cz[cz.length - 1];
    zone = [
      { type: 'way', id: 9700, tags: { boundary: 'limited_traffic_zone', name: 'ZTL di Prova', motor_vehicle: 'permit', website: 'https://comune.example/ztl' }, geometry: sq(mid[0], mid[1], 800) },
      { type: 'relation', id: 9701, tags: { boundary: 'limited_traffic_zone', name: 'ZTL Centro', vehicle: 'yes', 'vehicle:conditional': 'permit @ (00:00-24:00)' }, geometry: sq(end[0], end[1], 400) },
    ];
  }
  const els = mockOverpass('corridoio').elements.concat(block, luoghi, zone, [
    { type: 'way', id: 9300, center: { lat: dest[0] + 0.002, lon: dest[1] + 0.002 }, tags: { amenity: 'parking', bus: 'designated', name: 'Parcheggio bus turistici', fee: 'yes' } },
    { type: 'node', id: 9301, lat: dest[0] - 0.008, lon: dest[1] + 0.001, tags: { amenity: 'parking', hgv: 'yes' } },
    { type: 'node', id: 9302, lat: dest[0] + 0.012, lon: dest[1], tags: { amenity: 'parking', bus: 'yes', name: 'Parcheggio troppo lontano' } },
  ]);
  const b = D.createBuilder();
  els.forEach((el) => b.add(toFeature(el)));
  return b.finish({ generato: '2026-10-26T04:00:00Z', datiOsm: '2026-10-25T20:21:02Z', copertura: mocks.datiCopertura || [[[35, 6], [48, 6], [48, 19], [35, 19], [35, 6]]] });
}

/* TomTom: in auto segue il nostro percorso; col bus devia tra il 58-62% (ponte da 3,9 m) e il 70-74% del tragitto */
function mockTomTom(url) {
  mocks.tomtomUrls.push(url);
  const c = mocks.lastCoords;
  const bus = /travelMode=bus/.test(url);
  const n = c.length;
  const pts = c.map((p, i) => {
    const f = i / n;
    const away = bus && ((f >= 0.58 && f <= 0.62) || (f >= 0.70 && f <= 0.74));
    return { latitude: p[0], longitude: away ? p[1] + 0.01 : p[1] };
  });
  return { formatVersion: '0.0.12', routes: [{ summary: { lengthInMeters: 1, travelTimeInSeconds: 1 }, legs: [{ points: pts }] }] };
}

let tilePng = null;
async function setupRoutes(context) {
  // un errore nel simulatore non deve fermare tutti i test: la richiesta fallisce e basta
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => mockRoute(route).catch(() => route.abort().catch(() => {})));
}

async function mockRoute(route) {
  {
    const url = route.request().url();
    const json = (o, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
    if (url.includes('valhalla1.openstreetmap.de/sources_to_targets')) {
      mocks.matrixCalls++;
      const b = JSON.parse(new URL(url).searchParams.get('json'));
      const far = (t) => mocks.unreachablePlace && C.haversine([t.lat, t.lon], mocks.unreachablePlace) < 50;
      return json({ sources_to_targets: b.sources.map((s0, i) => b.targets.map((t, j) => ({ from_index: i, to_index: j, time: far(t) ? null : Math.round(C.haversine([s0.lat, s0.lon], [t.lat, t.lon]) * 1.3 / (50 / 3.6)), distance: 1 }))) });
    }
    if (url.startsWith('https://it.wikipedia.org/api/rest_v1/page/summary/')) {
      const title = decodeURIComponent(url.split('/summary/')[1]).replace(/_/g, ' ');
      return json({ extract: `Il ${title} è un luogo di prova lungo il percorso.`, thumbnail: { source: 'https://upload.example/foto.png' }, content_urls: { desktop: { page: 'https://it.wikipedia.org/wiki/' + encodeURIComponent(title) } } });
    }
    if (url.startsWith('https://www.wikidata.org/')) return json({ entities: { Q100: { sitelinks: { itwiki: { title: 'Area archeologica di Prova' } } } } });
    if (url.startsWith('https://upload.example/')) return route.fulfill({ status: 200, contentType: 'image/png', body: tilePng });
    if (url.includes('valhalla1.openstreetmap.de/trace_attributes')) { const r = mockTrace(route.request().postData()); return json(r.body, r.status); }
    if (url.includes('valhalla1.openstreetmap.de/route')) { const r = mockValhalla(url); return json(r.body, r.status); }
    if (url.includes('photon.komoot.io')) return json(mockPhoton(url));
    if (url.includes('nominatim.openstreetmap.org/reverse')) return json(mockNominatimReverse(url));
    if (url.includes('nominatim.openstreetmap.org')) return json([]);
    if (url.startsWith('https://api.tomtom.com/traffic/')) return json(mockIncidents(url));
    if (url.startsWith('https://api.tomtom.com/routing/')) return json(mockTomTom(url));
    if (url.startsWith('https://graph.mapillary.com/images')) return json({ data: [{ id: '4242', thumb_256_url: 'https://mapillary-thumb.example/4242.jpg', captured_at: 1690000000000 }] });
    if (url.startsWith('https://graph.mapillary.com/map_features')) return json({ data: [{ id: '77', object_value: 'regulatory--height-limit--g1', last_seen_at: 1690000000000, geometry: { type: 'Point', coordinates: [0, 0] } }] });
    if (url.startsWith('https://mapillary-thumb.example/')) return route.fulfill({ status: 200, contentType: 'image/png', body: tilePng });
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      mocks.datiRichieste++;
      const built = mocks.dati ? mockDati() : null;
      if (!built) return route.fulfill({ status: 404, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: '404: Not Found' });
      if (/\/index\.json/.test(url)) return json(built.index);
      const mz = url.match(/zone\/(-?\d+_-?\d+)\.json/);
      if (mz) {
        const z = built.zones && built.zones.get(mz[1]);
        if (!z) return route.fulfill({ status: 404, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: '404: Not Found' });
        return json({ v: 1, k: mz[1], z });
      }
      const ml = url.match(/luoghi\/(-?\d+_-?\d+)\.json/);
      if (ml) {
        const l = built.places && built.places.get(ml[1]);
        if (!l) return route.fulfill({ status: 404, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: '404: Not Found' });
        return json({ v: 1, k: ml[1], l });
      }
      const m = url.match(/riquadri\/(-?\d+_-?\d+)\.json/);
      const tile = m && built.tiles.get(m[1]);
      if (!tile) return route.fulfill({ status: 404, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: '404: Not Found' });
      return json(Object.assign({ v: 1, k: m[1] }, tile));
    }
    if (url.includes('/api/status')) {
      return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Rate limit: 2\nSlot available after: 2026-10-23T10:00:00Z, in 0 seconds.\n' });
    }
    if (url.includes('/api/interpreter')) {
      mocks.inflight++; mocks.maxInflight = Math.max(mocks.maxInflight, mocks.inflight);
      try {
        await new Promise((r) => setTimeout(r, 20));
        return await answerOverpass(route, json);
      } finally { mocks.inflight--; }
    }
    if (/tile\.openstreetmap\.org|arcgisonline/.test(url)) return route.fulfill({ status: 200, contentType: 'image/png', body: tilePng });
    if (url.startsWith('https://fonts.googleapis.com/') && FONTS) {
      const faces = [['Barlow Condensed', 'barlow-condensed', [500, 600, 700]], ['Overpass', 'overpass', [400, 600, 700]]]
        .flatMap(([fam, dir, ws]) => ws.map((w) => `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;font-display:swap;src:url(https://fonts.gstatic.com/local/${dir}/files/${dir}-latin-${w}-normal.woff2) format('woff2')}`));
      return route.fulfill({ status: 200, contentType: 'text/css', body: faces.join('\n') });
    }
    if (url.startsWith('https://fonts.gstatic.com/local/') && FONTS) {
      const f = path.join(FONTS, url.slice('https://fonts.gstatic.com/local/'.length));
      if (fs.existsSync(f)) return route.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) });
    }
    return route.abort();
  }
}

/* ---------------- scenari ---------------- */
(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${tag}] ${m.text()}`); });
  };

  // tessera di mappa neutra
  {
    const p = await browser.newPage();
    tilePng = Buffer.from((await p.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'); g.fillStyle = '#ece8e1'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 90); g.lineTo(256, 140); g.moveTo(170, 0); g.lineTo(120, 256); g.stroke();
      g.strokeStyle = '#d9e4cf'; g.lineWidth = 30; g.beginPath(); g.moveTo(-20, 230); g.lineTo(60, 200); g.stroke();
      return c.toDataURL('image/png').split(',')[1];
    })), 'base64');
    await p.close();
  }

  const results = [];
  const step = async (name, fn) => { await fn(); results.push('ok  ' + name); console.log('ok  ' + name); };

  /* --- telefono, primo accesso --- */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT', timezoneId: 'Europe/Rome' });
  await setupRoutes(phone);
  const p = await phone.newPage();
  watch(p, 'telefono');
  await p.goto(base);

  await step('al primo accesso calcola il viaggio di esempio', async () => {
    await p.waitForSelector('#res:not([hidden])', { timeout: 15000 });
    await p.waitForSelector('#check-banner.red', { timeout: 15000 });
    await p.waitForFunction(() => document.querySelectorAll('#parkings .pk:not(.off)').length > 0);
    assert.match(await p.textContent('#sum-km'), /km$/);
    assert.equal(await p.locator('#hazards .hz').count(), 3);
    const tl = await p.textContent('#timeline');
    assert.match(tl, /Partenza/); assert.match(tl, /Arrivo/);
    assert.match(await p.textContent('#mini-sum'), /1 critico/);
    assert.doesNotMatch(await p.textContent('#timeline'), /Pausa/); // 3 h 25 di guida: nessuna pausa obbligatoria
    assert.equal(await p.locator('#warnings li').count(), 0);
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, '1-telefono-percorso.png') });
  });

  await step('permessi: destinazione e partenza riconosciute con le istruzioni', async () => {
    await p.waitForFunction(() => document.querySelectorAll('#permits .pm').length === 2, null, { timeout: 15000 });
    const first = p.locator('#permits .pm').first();
    assert.match(await first.textContent(), /Firenze/);
    assert.match(await first.textContent(), /Serve un permesso/);
    assert.match(await first.textContent(), /Contrassegno ZTL Bus obbligatorio/);
    assert.equal(await first.locator('details.pm-how').evaluate((d) => d.open), true);
    assert.match(await first.locator('a.pm-main').getAttribute('href'), /^https:\/\/servizi\.comune\.fi\.it\//);
    assert.match(await p.locator('#permits .pm').nth(1).textContent(), /Milano.*Ticket Area C/s);
    assert.match(await p.textContent('#sum-chips'), /Permesso bus: Firenze, Milano/);
    assert.match(await p.textContent('#timeline'), /Firenze: serve un permesso per il bus/);
    await p.evaluate(() => { const pb = document.querySelector('#panel-body'); pb.scrollTop += document.querySelector('#permits-sec').getBoundingClientRect().top - pb.getBoundingClientRect().top - 8; });
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(OUT, '2b-telefono-permessi.png') });
  });

  await step('punti critici: dal riquadro alla mappa, con scheda dettagliata', async () => {
    await p.evaluate(() => { document.querySelector('#panel-body').scrollTop = 0; });
    const pts = p.locator('#check-banner .check-pt');
    assert.equal(await pts.count(), 3);
    assert.match(await pts.nth(2).textContent(), /Divieto per mezzi pesanti.*km \d+ · verso le \d\d:\d\d/s);
    await pts.nth(2).click();
    await p.waitForSelector('.hz-popup .hzpop', { timeout: 5000 });
    const card = await p.textContent('.hz-popup .hzpop');
    assert.match(card, /Divieto per mezzi pesanti/);
    assert.match(card, /Strada percorsa\s*A1, E35\s*Strada del limite\s*Via dei Colli/);
    assert.match(card, /Ci arrivi/);
    assert.match(card, /Cosa fare: .*camion.*autobus/s);
    await p.waitForFunction(() => /Viale Galileo/.test(document.querySelector('.hz-popup .hzpop').textContent), null, { timeout: 5000 });
    assert.equal(await p.locator('.hz-marker.focus').count(), 1);
    // la scheda resta nell'area visibile della mappa, sopra il pannello (dopo lo spostamento animato)
    await p.waitForTimeout(800);
    const box = await p.locator('.hz-popup').boundingBox();
    const panelTop = await p.evaluate(() => document.querySelector('#panel').getBoundingClientRect().top);
    assert.ok(box.y >= 0 && box.y + box.height <= panelTop + 1, `scheda ${Math.round(box.y)}–${Math.round(box.y + box.height)}, pannello da ${Math.round(panelTop)}`);
    await p.screenshot({ path: path.join(OUT, '2c-telefono-scheda-punto.png') });
    await p.evaluate(() => window.__rp.map.closePopup());
    await p.click('#grip');
  });

  await step('elenco punti critici con cartelli', async () => {
    await p.evaluate(() => { const s = document.querySelector('#hazards').closest('.res-sec'); document.querySelector('#panel-body').scrollTop = s.offsetTop - 10; });
    await p.waitForTimeout(200);
    const first = await p.textContent('#hazards .hz');
    assert.match(first, /Altezza massima 3,5 m/);
    assert.match(first, /Non transitabile/);
    await p.screenshot({ path: path.join(OUT, '2-telefono-punti-critici.png') });
  });

  await step('pause frazionate scelgono l\'area di servizio sul proprio lato', async () => {
    await p.click('#tab-viaggio');
    await p.selectOption('#in-breaks', 'frazionata');
    await p.click('#tab-percorso');
    const tl = await p.textContent('#timeline');
    assert.match(tl, /Pausa 15′/);
    assert.match(tl, /Secchia Est/);
    assert.doesNotMatch(tl, /Secchia Ovest/);
    assert.ok(await p.locator('.brk-marker').count() >= 1);
    // tutte le aree di servizio dalla propria carreggiata, con la pausa prevista segnata
    const sv = await p.textContent('#services');
    assert.match(sv, /Area di servizio Arda.*Area di servizio · km \d+ · verso le \d\d:\d\d/s);
    assert.match(sv, /Area di servizio Secchia Est.*Pausa prevista/s);
    assert.doesNotMatch(sv, /Secchia Ovest/);
    assert.equal(await p.textContent('#sv-count'), '2');
    assert.equal(await p.locator('.sv-marker').count(), 1, 'la pausa ha già il suo segno');
    // fonti ufficiali su traffico e cantieri, anche senza chiave TomTom
    const src = await p.textContent('#traffic .tr-sources');
    assert.match(src, /CCISS Viaggiare informati.*A1: Autostrade per l'Italia.*ANAS/s);
    assert.match(await p.getAttribute('#traffic .tr-sources a:has-text("Autostrade per l\'Italia")', 'href'), /autostrade\.it/);
    await p.evaluate(() => document.querySelector('#services-sec').scrollIntoView({ block: 'start' }));
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, '21-aree-di-servizio.png') });
    await p.evaluate(() => document.querySelector('#traffic-sec').scrollIntoView({ block: 'start' }));
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, '21a-fonti-traffico.png') });
  });

  await step('scheda mezzo e cambio a bipiano: il ponte da 3,9 m diventa non transitabile', async () => {
    await p.click('#tab-mezzo');
    await p.screenshot({ path: path.join(OUT, '3-telefono-mezzo.png') });
    await p.selectOption('#in-preset', 'p:dd14');
    await p.click('#tab-percorso');
    await p.waitForSelector('#stale:not([hidden])');
    await p.click('#btn-recalc');
    await p.waitForFunction(() => /Ponte sul Reno/.test(document.querySelector('#hazards').textContent) && document.querySelectorAll('#hazards .sev-red-bg').length === 2);
  });

  await step('tappa intermedia con ricerca indirizzo e ricalcolo automatico', async () => {
    await p.click('#tab-viaggio');
    await p.click('#btn-add-stop');
    const input = p.locator('#stops li:nth-child(2) input');
    await input.fill('Bolo');
    await p.waitForSelector('.ac li[role=option] b');
    await p.screenshot({ path: path.join(OUT, '4-telefono-ricerca.png') });
    await p.locator('.ac li[role=option]').first().click();
    await p.selectOption('#stops li:nth-child(2) select', '60');
    await p.waitForFunction(() => /Tappa B: Bologna/.test(document.querySelector('#timeline').textContent), null, { timeout: 10000 });
    const tl = await p.textContent('#timeline');
    assert.match(tl, /Sosta 1 h/);
    await p.waitForFunction(() => /Bologna/.test(document.querySelector('#permits').textContent), null, { timeout: 15000 });
    const bo = p.locator('#permits .pm', { hasText: 'Bologna' });
    assert.match(await bo.textContent(), /Accesso limitato/);
    assert.match(await bo.textContent(), /Tappa B/);
    assert.equal(await p.locator('.pin').count(), 3);
    // parcheggi: una sola ricerca, intorno all'arrivo (per bus fino a 5 km, da mostrare entro 1 km)
    await p.waitForFunction(() => /Arrivo · /.test(document.querySelector('#parkings').textContent), null, { timeout: 15000 });
    const lastQ = mocks.parkingQueries[mocks.parkingQueries.length - 1];
    assert.equal(lastQ.length, 1);
    assert.equal(lastQ[0].radius, 5000);
    assert.ok(Math.abs(lastQ[0].lat - 43.7629) < 0.01, 'cerca intorno all\'arrivo');
    assert.doesNotMatch(await p.textContent('#parkings'), /troppo lontano|Bologna/);
    // parcheggi e fermate ufficiali del Comune, con la fonte; collegamento a Park Your Bus
    const offTxt = await p.textContent('#parkings');
    assert.match(offTxt, /Parcheggi e fermate ufficiali per i bus.*Piazzale Michelangelo.*Salita e discesa.*sosta massima 20 minuti/s);
    assert.ok(await p.locator('#parkings .pk.off').count() >= 4);
    assert.match(await p.getAttribute('#parkings .pk.off a:has-text("Fonte ufficiale")', 'href'), /serviziallastrada\.it/);
    assert.match(await p.getAttribute('#parkings a:has-text("Apri Park Your Bus")', 'href'), /apps\.apple\.com|play\.google\.com/);
    assert.ok(await p.locator('.pk-marker.off').count() >= 4);
    assert.equal(await p.locator('#parkings .pk:not(.off)').count(), 2);
  });

  await step('esportazione GPX', async () => {
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btn-gpx')]);
    const file = await dl.path();
    const gpx = fs.readFileSync(file, 'utf8');
    assert.match(gpx, /<trkpt/);
    assert.match(gpx, /ATTENZIONE: Altezza massima 3,5 m/);
    assert.match(dl.suggestedFilename(), /^rotta-pullman-milano-firenze\.gpx$/);
  });

  await step('errore chiaro quando nessun percorso è compatibile', async () => {
    mocks.forceRouteError = true;
    await p.click('#tab-viaggio');
    await p.click('#btn-route');
    await p.waitForSelector('#route-error:not([hidden])');
    assert.match(await p.textContent('#route-error'), /Nessun percorso per questo mezzo.*spostala dove il pullman si ferma/s);
    mocks.forceRouteError = false;
    await p.screenshot({ path: path.join(OUT, '5-telefono-viaggio.png') });
  });

  await step('tocco sulla mappa per impostare l\'arrivo', async () => {
    await p.evaluate(() => window.__rp.map.setView([43.77, 11.25], 13));
    await p.evaluate(() => { const ph = document.querySelector('#panel'); ph.style.setProperty('--sheet-h', '150px'); });
    await p.waitForTimeout(400);
    await p.mouse.click(200, 250);
    await p.waitForSelector('.pt-menu');
    await p.click('.pt-menu button:has-text("Arrivo")');
    await p.waitForFunction(() => /Viale Galileo/.test(document.querySelector('#stops').innerHTML) || /Viale Galileo/.test(JSON.stringify(window.__rp.state.stops)));
  });

  /* --- un tratto del controllo non risponde, poi si riprova --- */
  await phone.close(); // il contatore delle richieste simulate è condiviso: niente altre pagine attive
  {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await setupRoutes(pctx);
    mocks.parkingFail = 1;
    mocks.maxInflight = 0;
    const q = await pctx.newPage();
    watch(q, 'parcheggi 429');
    await q.goto(base);
    await step('parcheggi: server occupato, attesa e risultato senza errori', async () => {
      await q.waitForFunction(() => document.querySelectorAll('#parkings .pk:not(.off)').length > 0, null, { timeout: 20000 });
      assert.doesNotMatch(await q.textContent('#parkings'), /non riuscita/);
      assert.equal(mocks.parkingFail, 0);
      await q.waitForSelector('#check-banner.red', { timeout: 20000 });
      assert.equal(mocks.maxInflight, 1, 'le richieste a Overpass devono partire una alla volta');
    });
    await pctx.close();
  }
  {
    const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(rctx);
    mocks.corridorCalls = 0;
    mocks.failCorridor = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10]); // il 2° tratto fallisce: 3 server, 3 tentativi ciascuno
    const q = await rctx.newPage();
    watch(q, 'tratto mancante');
    await q.goto(base);
    mocks.delay = 250;
    await q.waitForSelector('#check-banner .progress', { timeout: 15000 });
    await q.waitForTimeout(1200);
    await q.screenshot({ path: path.join(OUT, '8-controllo-in-corso.png') });
    mocks.delay = 0;
    await step('controllo a tratti: un tratto senza risposta si può riprovare', async () => {
      const total = await q.evaluate(async () => {
        while (!window.__rp.state.route || !window.__rp.state.route.segments) await new Promise((r) => setTimeout(r, 50));
        return window.__rp.state.route.segments.length;
      });
      assert.ok(total >= 10, `tratti: ${total}`);
      await q.waitForSelector('#check-banner button:has-text("Verifica i tratti mancanti")', { timeout: 20000 });
      assert.match(await q.textContent('#check-banner'), new RegExp(`1 tratto su ${total} non verificato`));
      await q.screenshot({ path: path.join(OUT, '9-tratto-mancante.png') });
      assert.equal(await q.locator('#hazards .hz').count(), 3); // gli altri tratti hanno comunque dato i risultati
      mocks.failCorridor = new Set();
      await q.click('#check-banner button:has-text("Verifica i tratti mancanti")');
      await q.waitForFunction(() => window.__rp.state.analysis.status === 'done');
      assert.doesNotMatch(await q.textContent('#check-banner'), /mancanti/);
      assert.equal(await q.locator('.leaflet-tile-container img[src*="tile.openstreetmap.org"]').count() > 0, true);
    });
    await rctx.close();
  }

  /* --- dati scaricati: niente Overpass per i tratti in Italia --- */
  {
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(dctx);
    mocks.dati = true;
    mocks.corridorCalls = 0;
    mocks.parkingQueries = [];
    mocks.datiRichieste = 0;
    const q = await dctx.newPage();
    watch(q, 'dati scaricati');
    await q.goto(base);
    await step('dati scaricati: controllo e parcheggi senza chiamare Overpass', async () => {
      await q.waitForSelector('#check-banner.red', { timeout: 20000 });
      await q.waitForFunction(() => document.querySelectorAll('#parkings .pk:not(.off)').length > 0, null, { timeout: 20000 });
      assert.equal(mocks.corridorCalls, 0, 'nessuna richiesta Overpass per il controllo');
      assert.equal(mocks.parkingQueries.length, 0, 'nessuna richiesta Overpass per i parcheggi');
      assert.ok(mocks.datiRichieste >= 2);
      assert.equal(await q.locator('#hazards .hz').count(), 3);
      assert.match(await q.textContent('#check-banner'), /Dati OpenStreetMap del 25 ottobre 2026\./);
      assert.equal(await q.locator('#parkings .pk:not(.off)').count(), 2);
      assert.doesNotMatch(await q.textContent('#parkings'), /troppo lontano/);
      // le pause usano le aree di servizio dei dati scaricati
      await q.click('#tab-viaggio');
      await q.selectOption('#in-breaks', 'frazionata');
      await q.click('#tab-percorso');
      assert.match(await q.textContent('#timeline'), /Secchia Est/);
      // secondo calcolo: i riquadri restano sul dispositivo
      const before = mocks.datiRichieste;
      await q.evaluate(() => window.__rp.computeRoute());
      await q.waitForSelector('#check-banner.red', { timeout: 20000 });
      await q.waitForFunction(() => window.__rp.state.analysis.status === 'done');
      assert.ok(mocks.datiRichieste - before <= 1, 'al massimo l\'indice, non i riquadri');
      await q.screenshot({ path: path.join(OUT, '10-dati-scaricati.png') });
    });
    await step('dati scaricati solo per una parte del percorso: il resto con Overpass', async () => {
      // copertura solo a nord di 44,6° (come se il resto fosse all'estero)
      mocks.datiCopertura = [[[44.6, 6], [48, 6], [48, 19], [44.6, 19], [44.6, 6]]];
      mocks.corridorCalls = 0;
      const p2 = await dctx.newPage();
      watch(p2, 'copertura parziale');
      await p2.goto(base);
      await p2.evaluate(() => window.__rp.computeRoute()); // stessa memoria della pagina precedente: niente calcolo automatico
      await p2.waitForSelector('#check-banner.red', { timeout: 30000 });
      await p2.waitForFunction(() => window.__rp.state.analysis.status === 'done', null, { timeout: 30000 });
      const segs = await p2.evaluate(() => window.__rp.state.route.segments.length);
      assert.ok(mocks.corridorCalls > 0 && mocks.corridorCalls < segs, `Overpass solo per una parte: ${mocks.corridorCalls} di ${segs}`);
      assert.match(await p2.textContent('#check-banner'), /per i tratti fuori Italia, dati in tempo reale/);
      assert.equal(await p2.locator('#hazards .hz').count(), 3);
      mocks.datiCopertura = null;
    });
    mocks.dati = false;
    await dctx.close();
  }

  /* --- seconda verifica con TomTom e foto Mapillary --- */
  {
    const tctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(tctx);
    mocks.tomtomUrls = [];
    const q = await tctx.newPage();
    watch(q, 'tomtom');
    await q.goto(base);
    await q.waitForSelector('#check-banner.red', { timeout: 20000 });
    await step('seconda verifica TomTom: conferme, smentite e limiti che OSM non ha', async () => {
      await q.click('#tab-viaggio');
      await q.click('#opt-details summary');
      await q.fill('#opt-tomtomkey', 'CHIAVE-PROVA');
      await q.press('#opt-tomtomkey', 'Tab');
      await q.fill('#opt-mapillary', 'TOKEN-PROVA');
      await q.press('#opt-mapillary', 'Tab');
      await q.click('#btn-route');
      await q.waitForFunction(() => /Seconda verifica con TomTom: 2 tratti evitati/.test(document.querySelector('#check-banner').textContent), null, { timeout: 20000 });
      assert.equal(mocks.tomtomUrls.length, 2);
      const busUrl = mocks.tomtomUrls.find((u) => /travelMode=bus/.test(u));
      assert.match(busUrl, /vehicleHeight=3\.85/);
      assert.match(busUrl, /vehicleWeight=25000/);
      assert.match(busUrl, /key=CHIAVE-PROVA/);
      await q.waitForFunction(() => window.__rp.state.analysis.status === 'done' && document.querySelectorAll('#hazards .hz').length === 4, null, { timeout: 30000 });
      const items = await q.locator('#hazards .hz').allTextContents();
      assert.ok(items.some((t) => /Tratto evitato da TomTom/.test(t)), 'tratto segnalato solo da TomTom');
      assert.ok(items.some((t) => /Altezza massima 3,9 m.*TomTom non usa questo tratto con il tuo mezzo/s.test(t)), 'ponte confermato');
      assert.ok(items.some((t) => /Divieto per mezzi pesanti.*TomTom percorre/s.test(t)), 'divieto camion smentito');
      assert.match(await q.textContent('#check-banner'), /Vedi tutti i 4 punti/);
      // scheda del sottopasso: data, fonte, dubbio, foto e cartelli Mapillary, segnalazione
      await q.locator('#check-banner .check-pt').first().click();
      await q.waitForSelector('.hz-popup .hzpop-photo img', { timeout: 8000 });
      const card = await q.textContent('.hz-popup .hzpop');
      assert.match(card, /Dato OpenStreetMap: modificato il 2 maggio 2014 \(versione 3\) · fonte: cartello stradale\./);
      assert.match(card, /Dato non aggiornato da 12 anni/);
      assert.match(card, /Cartelli rilevati nelle foto Mapillary: altezza massima/);
      assert.match(card, /i due dati non concordano/); // OSM: 3,5 m non transitabile, TomTom invece passa
      assert.equal(await q.locator('.hz-popup a', { hasText: 'Segnala un errore' }).count(), 1);
      assert.match(await q.locator('.hz-popup a', { hasText: 'Segnala un errore' }).getAttribute('href'), /openstreetmap\.org\/note\/new#map=19\//);
      await q.screenshot({ path: path.join(OUT, '11-scheda-verifiche.png') });
      // le chiavi non finiscono nel link condiviso
      const shared = await q.evaluate(() => RPCore.encodeShare(window.__rp.state));
      assert.doesNotMatch(Buffer.from(shared.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(), /CHIAVE-PROVA|TOKEN-PROVA/);
    });
    await tctx.close();
  }

  /* --- limite "vicino al percorso": segnalato a parte, l'operatore decide --- */
  {
    const vctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(vctx);
    mocks.vicino = true;
    const q = await vctx.newPage();
    watch(q, 'vicino');
    await q.goto(base);
    await step('limite vicino al percorso: segnalato con «?» e deciso dall\'operatore', async () => {
      await q.waitForFunction(() => window.__rp.state.analysis && window.__rp.state.analysis.status === 'done', null, { timeout: 30000 });
      assert.equal(await q.locator('#hazards .hz').count(), 4);
      assert.equal(await q.locator('#hazards .hz.maybe').count(), 1);
      assert.match(await q.textContent('#hazards .hz.maybe'), /Forse non sul percorso · a 4 m.*Altezza massima 3,2 m/s);
      assert.equal(await q.locator('.hz-marker.maybe').count(), 1);
      // il punto vicino non conta tra i non transitabili sul percorso
      assert.match(await q.textContent('#check-banner'), /^1 punto non transitabile/);
      assert.match(await q.textContent('#check-banner'), /anche 1 limite su strade a pochi metri/);
      assert.match(await q.textContent('#mini-sum'), /1 critico/);
      // scheda: spiegazione e decisione
      await q.locator('#hazards .hz.maybe button', { hasText: 'Mostra sulla mappa' }).click();
      await q.waitForSelector('.hz-popup .hzpop-maybe', { timeout: 5000 });
      const card = await q.textContent('.hz-popup .hzpop');
      assert.match(card, /Distanza dal percorso\s*4 m/);
      assert.match(card, /non risulta né su un ponte né in galleria/);
      await q.waitForTimeout(700);
      await q.screenshot({ path: path.join(OUT, '12a-vicino-scheda.png') });
      await q.locator('.hz-popup button', { hasText: 'Non riguarda il percorso' }).click();
      await q.waitForFunction(() => document.querySelectorAll('#hazards .hz').length === 3);
      assert.equal(await q.locator('.hz-marker.maybe').count(), 0);
      assert.match(await q.textContent('#hazards'), /Esclusi perché non riguardano il percorso \(1\)/);
      assert.doesNotMatch(await q.textContent('#check-banner'), /pochi metri/);
      // la decisione resta per lo stesso viaggio anche dopo aver ricaricato
      await q.reload();
      await q.evaluate(() => window.__rp.computeRoute());
      await q.waitForFunction(() => window.__rp.state.analysis && window.__rp.state.analysis.status === 'done', null, { timeout: 30000 });
      assert.equal(await q.locator('#hazards .hz').count(), 3);
      // ripristina e poi conferma: diventa un allarme pieno
      await q.click('.hz-excluded summary');
      await q.click('.hz-excluded button:has-text("Ripristina")');
      await q.waitForFunction(() => document.querySelectorAll('#hazards .hz.maybe').length === 1);
      await q.locator('#hazards .hz.maybe button', { hasText: 'Mostra sulla mappa' }).click();
      await q.waitForSelector('.hz-popup .hzpop-maybe', { timeout: 5000 });
      await q.locator('.hz-popup').getByRole('button', { name: 'Riguarda il percorso', exact: true }).click();
      await q.waitForFunction(() => document.querySelectorAll('#hazards .hz').length === 4 && document.querySelectorAll('#hazards .hz.maybe').length === 0);
      assert.match(await q.textContent('#check-banner'), /^2 punti non transitabili/);
      await q.screenshot({ path: path.join(OUT, '12-vicino-confermato.png') });
    });
    mocks.vicino = false;
    await vctx.close();
  }

  /* --- divieto a giorni e orari: in vigore o no secondo il giorno di passaggio --- */
  {
    const octx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(octx);
    mocks.orario = true;
    mocks.dateTimes = [];
    const q = await octx.newPage();
    watch(q, 'orario');
    await q.goto(base);
    await step('divieto a orario: in vigore il lunedì, non la domenica', async () => {
      await q.waitForFunction(() => window.__rp.state.analysis && window.__rp.state.analysis.status === 'done', null, { timeout: 30000 });
      // il calcolo del percorso riceve data e ora di partenza
      assert.match(String(mocks.dateTimes[0] && mocks.dateTimes[0].value), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      const setDeparture = (v) => q.evaluate((val) => {
        const el = document.querySelector('#in-departure');
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, v);
      // lunedì: il divieto vale quando passa il bus
      await setDeparture('2030-01-14T06:00');
      await q.waitForFunction(() => /Vietato al passaggio/.test(document.querySelector('#hazards').textContent));
      const item = q.locator('#hazards > .hz', { hasText: 'in certi orari' });
      assert.equal(await item.count(), 1);
      const txt = await item.textContent();
      assert.match(txt, /Divieto di transito per bus in certi orari/);
      assert.match(txt, /Quando vale: autobus: vietato lun–ven/);
      assert.match(txt, /In vigore quando passi \(lun 14 gen, \d\d:\d\d\)/);
      assert.match(await q.textContent('#check-banner'), /^2 punti non transitabili/);
      assert.match(await q.textContent('#check-banner'), /non per gli autobus/);
      // domenica: non vale, finisce tra i divieti non in vigore
      await setDeparture('2030-01-13T06:00');
      await q.waitForFunction(() => document.querySelectorAll('#hazards .hz-quiet .hz').length === 1);
      assert.equal(await q.locator('#hazards > .hz', { hasText: 'in certi orari' }).count(), 0);
      assert.match(await q.textContent('#check-banner'), /^1 punto non transitabile/);
      assert.match(await q.textContent('#check-banner'), /1 divieto a giorni e orari sul percorso non è in vigore quando passi/);
      assert.equal(await q.locator('.hz-marker.info').count(), 1);
      await q.click('.hz-quiet summary');
      assert.match(await q.textContent('.hz-quiet'), /Non in vigore quando passi \(dom 13 gen/);
      await q.locator('.hz-quiet button', { hasText: 'Mostra sulla mappa' }).click();
      await q.waitForSelector('.hz-popup .hzpop', { timeout: 5000 });
      const card = await q.textContent('.hz-popup .hzpop');
      assert.match(card, /Non in vigore al passaggio/i);
      assert.match(card, /Quando vale\s*autobus: vietato lun–ven/);
      assert.match(card, /Ci arrivi\s*dom 13 gen/);
      await q.waitForTimeout(700);
      await q.screenshot({ path: path.join(OUT, '13-orario-domenica.png') });
      await q.keyboard.press('Escape');
      await setDeparture('2030-01-14T06:00');
      await q.waitForFunction(() => /Vietato al passaggio/.test(document.querySelector('#hazards').textContent));
      await q.locator('#hazards > .hz', { hasText: 'in certi orari' }).locator('button', { hasText: 'Mostra sulla mappa' }).click();
      await q.waitForSelector('.hz-popup .hzpop', { timeout: 5000 });
      await q.waitForTimeout(700);
      await q.screenshot({ path: path.join(OUT, '13a-orario-lunedi.png') });
    });
    mocks.orario = false;
    await octx.close();
  }

  /* --- nessun parcheggio per bus entro 1 km: il più vicino oltre, i piazzali grandi, la segnalazione --- */
  {
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(pctx);
    mocks.parkNoBus = true;
    const q = await pctx.newPage();
    watch(q, 'parcheggi paese');
    await q.goto(base);
    await step('parcheggi in un paese: il più vicino oltre 1 km e i piazzali grandi da verificare', async () => {
      await q.waitForFunction(() => window.__rp.state.parkings && window.__rp.state.parkings.status === 'done', null, { timeout: 30000 });
      const txt = await q.textContent('#parkings');
      assert.match(txt, /Nessun parcheggio per bus segnato su OpenStreetMap entro 1 km/);
      assert.match(txt, /Il più vicino, oltre 1 km.*Parcheggio bus Stazione.*a 2,8 km dall'arrivo/s);
      assert.match(txt, /Parcheggi grandi entro 1 km, non segnati per bus.*Piazzale del mercato.*Da verificare.*circa 3\.600 m².*gratuito/s);
      assert.doesNotMatch(txt, /Parcheggio piccolo/);
      assert.equal(await q.locator('.pk-marker.gen').count(), 1);
      assert.equal(await q.locator('.pk-marker:not(.gen):not(.off)').count(), 1);
      assert.match(await q.getAttribute('.pk-report a', 'href'), /openstreetmap\.org\/note\/new#map=17\//);
      await q.locator('#parkings').scrollIntoViewIfNeeded();
      await q.waitForTimeout(300);
      await q.screenshot({ path: path.join(OUT, '14-parcheggi-paese.png') });
      await q.locator('.pk.gen button', { hasText: 'Vista satellite' }).click();
      await q.waitForFunction(() => window.__rp.state.base === 'satellite');
      assert.equal(await q.isChecked('#base-satellite'), true);
    });
    mocks.parkNoBus = false;
    await pctx.close();
  }

  /* --- percorso non trovato: l'app dice quale tappa e quali strade la bloccano --- */
  {
    const nctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(nctx);
    mocks.dati = true;
    mocks.blockDest = true;
    mocks.forceRouteError = true;
    mocks.lastCoords = null;
    const q = await nctx.newPage();
    watch(q, 'nessun percorso');
    await q.goto(base);
    await step('percorso non trovato: indica le strade chiuse al mezzo vicino all\'arrivo', async () => {
      await q.waitForSelector('#route-error .noroute-list', { timeout: 20000 });
      const txt = await q.textContent('#route-error');
      assert.match(txt, /Vicino all'arrivo \(.*\) ci sono strade chiuse al mezzo/);
      assert.match(txt, /Via alla Cascata: altezza massima 1,9 m, larghezza massima 2,3 m · a \d+ m/);
      assert.doesNotMatch(txt, /Via Lontana/);
      await q.locator('#route-error').scrollIntoViewIfNeeded();
      await q.screenshot({ path: path.join(OUT, '15-percorso-non-trovato.png') });
    });
    mocks.forceRouteError = false;
    mocks.blockDest = false;
    mocks.dati = false;
    await nctx.close();
  }

  /* --- arrivo irraggiungibile: il percorso arriva da solo alla strada più vicina --- */
  {
    const uctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(uctx);
    Object.assign(mocks, { dati: true, blockDest: true, unreachableDest: true, lastCoords: null, valhallaBodies: [] });
    const q = await uctx.newPage();
    watch(q, 'arrivo irraggiungibile');
    await q.goto(base);
    await step('arrivo irraggiungibile: il percorso arriva da solo alla strada più vicina', async () => {
      await q.waitForFunction(() => /Arrivo spostato/.test(document.querySelector('#route-notes').textContent), null, { timeout: 30000 });
      const txt = await q.textContent('#route-notes');
      assert.match(txt, /Arrivo spostato: «Firenze, Piazzale Michelangelo» non si raggiunge in pullman/);
      assert.match(txt, /Strade chiuse al mezzo: Via alla Cascata \(altezza massima 1,9 m, larghezza massima 2,3 m\)/);
      assert.match(txt, /Il pullman arriva alla strada raggiungibile più vicina.*circa \d+ m a piedi \(\d+ min\) fino alla meta/);
      const last = (b) => b.locations[b.locations.length - 1];
      assert.ok(mocks.valhallaBodies.some((b) => last(b).radius === 200), 'ricalcolo con raggio di ricerca sull\'arrivo');
      assert.ok(!mocks.valhallaBodies.some((b) => b.locations[0].radius), 'la partenza non si sposta');
      assert.equal(await q.locator('.drop-marker').count(), 1);
      assert.equal(await q.isHidden('#route-error'), true);
      await q.locator('#route-notes button', { hasText: 'Mostra sulla mappa' }).first().click();
      await q.waitForTimeout(800);
      await q.screenshot({ path: path.join(OUT, '16-arrivo-spostato.png') });
    });
    Object.assign(mocks, { dati: false, blockDest: false, unreachableDest: false });
    await uctx.close();
  }

  /* --- punto non transitabile sul percorso: alternativa automatica --- */
  {
    const actx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(actx);
    Object.assign(mocks, { honorExclude: true, fixedCoords: null, lastCoords: null, valhallaBodies: [] });
    const q = await actx.newPage();
    watch(q, 'alternativa');
    await q.goto(base);
    await step('punto non transitabile: alternativa automatica, confronto e scelta dell\'operatore', async () => {
      await q.waitForFunction(() => /Percorso alternativo/.test(document.querySelector('#route-notes').textContent), null, { timeout: 40000 });
      await q.waitForFunction(() => window.__rp.state.analysis && window.__rp.state.analysis.status === 'done', null, { timeout: 30000 });
      const notes = await q.textContent('#route-notes');
      assert.match(notes, /Percorso alternativo: evita un punto non transitabile/);
      assert.match(notes, /Altezza massima 3,5 m · Sottopasso ferroviario/);
      assert.match(notes, /Rispetto al più veloce: \+[\d,.]+ (km|m) di strada, \+.+ di guida/);
      const ex = mocks.valhallaBodies.filter((b) => b.exclude_locations);
      assert.equal(ex.length, 1);
      assert.equal(ex[0].exclude_locations.length, 1);
      assert.doesNotMatch(await q.textContent('#check-banner'), /non transitabil/);
      await q.screenshot({ path: path.join(OUT, '17-alternativa.png') });
      // il più veloce, su richiesta
      await q.click('#route-notes button:has-text("Mostra il percorso più veloce")');
      await q.waitForFunction(() => /Questo è il percorso più veloce/.test(document.querySelector('#route-notes').textContent), null, { timeout: 30000 });
      assert.match(await q.textContent('#check-banner'), /^1 punto non transitabile/);
      // l'operatore sceglie di evitare un punto dalla lista
      await q.locator('#hazards > .hz', { hasText: 'Altezza massima 3,5 m' }).locator('button', { hasText: 'Evita questo punto' }).click();
      await q.waitForFunction(() => /Percorso che evita il punto scelto/.test(document.querySelector('#route-notes').textContent), null, { timeout: 30000 });
    });
    Object.assign(mocks, { honorExclude: false, fixedCoords: null });
    await actx.close();
  }

  /* --- limite su una strada sotto il viadotto percorso (caso Park Piovese) --- */
  {
    const bctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(bctx);
    Object.assign(mocks, { viaduct: true, traceFail: false, traceCalls: 0, lastCoords: null, fixedCoords: null });
    const q = await bctx.newPage();
    watch(q, 'viadotto');
    await q.goto(base);
    await step('limite sotto il viadotto: escluso in automatico grazie alle strade riconosciute, ripristinabile', async () => {
      await q.waitForFunction(() => window.__rp.state.analysis && window.__rp.state.analysis.status === 'done', null, { timeout: 30000 });
      assert.ok(mocks.traceCalls >= 1, 'strade del percorso chieste a Valhalla');
      assert.doesNotMatch(await q.textContent('#hazards > .hz:not(.maybe)') || '', /2,2 m/);
      assert.equal(await q.locator('#hazards > .hz', { hasText: 'Altezza massima 2,2 m' }).count(), 0);
      assert.match(await q.textContent('#check-banner'), /^1 punto non transitabile/);
      await q.click('.hz-excluded summary');
      const ex = await q.textContent('.hz-excluded');
      assert.match(ex, /Altezza massima 2,2 m.*passa sotto o sopra il percorso/s);
      await q.screenshot({ path: path.join(OUT, '18-viadotto-escluso.png') });
      await q.click('.hz-excluded button:has-text("Ripristina")');
      await q.waitForFunction(() => /^2 punti non transitabili/.test(document.querySelector('#check-banner').textContent));
    });
    // se il riconoscimento delle strade non risponde: regola di riserva, il limite è solo "forse"
    mocks.traceFail = true;
    await q.evaluate(() => { try { localStorage.removeItem('rotta-pullman/decisioni'); } catch (e) { /* */ } });
    await q.reload();
    await step('senza strade riconosciute: stradina di servizio sotto una strada con nome segnata come "forse"', async () => {
      await q.evaluate(() => window.__rp.computeRoute());
      await q.waitForFunction(() => window.__rp.state.analysis && window.__rp.state.analysis.status === 'done', null, { timeout: 40000 });
      const item = q.locator('#hazards > .hz.maybe', { hasText: 'Altezza massima 2,2 m' });
      assert.equal(await item.count(), 1);
      assert.match(await q.textContent('#check-banner'), /non sono state riconosciute una per una/);
      await item.locator('button', { hasText: 'Mostra sulla mappa' }).click();
      await q.waitForSelector('.hz-popup .hzpop-maybe', { timeout: 5000 });
      assert.match(await q.textContent('.hz-popup .hzpop-maybe'), /stradina di servizio senza nome che sulla mappa coincide con/);
    });
    Object.assign(mocks, { viaduct: false, traceFail: false });
    await bctx.close();
  }

  /* --- traffico e cantieri (TomTom Traffic) --- */
  {
    const rctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(rctx);
    Object.assign(mocks, { traffic: true, incidentCalls: 0, honorExclude: false, fixedCoords: null, lastCoords: null });
    const q = await rctx.newPage();
    watch(q, 'traffico');
    await q.goto(base);
    await q.waitForSelector('#check-banner.red', { timeout: 20000 });
    await step('traffico e cantieri: segnalazioni al passaggio, ritardo, aggiornamento, chiusura evitata', async () => {
      assert.match(await q.textContent('#traffic'), /aggiungi la chiave TomTom/);
      await q.click('#tab-viaggio');
      await q.click('#opt-details summary');
      await q.fill('#opt-tomtomkey', 'CHIAVE-PROVA');
      await q.press('#opt-tomtomkey', 'Tab');
      // partenza tra 20 minuti: il traffico di adesso conta
      await q.evaluate(() => {
        const d = new Date(Date.now() + 20 * 60e3), p = (n) => String(n).padStart(2, '0');
        const el = document.querySelector('#in-departure');
        el.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await q.click('#btn-route');
      await q.waitForFunction(() => window.__rp.state.traffic && window.__rp.state.traffic.status === 'done', null, { timeout: 30000 });
      await q.waitForFunction(() => window.__rp.state.analysis && window.__rp.state.analysis.status === 'done', null, { timeout: 30000 });
      const txt = await q.textContent('#traffic');
      assert.match(txt, /Strada chiusa · SS65.*Chiusa al passaggio.*Pianoro → Sasso Marconi/s);
      assert.match(txt, /Coda · A1.*Al tuo passaggio.*Parma → Reggio Emilia.*ritardo \+10 min/s);
      assert.match(txt, /Cantiere · A1.*Lavori in corso/s);
      assert.doesNotMatch(txt, /Incidente/, 'la carreggiata opposta si scarta');
      assert.match(txt, /Altre segnalazioni, non valide al tuo passaggio \(1\)/);
      assert.match(txt, /Con il traffico segnalato ora: circa \+12 min/);
      assert.match(await q.textContent('#sum-chips'), /Traffico ora \+12 min/);
      assert.match(await q.textContent('#check-banner'), /Traffico e cantieri al tuo passaggio: 1 strada chiusa, 2 altre segnalazioni/);
      assert.equal(await q.locator('.tr-marker').count(), 4);
      assert.match(await q.getAttribute('#traffic a:has-text("CCISS Viaggiare informati")', 'href'), /cciss\.it/);
      const before = mocks.incidentCalls;
      await q.click('#traffic button:has-text("Aggiorna il traffico")');
      for (let i = 0; i < 50 && mocks.incidentCalls === before; i++) await q.waitForTimeout(100);
      assert.ok(mocks.incidentCalls > before, 'aggiornamento manuale');
      await q.locator('#traffic-sec').scrollIntoViewIfNeeded();
      await q.locator('.tr-marker.red').click();
      await q.waitForSelector('.hz-popup .hzpop', { timeout: 5000 });
      assert.match(await q.textContent('.hz-popup .hzpop'), /La strada è chiusa quando passi/);
      await q.waitForTimeout(500);
      await q.screenshot({ path: path.join(OUT, '19-traffico.png') });
      // con un'alternativa disponibile, la strada chiusa si evita da sola
      mocks.honorExclude = true;
      mocks.fixedCoords = null;
      await q.click('#tab-viaggio');
      await q.click('#btn-route');
      await q.waitForFunction(() => /Percorso alternativo/.test(document.querySelector('#route-notes').textContent), null, { timeout: 40000 });
      assert.match(await q.textContent('#route-notes'), /Strada chiusa · SS65/);
    });
    Object.assign(mocks, { traffic: false, honorExclude: false, fixedCoords: null });
    await rctx.close();
  }

  /* --- luoghi e attrazioni lungo il percorso --- */
  {
    const lctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(lctx);
    Object.assign(mocks, { dati: true, places: true, lastCoords: null, matrixCalls: 0 });
    const q = await lctx.newPage();
    watch(q, 'luoghi');
    await q.goto(base);
    await q.waitForFunction(() => window.__rp.state.analysis && window.__rp.state.analysis.status === 'done', null, { timeout: 30000 });
    await step('luoghi e attrazioni: tempi in pullman, filtri, scheda con Wikipedia, aggiunta come tappa', async () => {
      await q.click('#places-wrap > summary');
      await q.waitForFunction(() => window.__rp.state.places && window.__rp.state.places.status === 'done', null, { timeout: 30000 });
      assert.ok(mocks.matrixCalls >= 1, 'tempi di andata chiesti a Valhalla');
      const txt = await q.textContent('#places');
      assert.match(txt, /Area archeologica di Prova.*UNESCO/s);
      assert.match(txt, /Castello di Prova.*\d+ min di andata in pullman.*Raggiungibile in pullman/s);
      assert.match(txt, /Museo nel centro storico.*Non raggiungibile in pullman/s);
      assert.doesNotMatch(txt, /Museo lontano|Museo minore/);
      assert.equal(await q.locator('.pl-marker').count(), 3);
      await q.selectOption('#pl-minutes', '10');
      const t10 = await q.textContent('#places');
      assert.doesNotMatch(t10, /Area archeologica di Prova/);
      assert.match(t10, /Castello di Prova/);
      await q.selectOption('#pl-minutes', '20');
      await q.click('.pl-chip:has-text("Castelli")');
      assert.doesNotMatch(await q.textContent('#places ul'), /Castello di Prova/);
      await q.click('.pl-chip:has-text("Castelli")');
      await q.locator('#places .hz.pl', { hasText: 'Castello di Prova' }).locator('button', { hasText: 'Mostra sulla mappa' }).click();
      await q.waitForSelector('.hz-popup .pl-wiki img', { timeout: 8000 });
      const card = await q.textContent('.hz-popup .hzpop');
      assert.match(card, /Il Castello di Prova è un luogo di prova/);
      assert.match(card, /Orari secondo OpenStreetMap \(da verificare\): Sa-Su 10:00-18:00/);
      assert.match(card, /Parcheggi vicini|Nessun parcheggio per bus/);
      await q.waitForTimeout(600);
      await q.screenshot({ path: path.join(OUT, '20-luoghi.png') });
      const before = await q.evaluate(() => window.__rp.state.stops.length);
      await q.locator('.hz-popup button', { hasText: 'Aggiungi come tappa' }).click();
      await q.waitForFunction((n) => window.__rp.state.stops.length === n + 1 && window.__rp.state.route && window.__rp.state.route.stops.length === n + 1, before, { timeout: 30000 });
      const stops = await q.evaluate(() => window.__rp.state.stops.map((s) => [s.label, s.dwell]));
      assert.deepEqual(stops[1], ['Castello di Prova', 60]);
    });
    Object.assign(mocks, { dati: false, places: false, unreachablePlace: null });
    await lctx.close();
  }

  /* --- ZTL e zone a traffico limitato --- */
  {
    const zctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
    await setupRoutes(zctx);
    Object.assign(mocks, { dati: true, ztl: true, senzaLimiti: true, lastCoords: null, fixedCoords: null, honorExclude: false });
    const q = await zctx.newPage();
    watch(q, 'ztl');
    await q.goto(base);
    const ztlDone = () => window.__rp.state.ztl && window.__rp.state.ztl.status === 'done' && window.__rp.state.ztl.route === window.__rp.state.route;
    await q.waitForFunction(ztlDone, null, { timeout: 30000 });
    await q.waitForFunction(() => window.__rp.state.analysis && window.__rp.state.analysis.status === 'done', null, { timeout: 30000 });
    await step('ZTL: zona attraversata e arrivo dentro la ZTL, con orari, fermata al confine e alternativa', async () => {
      const txt = await q.textContent('#ztl');
      assert.match(txt, /ZTL di Prova.*Sempre attiva.*Il percorso la attraversa per [\d,.]+ km · km \d+.*Regola: solo con permesso\..*Cosa fare: Senza permesso il pullman non può attraversarla/s);
      assert.match(txt, /ZTL Centro.*Attiva al tuo passaggio.*Arrivo «.*» dentro la zona.*Regola: solo con permesso 00:00–24:00/s);
      assert.match(await q.textContent('#ztl-count'), /^2$/);
      assert.match(await q.textContent('#sum-chips'), /2 ZTL sul percorso/);
      assert.match(await q.textContent('#check-banner'), /ZTL e zone a traffico limitato: 1 zona attraversata, 1 tappa dentro una zona, 2 attive al tuo passaggio/);
      assert.equal(await q.locator('.zt-marker').count(), 2);
      assert.match(await q.getAttribute('#ztl a:has-text("Sito della zona")', 'href'), /comune\.example/);
      await q.locator('#ztl-sec').scrollIntoViewIfNeeded();
      await q.locator('#ztl .hz.zt', { hasText: 'ZTL Centro' }).locator('button', { hasText: 'Mostra sulla mappa' }).click();
      await q.waitForTimeout(700);
      await q.screenshot({ path: path.join(OUT, '22-ztl.png') });
      // l'arrivo è dentro la ZTL: il pullman si ferma al confine e il gruppo prosegue a piedi
      await q.locator('#ztl .hz.zt', { hasText: 'ZTL Centro' }).locator('button', { hasText: 'Fermati al confine' }).click();
      await q.waitForFunction(() => /al confine della ZTL/.test(document.querySelector('#route-notes').textContent), null, { timeout: 30000 });
      await q.waitForFunction(() => window.__rp.state.ztl.status === 'done' && /ZTL di Prova/.test(document.querySelector('#ztl').textContent) && !/ZTL Centro/.test(document.querySelector('#ztl').textContent), null, { timeout: 30000 });
      assert.match(await q.textContent('#route-notes'), /Arrivo al confine della ZTL: «.*» è dentro «ZTL Centro».*Il pullman arriva al confine della zona.*a piedi/s);
      assert.equal(await q.locator('.drop-marker').count(), 1);
      // con il permesso si torna ad arrivare dentro la zona
      await q.click('#route-notes button:has-text("Ho il permesso")');
      await q.waitForFunction(() => window.__rp.state.ztl.status === 'done' && /ZTL Centro/.test(document.querySelector('#ztl').textContent), null, { timeout: 30000 });
      assert.equal(await q.locator('.drop-marker').count(), 0);
      // con un'alternativa disponibile la ZTL attraversata si evita da sola; quella dell'arrivo resta
      mocks.honorExclude = true;
      mocks.fixedCoords = null;
      await q.click('#tab-viaggio');
      await q.click('#btn-route');
      await q.waitForFunction(() => /Percorso alternativo/.test(document.querySelector('#route-notes').textContent), null, { timeout: 40000 });
      assert.match(await q.textContent('#route-notes'), /ZTL attiva al passaggio · ZTL di Prova/);
      await q.waitForFunction(() => window.__rp.state.ztl.status === 'done' && window.__rp.state.ztl.route === window.__rp.state.route && !/ZTL di Prova/.test(document.querySelector('#ztl').textContent), null, { timeout: 30000 });
      assert.match(await q.textContent('#ztl'), /ZTL Centro/);
    });
    Object.assign(mocks, { dati: false, ztl: false, senzaLimiti: false, honorExclude: false, fixedCoords: null });
    await zctx.close();
  }

  /* --- tema scuro --- */
  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'it-IT', timezoneId: 'Europe/Rome' });
  await setupRoutes(dark);
  const d = await dark.newPage();
  watch(d, 'scuro');
  await d.goto(base);
  await step('tema scuro', async () => {
    await d.waitForSelector('#check-banner.red', { timeout: 15000 });
    await d.waitForTimeout(400);
    await d.screenshot({ path: path.join(OUT, '6-telefono-scuro.png') });
    const bg = await d.evaluate(() => getComputedStyle(document.querySelector('#panel')).backgroundColor);
    assert.equal(bg, 'rgb(22, 29, 38)');
  });

  /* --- desktop e link condiviso --- */
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
  await setupRoutes(desk);
  const w = await desk.newPage();
  watch(w, 'desktop');
  await w.goto(base);
  await step('desktop', async () => {
    await w.waitForSelector('#check-banner.red', { timeout: 15000 });
    await w.waitForTimeout(500);
    await w.screenshot({ path: path.join(OUT, '7-desktop.png') });
    const overflow = await w.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
  });
  await step('link condiviso riapre lo stesso viaggio', async () => {
    await w.click('#tab-mezzo');
    await w.selectOption('#in-preset', 'p:gt15');
    const url = await w.evaluate(() => location.href.split('#')[0] + '#v=' + RPCore.encodeShare(window.__rp.state));
    const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await setupRoutes(other);
    const o = await other.newPage();
    watch(o, 'condiviso');
    await o.goto(url);
    await o.waitForSelector('#res:not([hidden])', { timeout: 15000 });
    assert.match(await o.textContent('#vs-name'), /15 m/);
    assert.equal(await o.evaluate(() => location.hash), '');
    await other.close();
  });

  /* --- versione in un solo file, aperta con doppio clic --- */
  const single = path.join(ROOT, 'dist', 'rotta-pullman.html');
  if (fs.existsSync(single)) {
    const fctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await setupRoutes(fctx);
    const f = await fctx.newPage();
    watch(f, 'file unico');
    await f.goto('file://' + single);
    await step('versione in un solo file aperta dal disco', async () => {
      await f.waitForSelector('#check-banner.red', { timeout: 15000 });
      assert.equal(await f.locator('#hazards .hz').count(), 3);
    });
    await fctx.close();
  }

  await browser.close();
  srv.close();
  if (errors.length) { console.error('Errori nella console:\n' + errors.join('\n')); process.exit(1); }
  console.log(`\n${results.length} scenari superati. Screenshot in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
