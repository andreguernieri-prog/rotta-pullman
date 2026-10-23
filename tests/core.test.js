// Test della logica pura. Esegui con: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const veh = C.sanitizeVehicle(C.PRESETS.find((p) => p.id === 'gt13'));

// percorso rettilineo verso nord, un vertice ogni ~111 m
function straightRoute(lat0 = 45, lon = 9, n = 100, step = 0.001) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([lat0 + i * step, lon]);
  return out;
}

test('polyline: codifica e decodifica a 6 decimali', () => {
  const pts = [[45.4642, 9.19], [45.465123, 9.191234], [43.7629, 11.265]];
  const back = C.decodePolyline(C.encodePolyline(pts, 6), 6);
  pts.forEach((p, i) => { near(back[i][0], p[0]); near(back[i][1], p[1]); });
});

test('valori di altezza e lunghezza dai cartelli OSM', () => {
  assert.equal(C.parseLength('3.5'), 3.5);
  assert.equal(C.parseLength('3,5 m'), 3.5);
  assert.equal(C.parseLength('350 cm'), 3.5);
  near(C.parseLength(`11'6"`), 3.5052, 1e-4);
  assert.equal(C.parseLength('4.0;3.8'), 3.8);
  assert.equal(C.parseLength('none'), null);
  assert.equal(C.parseLength('default'), null);
  assert.equal(C.parseLength('below_default'), 'below_default');
  assert.equal(C.parseLength('qualcosa'), null);
});

test('valori di massa', () => {
  assert.equal(C.parseWeight('7.5'), 7.5);
  assert.equal(C.parseWeight('7,5 t'), 7.5);
  assert.equal(C.parseWeight('3500 kg'), 3.5);
  near(C.parseWeight('20 st'), 18.1437, 1e-3);
});

test('confronto dei limiti con il mezzo (13 m, h 3,75)', () => {
  const red = C.evaluateTags({ maxheight: '3.5' }, veh);
  assert.equal(red.length, 1);
  assert.equal(red[0].severity, 'red');
  assert.equal(red[0].kind, 'altezza');
  assert.equal(C.evaluateTags({ maxheight: '3.9' }, veh)[0].severity, 'amber');
  assert.equal(C.evaluateTags({ maxheight: '4.5' }, veh).length, 0);
  assert.equal(C.evaluateTags({ maxlength: '12' }, veh)[0].severity, 'red');
  assert.equal(C.evaluateTags({ maxweight: '7.5' }, veh)[0].kind, 'peso');
  assert.equal(C.evaluateTags({ maxweight: '44' }, veh).length, 0);
  assert.equal(C.evaluateTags({ tourist_bus: 'no' }, veh)[0].kind, 'bus');
  assert.equal(C.evaluateTags({ hgv: 'no' }, veh)[0].severity, 'amber');
  assert.equal(C.evaluateTags({ hgv: 'no', bus: 'yes' }, veh).length, 0);
  assert.equal(C.evaluateTags({ bus: 'no', tourist_bus: 'yes' }, veh).length, 0);
});

test('indice del percorso: distanza, posizione e lato', () => {
  const idx = new C.RouteIndex(straightRoute());
  const r = idx.nearest(45.05, 9.001, 200); // ~79 m a est, si viaggia verso nord
  assert.ok(r);
  near(r.dist, 78.7, 1.5);
  assert.equal(r.side, 'right');
  near(r.along, 0.05 * 110574, 600);
  assert.equal(idx.nearest(45.05, 9.01, 200), null);
  assert.equal(idx.nearest(45.05, 8.999, 200).side, 'left');
});

test('vie lungo il percorso, che lo attraversano o parallele', () => {
  const idx = new C.RouteIndex(straightRoute());
  const along = [{ lat: 45.02, lon: 9 }, { lat: 45.03, lon: 9 }];
  const cross = [{ lat: 45.05, lon: 8.9995 }, { lat: 45.05, lon: 9.0005 }];
  const parallel = [{ lat: 45.02, lon: 9.00026 }, { lat: 45.03, lon: 9.00026 }]; // ~20 m a lato
  assert.equal(C.wayRelation(along, idx).onRoute, true);
  const c = C.wayRelation(cross, idx);
  assert.equal(c.onRoute, false);
  assert.equal(c.crosses, true);
  const p = C.wayRelation(parallel, idx);
  assert.equal(p.onRoute, false);
  assert.equal(p.crosses, false);
});

test('analisi Overpass: punti critici e aree di servizio', () => {
  const idx = new C.RouteIndex(straightRoute());
  const els = [
    { type: 'way', id: 1, tags: { maxheight: '3.4', name: 'Sottopasso' }, geometry: [{ lat: 45.02, lon: 9 }, { lat: 45.021, lon: 9 }] },
    { type: 'way', id: 2, tags: { maxheight: '3.4' }, geometry: [{ lat: 45.021, lon: 9 }, { lat: 45.022, lon: 9 }] },
    { type: 'way', id: 3, tags: { maxweight: '3.5' }, geometry: [{ lat: 45.06, lon: 8.9995 }, { lat: 45.06, lon: 9.0005 }] },
    { type: 'way', id: 4, tags: { maxheight: '3.6', bridge: 'yes' }, geometry: [{ lat: 45.07, lon: 8.9995 }, { lat: 45.07, lon: 9.0005 }] },
    { type: 'node', id: 5, lat: 45.08, lon: 9, tags: { maxwidth: '2.2', barrier: 'height_restrictor' } },
    { type: 'way', id: 6, tags: { maxspeed: '50', maxheight: '5' }, geometry: [{ lat: 45.03, lon: 9 }, { lat: 45.031, lon: 9 }] },
    { type: 'way', id: 7, center: { lat: 45.04, lon: 9.002 }, tags: { highway: 'services', name: 'Area Est' } },
    { type: 'way', id: 8, center: { lat: 45.045, lon: 8.998 }, tags: { highway: 'services', name: 'Area Ovest' } },
  ];
  const a = C.analyzeElements(els, idx, veh);
  assert.equal(a.checked, 4); // vie 1, 2, 6 e nodo 5
  const titles = a.hazards.map((h) => `${h.severity}:${h.title}`);
  assert.deepEqual(titles, ['red:Altezza massima 3,4 m', 'red:Larghezza massima 2,2 m', 'amber:Altezza massima 3,6 m']);
  assert.deepEqual(a.hazards[0].ids, ['way/1', 'way/2']);
  assert.equal(a.hazards[2].crossing, true);
  assert.deepEqual(a.services.map((s) => s.name), ['Area Est']);
});

test('percorso diviso in tratti per il controllo', () => {
  const coords = straightRoute(45, 9, 1000, 0.001); // ~110 km
  const idx = new C.RouteIndex(coords);
  const segs = C.splitByDistance(coords, idx.cumD, 25000);
  assert.equal(segs.length, 5);
  assert.equal(segs[0].from, 0);
  assert.equal(segs[segs.length - 1].to, coords.length - 1);
  for (let i = 1; i < segs.length; i++) assert.equal(segs[i].from, segs[i - 1].to);
  assert.equal(C.splitByDistance([[45, 9], [45.001, 9]], Float64Array.from([0, 111]), 25000).length, 1);
});

test('tempi di guida distribuiti sui segmenti', () => {
  const cumD = Float64Array.from([0, 100, 300, 600]);
  const cumT = C.buildCumTime(cumD, [{ from: 0, to: 2, durS: 30 }, { from: 2, to: 3, durS: 60 }], 90);
  assert.deepEqual(Array.from(cumT), [0, 10, 30, 90]);
});

test('normalizzazione risposta Valhalla con due tratte', () => {
  const leg1 = [[45, 9], [45.01, 9], [45.02, 9]], leg2 = [[45.02, 9], [45.03, 9]];
  const data = {
    trip: {
      summary: { length: 3.3, time: 300, has_toll: true, has_highway: true, has_ferry: false },
      legs: [
        { shape: C.encodePolyline(leg1), maneuvers: [{ type: 1, instruction: 'Parti', time: 200, length: 2.2, begin_shape_index: 0, end_shape_index: 2 }, { type: 5, instruction: 'Arrivo', time: 0, length: 0, begin_shape_index: 2, end_shape_index: 2 }] },
        { shape: C.encodePolyline(leg2), maneuvers: [{ type: 1, instruction: 'Riparti', time: 100, length: 1.1, begin_shape_index: 0, end_shape_index: 1 }, { type: 4, instruction: 'Arrivo', time: 0, length: 0, begin_shape_index: 1, end_shape_index: 1 }] },
      ],
    },
  };
  const r = C.normalizeValhalla(data);
  assert.equal(r.coords.length, 4);
  assert.deepEqual(r.legEnds, [0, 2, 3]);
  assert.equal(r.steps[2].from, 2);
  assert.equal(r.steps[2].to, 3);
  near(r.driveS, 300, 1e-6);
  near(r.legT[1], 200, 1e-6);
  assert.equal(r.flags.pedaggi, true);
});

test('piano soste: 45′ entro 4 h 30 di guida', () => {
  const dep = Date.UTC(2026, 9, 23, 5, 0);
  const p = C.planTrip({ stopsT: [0, 6 * 3600], departureMs: dep, mode: 'legge', services: [] });
  const pauses = p.events.filter((e) => e.type === 'pausa');
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].minutes, 45);
  assert.ok(pauses[0].T <= 4.5 * 3600);
  assert.equal(p.endMs, dep + (6 * 3600 + 45 * 60) * 1000);
});

test('piano soste: sceglie l’area di servizio più avanti prima del limite', () => {
  const dep = 0;
  const services = [{ T: 2 * 3600, name: 'A' }, { T: 4 * 3600, name: 'B' }, { T: 4.6 * 3600, name: 'C' }];
  const p = C.planTrip({ stopsT: [0, 7 * 3600], departureMs: dep, mode: 'legge', services });
  assert.equal(p.events.find((e) => e.type === 'pausa').place.name, 'B');
});

test('piano soste: frazionata 15′ + 30′', () => {
  const p = C.planTrip({ stopsT: [0, 6 * 3600], departureMs: 0, mode: 'frazionata', services: [] });
  const pauses = p.events.filter((e) => e.type === 'pausa').map((e) => e.minutes);
  assert.deepEqual(pauses, [15, 30]);
  assert.equal(p.endMs, (6 * 3600 + 45 * 60) * 1000);
});

test('piano soste: una visita di 60′ vale come pausa', () => {
  const p = C.planTrip({ stopsT: [0, 3 * 3600, 6 * 3600], dwell: [0, 60, 0], departureMs: 0, mode: 'legge', services: [] });
  assert.equal(p.events.filter((e) => e.type === 'pausa').length, 0);
  assert.equal(p.endMs, (6 * 3600 + 60 * 60) * 1000);
});

test('piano soste: nessuna pausa se si arriva entro 4 h 30, anche con aree disponibili', () => {
  const p = C.planTrip({ stopsT: [0, 3.4 * 3600], departureMs: 0, mode: 'legge', services: [{ T: 2 * 3600, name: 'A' }] });
  assert.equal(p.events.filter((e) => e.type === 'pausa').length, 0);
  assert.equal(p.warnings.length, 0);
});

test('piano soste: frazionata salta la sosta se l\'arrivo è vicino', () => {
  const short = C.planTrip({ stopsT: [0, 2.6 * 3600], departureMs: 0, mode: 'frazionata', services: [] });
  assert.equal(short.events.filter((e) => e.type === 'pausa').length, 0);
  const mid = C.planTrip({ stopsT: [0, 3.4 * 3600], departureMs: 0, mode: 'frazionata', services: [] });
  assert.deepEqual(mid.events.filter((e) => e.type === 'pausa').map((e) => e.minutes), [15]);
});

test('piano soste: avviso di impegno oltre 13 h con un autista', () => {
  const p = C.planTrip({ stopsT: [0, 4 * 3600, 8 * 3600], dwell: [0, 360, 0], departureMs: 0, mode: 'legge', services: [] });
  assert.ok(p.warnings.some((w) => /riposo giornaliero/.test(w.text)));
});

test('piano soste: doppio autista senza pause, avviso oltre 9 h per uno solo', () => {
  const d = C.planTrip({ stopsT: [0, 9.5 * 3600], departureMs: 0, mode: 'doppio', services: [] });
  assert.equal(d.events.filter((e) => e.type === 'pausa').length, 0);
  assert.equal(d.warnings.length, 0);
  const s = C.planTrip({ stopsT: [0, 9.5 * 3600], departureMs: 0, mode: 'legge', services: [] });
  assert.equal(s.warnings[0].level, 'amber');
});

test('link condivisibile: andata e ritorno con accenti', () => {
  const st = {
    stops: [{ lat: 45.48596, lon: 9.20444, label: 'Milano, Stazione Centrale' }, { lat: 43.7629, lon: 11.26505, label: 'Firenze, Piazzale Michelangelo — città', dwell: 0 }],
    vehicle: veh, margin: 0.1, breakMode: 'frazionata',
    options: { avoidTolls: false, avoidHighways: false, avoidFerries: true, strictHgv: true, vmax: 100 },
  };
  const back = C.decodeShare(C.encodeShare(st));
  assert.equal(back.stops[1].label, 'Firenze, Piazzale Michelangelo — città');
  assert.equal(back.vehicle.lunghezza, 13.3);
  assert.equal(back.breakMode, 'frazionata');
  assert.equal(back.options.avoidFerries, true);
  assert.equal(C.decodeShare('spazzatura!!'), null);
});

test('formattazione', () => {
  assert.equal(C.fmtDur(3 * 3600 + 25 * 60), '3 h 25');
  assert.equal(C.fmtDur(40 * 60), '40 min');
  assert.equal(C.fmtDist(312400), '312 km');
  assert.equal(C.fmtDist(4200), '4,2 km');
  assert.equal(C.fmtNum(3.75), '3,75');
  assert.equal(C.stopLetter(0), 'A');
  assert.equal(C.stopLetter(26), 'AA');
  assert.deepEqual(C.parseCoords('45.46, 9.19'), [45.46, 9.19]);
  assert.equal(C.parseCoords('Milano'), null);
});

test('GPX con caratteri speciali', () => {
  const g = C.buildGpx({ name: 'Gita <A&B>', coords: [[45, 9], [45.1, 9.1]], waypoints: [{ lat: 45, lon: 9, name: "Sant'Anna" }] });
  assert.match(g, /Gita &lt;A&amp;B&gt;/);
  assert.match(g, /Sant&apos;Anna/);
  assert.equal((g.match(/<trkpt/g) || []).length, 2);
});

test('permessi: riconoscimento del comune', () => {
  global.self = global;
  require('../js/permessi.js');
  const regole = global.RPPermessi.regole;
  assert.equal(C.matchPermit({ nome: 'Firenze', prov: 'FI', paese: 'IT' }, regole).id, 'firenze');
  assert.equal(C.matchPermit({ nome: 'firenze' }, regole).id, 'firenze'); // senza provincia
  assert.equal(C.matchPermit({ nome: 'Firenze', prov: 'PO' }, regole), null); // omonimo in altra provincia
  assert.equal(C.matchPermit({ nome: 'Vietri sul Mare', prov: 'SA' }, regole).id, 'costiera-amalfitana');
  assert.equal(C.matchPermit({ nome: 'Roma', paese: 'FR' }, regole), null);
  assert.equal(C.matchPermit({ nome: 'Cremona', prov: 'CR' }, regole), null);
  assert.equal(C.normName("Sant'Agata de' Goti"), 'sant agata de goti');
  assert.equal(C.normName('Cefalù'), 'cefalu');
});

test('permessi: tappe raggruppate per comune, destinazione per prima', () => {
  const regole = global.RPPermessi.regole;
  const places = [{ nome: 'Milano', prov: 'MI' }, { nome: 'Bologna', prov: 'BO' }, null, { nome: 'Firenze', prov: 'FI' }, { nome: 'Milano', prov: 'MI' }];
  const g = C.groupPermits(places, regole);
  assert.deepEqual(g.map((x) => x.rule && x.rule.id), ['milano', 'bologna', null, 'firenze']);
  assert.deepEqual(g[0].stops, [0, 4]);
  assert.equal(C.groupPermits([{ nome: 'Pisa', prov: 'PI' }, { nome: 'Lucca', prov: 'LU' }], regole)[0].rule.id, 'lucca');
});

test('permessi: archivio completo e coerente', () => {
  const P = global.RPPermessi;
  assert.match(P.verificato, /^\d{4}-\d{2}-\d{2}$/);
  const ids = new Set();
  const seen = new Set();
  for (const r of P.regole) {
    assert.ok(!ids.has(r.id), 'id doppio ' + r.id); ids.add(r.id);
    assert.ok(['permesso', 'limitato', 'verifica'].includes(r.stato), r.id);
    assert.ok(r.titolo && r.sintesi, r.id);
    assert.ok(Array.isArray(r.passi) && r.passi.length >= 1, r.id);
    assert.ok(r.link.length >= 1 && r.link.every((l) => /^https:\/\//.test(l.url) && l.testo), r.id);
    assert.ok(['confermato', 'parziale'].includes(r.affidabilita), r.id);
    for (const c of r.comuni) {
      assert.match(c.prov, /^[A-Z]{2}$/, r.id);
      const k = C.normName(c.nome) + c.prov;
      assert.ok(!seen.has(k), 'comune doppio ' + c.nome); seen.add(k);
    }
  }
});

test('consigli per i punti critici', () => {
  const pes = C.hazardAdvice({ kind: 'pesanti', severity: 'amber' });
  assert.match(pes, /camion/);
  assert.match(pes, /autobus/);
  assert.match(C.hazardAdvice({ kind: 'altezza', severity: 'red', value: 3.5 }), /non passa/);
  assert.match(C.hazardAdvice({ kind: 'altezza', severity: 'amber', value: 3.9 }), /poco margine/);
  assert.match(C.hazardAdvice({ kind: 'altezza', severity: 'amber', value: null }), /senza la misura/);
  assert.match(C.hazardAdvice({ kind: 'altezza', severity: 'amber', value: 3.6, crossing: true }), /ponte/);
  for (const kind of ['larghezza', 'lunghezza', 'peso', 'asse', 'bus', 'altro']) assert.ok(C.hazardAdvice({ kind, severity: 'red' }).length > 20, kind);
});

test('affidabilità del dato: fonte, data, valori insoliti', () => {
  const el = { type: 'way', id: 1, timestamp: '2014-05-02T10:00:00Z', version: 3, tags: { highway: 'primary', maxheight: '2.1', 'source:maxheight': 'sign' } };
  const m = C.osmMeta(el, 'altezza');
  assert.deepEqual(m, { date: '2014-05-02', version: 3, source: 'sign', checked: null, highway: 'primary' });
  assert.equal(C.sourceLabel('sign'), 'cartello stradale');
  assert.equal(C.sourceLabel('Bing;survey'), 'foto aeree, rilievo sul posto');
  assert.equal(C.sourceLabel(null), null);
  const d = C.hazardDoubts({ kind: 'altezza', value: 2.1, meta: m }, Date.parse('2026-10-23'));
  assert.equal(d.length, 2);
  assert.match(d[0], /strada principale/);
  assert.match(d[1], /12 anni/);
  assert.equal(C.hazardDoubts({ kind: 'altezza', value: 3.9, meta: { highway: 'primary', date: '2025-01-01' } }, Date.parse('2026-10-23')).length, 0);
  // i dati scaricati portano la data nei tag (_d, _v)
  assert.equal(C.osmMeta({ tags: { _d: '2021-03-04', _v: '7', hgv: 'no', check_date: '2024-06-01' } }, 'pesanti').checked, '2024-06-01');
});

test('analisi: i punti critici portano i metadati OSM', () => {
  const route = straightRoute();
  const idx = new C.RouteIndex(route);
  const els = [{ type: 'way', id: 5, timestamp: '2020-01-01T00:00:00Z', version: 2, tags: { highway: 'tertiary', maxheight: '3.4' }, geometry: [{ lat: 45.02, lon: 9 }, { lat: 45.021, lon: 9 }] }];
  const a = C.analyzeElements(els, idx, veh);
  assert.equal(a.hazards[0].meta.date, '2020-01-01');
  assert.equal(a.hazards[0].meta.version, 2);
});

test('confronto con TomTom: tratti evitati e conferme', () => {
  const route = C.finishRoute({ coords: straightRoute(45, 9, 200, 0.0005), steps: [], legEnds: [0, 199], durationS: 600, flags: {}, engine: 'x' });
  const car = straightRoute(45, 9, 200, 0.0005);
  // il bus devia di ~800 m tra il 40% e il 60% del percorso
  const bus = car.map((p, i) => (i >= 80 && i <= 120 ? [p[0], p[1] + 0.01] : p));
  const cmp = C.compareRoutes(route, bus, car);
  assert.equal(cmp.avoided.length, 1);
  const r = cmp.avoided[0];
  assert.ok(r.alongStart > 0.38 * route.distanceM && r.alongEnd < 0.62 * route.distanceM, JSON.stringify(r));
  assert.equal(cmp.verdict(0.5 * route.distanceM, 0.5 * route.distanceM), 'evita');
  assert.equal(cmp.verdict(0.1 * route.distanceM, 0.1 * route.distanceM), 'passa');
  assert.ok(cmp.shared > 0.7 && cmp.shared < 0.85);
  // se anche l'auto va altrove, il confronto non dice nulla
  const carAway = car.map((p, i) => (i >= 80 && i <= 120 ? [p[0], p[1] - 0.01] : p));
  const cmp2 = C.compareRoutes(route, bus, carAway);
  assert.equal(cmp2.avoided.length, 0);
  assert.equal(cmp2.verdict(0.5 * route.distanceM, 0.5 * route.distanceM), 'altrove');
  assert.match(C.hazardAdvice({ kind: 'tomtom', severity: 'amber' }), /TomTom/);
});

/* percorso rettilineo da un punto, con direzione (gradi da nord) e passo in metri */
function lineFrom(center, bearingDeg, halfLenM, stepM) {
  const kx = 111320 * Math.cos(center[0] * Math.PI / 180), ky = 110540;
  const b = bearingDeg * Math.PI / 180, out = [];
  for (let d = -halfLenM; d <= halfLenM + 1e-6; d += stepM) out.push([center[0] + (Math.cos(b) * d) / ky, center[1] + (Math.sin(b) * d) / kx]);
  return out;
}

test('caso reale: la strada sotto il Viadotto Opolo (SP510) non è sul percorso', () => {
  // via 736359248, maxheight 3,5 m, passa sotto il viadotto con un angolo di circa 20°
  const geometry = [{ lat: 45.73596, lon: 10.10429 }, { lat: 45.73614, lon: 10.10365 }, { lat: 45.73616, lon: 10.10341 }];
  const viadotto = lineFrom([45.73605, 10.10397], -48, 400, 30);
  const idx = new C.RouteIndex(viadotto);
  const rel = C.wayRelation(geometry, idx);
  assert.equal(rel.onRoute, false);
  const a = C.analyzeElements([{ type: 'way', id: 736359248, tags: { highway: 'unclassified', maxheight: '3.5' }, geometry }], idx, veh);
  // non è "sul percorso", ma resta segnalato come "vicino al percorso" perché lo controlli l'operatore
  assert.equal(a.hazards.length, 1);
  assert.equal(a.hazards[0].rel, 'vicino');
  assert.ok(a.hazards[0].distM < 6);
  assert.equal(a.checked, 0);
  // se avesse lo stesso nome della strada percorsa, sarebbe sul percorso
  const b = C.analyzeElements([{ type: 'way', id: 1, tags: { highway: 'secondary', ref: 'SP 510', maxheight: '3.5' }, geometry }], idx, veh, { streetAt: () => 'SP510, Via Sebina' });
  assert.equal(b.hazards[0].rel, 'certo');
  assert.equal(b.hazards[0].promoted, 'nome');
});

test('caso reale: le barriere di Piazzale Funivia accanto alla SS39 non sono sul percorso', () => {
  const nodo = { type: 'node', id: 5014382273, lat: 46.15684, lon: 10.16537, tags: { maxheight: '2.2' } };
  // la statale passa a circa 4 m dal nodo, senza passarci sopra
  const ss39 = lineFrom([46.15684, 10.16537 + 4 / 77150], 0, 300, 25);
  const a = C.analyzeElements([nodo], new C.RouteIndex(ss39), veh);
  assert.equal(a.hazards.length, 1);
  assert.equal(a.hazards[0].rel, 'vicino');
  assert.ok(Math.abs(a.hazards[0].distM - 4) < 0.5);
  // se invece il nodo è un punto della strada percorsa, il limite vale
  const sulla = lineFrom([46.15684, 10.16537], 0, 300, 25);
  const b = C.analyzeElements([nodo], new C.RouteIndex(sulla), veh);
  assert.equal(b.hazards.length, 1);
  assert.equal(b.hazards[0].severity, 'red');
  assert.equal(b.hazards[0].rel, 'certo');
});

test('i limiti veri sul percorso restano segnalati', () => {
  const route = straightRoute(45, 9, 100, 0.001);
  const idx = new C.RouteIndex(route);
  // via che coincide con un tratto del percorso
  assert.equal(C.wayRelation([{ lat: 45.02, lon: 9 }, { lat: 45.021, lon: 9 }, { lat: 45.022, lon: 9 }], idx).onRoute, true);
  // via semplificata: salta un nodo intermedio (corda), resta sul percorso
  assert.equal(C.wayRelation([{ lat: 45.03, lon: 9 }, { lat: 45.034, lon: 9 }], idx).onRoute, true);
  // via che tocca il percorso in un solo punto (incrocio) e poi se ne va
  assert.equal(C.wayRelation([{ lat: 45.04, lon: 9 }, { lat: 45.04, lon: 9.002 }], idx).onRoute, false);
  // via parallela a 10 m
  assert.equal(C.wayRelation([{ lat: 45.05, lon: 9.00013 }, { lat: 45.06, lon: 9.00013 }], idx).onRoute, false);
});

test('partenza a metà di un tratto limitato: il limite vale', () => {
  // il percorso parte a metà del ponte (via da 44.9995 a 45.001), il primo nodo della via è prima della partenza
  const route = [[45.0005, 9]].concat(straightRoute(45.001, 9, 50, 0.001));
  const idx = new C.RouteIndex(route);
  const rel = C.wayRelation([{ lat: 44.9995, lon: 9 }, { lat: 45.001, lon: 9 }], idx);
  assert.equal(rel.onRoute, true);
  assert.equal(rel.alongStart, 0);
});

test('nome della strada percorsa in un punto', () => {
  const coords = straightRoute(45, 9, 10, 0.001);
  const r = C.finishRoute({ coords, steps: [{ from: 0, to: 5, durS: 50, streets: 'SS39' }, { from: 5, to: 9, durS: 40, streets: 'Via Roma' }], legEnds: [0, 9], durationS: 90, flags: {}, engine: 'x' });
  assert.equal(C.streetAtAlong(r, 100), 'SS39');
  assert.equal(C.streetAtAlong(r, 700), 'Via Roma');
});

test('stessa strada: nome o sigla, con spazi e maiuscole diverse', () => {
  assert.equal(C.sameRoad({ ref: 'SS 39' }, 'SS39'), true);
  assert.equal(C.sameRoad({ name: 'Via dell\'Aprica' }, 'Strada Statale, via dell’Aprica'), true);
  assert.equal(C.sameRoad({ name: 'Via Roma' }, 'Via Milano'), false);
  assert.equal(C.sameRoad({}, 'SS39'), false);
  assert.equal(C.sameRoad({ ref: 'SS39' }, ''), false);
});

test('ordine: prima i punti sul percorso, poi quelli vicini', () => {
  const list = [
    { rel: 'vicino', severity: 'red', alongStart: 10 },
    { rel: 'certo', severity: 'amber', alongStart: 5 },
    { rel: 'certo', severity: 'red', alongStart: 50 },
  ].sort(C.hazardOrder);
  assert.deepEqual(list.map((x) => x.rel + x.severity), ['certored', 'certoamber', 'vicinored']);
});

/* ------------------------- divieti a giorni e orari ------------------------- */
const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm || 0);

test('orari: giorni feriali, fasce, festivi, notte', () => {
  const feriali = C.parseOH('Mo-Fr 07:00-19:00');
  assert.equal(C.ohAt(feriali, at(2026, 10, 26, 8)), true); // lunedì
  assert.equal(C.ohAt(feriali, at(2026, 10, 24, 8)), false); // sabato
  assert.equal(C.ohAt(feriali, at(2026, 10, 26, 19, 0)), false); // alle 19 finisce
  const punte = C.parseOH('Mo-Fr 07:00-09:00,16:00-19:00; PH off');
  assert.equal(C.ohAt(punte, at(2026, 10, 26, 17)), true);
  assert.equal(C.ohAt(punte, at(2026, 10, 26, 12)), false);
  assert.equal(C.ohAt(punte, at(2026, 12, 8, 8)), false); // Immacolata, martedì
  const festivi = C.parseOH('Su,PH 09:00-22:00');
  assert.equal(C.ohAt(festivi, at(2026, 4, 6, 10)), true); // Pasquetta 2026
  assert.equal(C.ohAt(festivi, at(2026, 6, 2, 10)), true); // Festa della Repubblica
  assert.equal(C.ohAt(festivi, at(2026, 6, 3, 10)), false);
  const notte = C.parseOH('Fr 22:00-06:00');
  assert.equal(C.ohAt(notte, at(2026, 10, 24, 3)), true); // sabato notte, continua da venerdì
  assert.equal(C.ohAt(notte, at(2026, 10, 24, 7)), false);
  const altre = C.parseOH('Mo-Fr 07:00-09:00, Sa 08:00-12:00');
  assert.equal(C.ohAt(altre, at(2026, 10, 24, 9)), true);
  assert.equal(C.ohAt(altre, at(2026, 10, 25, 9)), false);
});

test('orari: periodi dell\'anno, alba e tramonto, formati non riconosciuti', () => {
  assert.equal(C.ohAt(C.parseOH('Jun 15-Sep 15'), at(2026, 8, 1, 10)), true);
  assert.equal(C.ohAt(C.parseOH('Jun 15-Sep 15'), at(2026, 9, 20, 10)), false);
  assert.equal(C.ohAt(C.parseOH('Nov-Apr'), at(2026, 1, 10, 10)), true); // a cavallo dell'anno
  assert.equal(C.ohAt(C.parseOH('Nov-Apr'), at(2026, 7, 10, 10)), false);
  assert.equal(C.ohAt(C.parseOH('Dec 24-Jan 6'), at(2027, 1, 2, 10)), true);
  assert.equal(C.ohAt(C.parseOH('2025 Jun-Sep'), at(2026, 7, 1, 10)), false);
  assert.equal(C.ohAt(C.parseOH('sunset-sunrise'), at(2026, 7, 1, 23)), true);
  assert.equal(C.ohAt(C.parseOH('sunset-sunrise'), at(2026, 7, 1, 12)), false);
  assert.equal(C.ohAt(C.parseOH('sunset-sunrise'), at(2026, 7, 1, 20, 30)), '?'); // tramonto stimato: incerto
  assert.equal(C.parseOH('Su[1] 08:00-12:00'), null);
  assert.equal(C.parseOH('easter'), null);
  assert.equal(C.easter(2026).getDate(), 5);
  assert.equal(C.isHolidayIT(at(2026, 4, 25, 12)), true);
  assert.equal(C.isHolidayIT(at(2026, 4, 24, 12)), false);
});

test('condizioni: valore @ (condizione), in italiano', () => {
  const r = C.parseConditional('no @ (Mo-Fr 07:00-19:00 AND weight>7.5); destination @ (Sa)');
  assert.equal(r.length, 2);
  assert.equal(r[0].conds[0].type, 'orario');
  assert.deepEqual([r[0].conds[1].type, r[0].conds[1].prop, r[0].conds[1].n], ['veicolo', 'peso', 7.5]);
  assert.equal(C.parseConditional('no'), null);
  assert.equal(C.condText('Mo-Fr 07:00-19:00; PH off'), 'lun–ven 07:00–19:00; esclusi i festivi');
  assert.equal(C.condText('Jun 15-Sep 15 AND weight>7.5'), 'giu 15–set 15 e massa oltre 7,5 t');
});

test('divieti a orario: quando riguardano il bus e quando no', () => {
  const bus = C.conditionalIssues({ highway: 'secondary', 'bus:conditional': 'no @ (Mo-Fr 07:00-19:00)' }, veh);
  assert.equal(bus.timed.kind, 'orario');
  assert.equal(bus.timed.title, 'Divieto di transito per bus in certi orari');
  assert.equal(bus.timed.when, 'autobus: vietato lun–ven 07:00–19:00');
  // bus ammessi esplicitamente: il divieto per i veicoli a motore non li riguarda
  assert.equal(C.conditionalIssues({ bus: 'yes', 'motor_vehicle:conditional': 'no @ (Su 08:00-13:00)' }, veh).timed, null);
  // limite di massa a orario: 3,5 t riguarda il bus da 19 t
  const peso = C.conditionalIssues({ 'maxweight:conditional': '3.5 @ (07:00-20:00)' }, veh);
  assert.equal(peso.timed.title, 'Massa massima 3,5 t in certi orari');
  assert.equal(peso.timed.sign, 'peso');
  // limite che il mezzo rispetta: niente
  assert.equal(C.conditionalIssues({ 'maxweight:conditional': '44 @ (07:00-20:00)' }, veh).timed, null);
  // condizione solo sul mezzo: è un divieto fisso, con la condizione nel dettaglio
  const lungo = C.conditionalIssues({ 'motor_vehicle:conditional': 'no @ (length>12)' }, veh);
  assert.equal(lungo.timed, null);
  assert.equal(lungo.fixed[0].severity, 'red');
  assert.match(lungo.fixed[0].detail, /lunghezza oltre 12 m/);
  assert.equal(C.conditionalIssues({ 'motor_vehicle:conditional': 'no @ (length>15)' }, veh).fixed.length, 0);
  // eccezione a orario su un divieto fisso
  const ecc = C.conditionalIssues({ bus: 'no', 'bus:conditional': 'yes @ (Mo-Fr 06:00-20:00)' }, veh);
  assert.equal(ecc.fixed.length, 0, 'il divieto fisso va nella scheda a orario');
  assert.equal(ecc.timed.when, 'autobus: consentito lun–ven 06:00–20:00');
});

test('divieti a orario: in vigore, a ridosso, non in vigore, incerto', () => {
  const t = C.conditionalIssues({ 'bus:conditional': 'no @ (Mo-Fr 07:00-19:00)' }, veh).timed;
  const st = (d) => C.conditionalAt(t, veh, d.getTime());
  assert.deepEqual([st(at(2026, 10, 26, 8)).state, st(at(2026, 10, 26, 8)).severity], ['attivo', 'red']);
  assert.deepEqual([st(at(2026, 10, 24, 8)).state, st(at(2026, 10, 24, 8)).severity], ['non attivo', 'info']);
  const prima = st(at(2026, 10, 26, 6, 30));
  assert.deepEqual([prima.state, prima.after], ['ridosso', true]);
  assert.equal(st(at(2026, 10, 26, 19, 30)).state, 'ridosso');
  const ecc = C.conditionalIssues({ bus: 'no', 'bus:conditional': 'yes @ (Mo-Fr 06:00-20:00)' }, veh).timed;
  assert.equal(C.conditionalAt(ecc, veh, at(2026, 10, 25, 10).getTime()).state, 'attivo'); // domenica: vietato
  assert.equal(C.conditionalAt(ecc, veh, at(2026, 10, 26, 10).getTime()).state, 'non attivo');
  const meteo = C.conditionalIssues({ 'access:conditional': 'no @ wet' }, veh).timed;
  assert.equal(C.conditionalAt(meteo, veh, at(2026, 10, 26, 10).getTime()).state, 'incerto');
  const pes = C.conditionalIssues({ 'hgv:conditional': 'no @ (Mo-Fr 07:00-19:00)' }, veh).timed;
  assert.deepEqual([C.conditionalAt(pes, veh, at(2026, 10, 26, 8).getTime()).severity, pes.sign], ['amber', 'pesanti']);
});

test('analisi: divieto a orario sul percorso, raggruppato e con i tag per la valutazione', () => {
  const idx = new C.RouteIndex(straightRoute());
  const cond = { highway: 'primary', name: 'Via Roma', 'bus:conditional': 'no @ (Mo-Fr 07:00-19:00)' };
  const els = [
    { type: 'way', id: 21, tags: cond, geometry: [{ lat: 45.02, lon: 9 }, { lat: 45.021, lon: 9 }] },
    { type: 'way', id: 22, tags: cond, geometry: [{ lat: 45.021, lon: 9 }, { lat: 45.022, lon: 9 }] },
    { type: 'way', id: 23, tags: { highway: 'primary', maxheight: '3.4', 'hgv:conditional': 'no @ (Sa,Su)' }, geometry: [{ lat: 45.05, lon: 9 }, { lat: 45.051, lon: 9 }] },
  ];
  const a = C.analyzeElements(els, idx, veh);
  const timed = a.hazards.filter((h) => h.kind === 'orario');
  assert.equal(timed.length, 2);
  assert.deepEqual(timed[0].ids, ['way/21', 'way/22']);
  assert.equal(timed[0].cond['bus:conditional'], 'no @ (Mo-Fr 07:00-19:00)');
  assert.ok(a.hazards.some((h) => h.kind === 'altezza'), 'il limite fisso di altezza resta');
  assert.equal(C.hasRestrictionTags({ 'motor_vehicle:conditional': 'no @ (Su)' }), true);
});

test('accesso: vale la chiave più specifica', () => {
  assert.deepEqual(C.accessFor({ access: 'no', bus: 'designated' }), { key: 'bus', value: 'designated' });
  assert.equal(C.evaluateTags({ motor_vehicle: 'no' }, veh)[0].title, 'Divieto di transito');
  assert.equal(C.evaluateTags({ access: 'no', bus: 'yes' }, veh).length, 0);
  assert.equal(C.evaluateTags({ bus: 'no', coach: 'yes' }, veh).length, 0);
  assert.equal(C.evaluateTags({ motor_vehicle: 'destination' }, veh).length, 0, 'transito riservato solo nella valutazione a orario');
});

test('ordine: i divieti a orario non in vigore vanno in fondo', () => {
  const list = [
    { rel: 'certo', severity: 'info', alongStart: 1 },
    { rel: 'vicino', severity: 'amber', alongStart: 10 },
    { rel: 'certo', severity: 'red', alongStart: 50 },
  ].sort(C.hazardOrder);
  assert.deepEqual(list.map((x) => x.severity), ['red', 'amber', 'info']);
});

test('condizioni reali italiane: periodi con «:», anni, minuscole, categorie di utenti', () => {
  const estate = C.parseConditional('no @ (Jun 22-Sep 12: Mo-Su 00:00-04:00, 16:00-24:00); permit @ (Jun 22-Sep 12: Mo-Su 10:00-16:00)');
  assert.equal(estate.length, 2);
  assert.equal(C.ohAt(estate[0].conds[0].oh, at(2027, 7, 10, 17)), true);
  assert.equal(C.ohAt(estate[0].conds[0].oh, at(2027, 10, 10, 17)), false);
  // condizione con ";" senza parentesi
  const zona = C.parseConditional('permit @ Jun 01-Oct 03: Mo 00:00-02:00,20:00-24:00; Tu-Sa 20:00-24:00; Su 00:00-02:00,20:00-24:00');
  assert.equal(zona.length, 1);
  assert.equal(C.ohAt(zona[0].conds[0].oh, at(2027, 7, 8, 21)), true); // giovedì sera di luglio
  assert.equal(C.ohAt(C.parseOH('2026 Jan 01-2026 Jun 30'), at(2026, 3, 1, 10)), true);
  assert.equal(C.ohAt(C.parseOH('2026 Jan 01-2026 Jun 30'), at(2027, 3, 1, 10)), false);
  assert.equal(C.ohAt(C.parseOH('nov-apr'), at(2027, 1, 10, 10)), true);
  assert.equal(C.ohAt(C.parseOH('su, ph 08:00-12:30 14:30-19:00'), at(2027, 1, 10, 15)), true); // domenica
  // eccezioni per categorie: i disabili sì, il bus no; con permesso: non si sa
  const t = { motor_vehicle: 'no', 'motor_vehicle:conditional': 'yes @ (disabled; emergency; delivery)' };
  assert.equal(C.effectiveTags(t, veh, () => false).tags.motor_vehicle, 'no');
  const p = C.effectiveTags({ motor_vehicle: 'no', 'motor_vehicle:conditional': 'yes @ (permit)' }, veh, (c) => (c.type === 'orario' ? false : '?'));
  assert.equal(p.unknown, true);
  assert.equal(C.effectiveTags({ 'motor_vehicle:conditional': 'no @ (bus)' }, veh, () => false).tags.motor_vehicle, 'no');
  const z = C.conditionalIssues({ 'motor_vehicle:conditional': 'permit @ (Mo-Sa 11:00-15:30)' }, veh).timed;
  assert.equal(z.title, 'Transito riservato in certi orari');
  assert.equal(z.when, 'veicoli a motore: solo con permesso lun–sab 11:00–15:30');
  assert.equal(C.conditionalIssues({ motor_vehicle: 'no', 'motor_vehicle:conditional': 'yes @ (permit_holder)' }, veh).timed.when, 'veicoli a motore: consentito con permesso');
});

test('categorie certe: divieto fisso con le eccezioni nel dettaglio', () => {
  const r = C.conditionalIssues({ motor_vehicle: 'no', 'motor_vehicle:conditional': 'yes @ (disabled; emergency; delivery)' }, veh);
  assert.equal(r.timed, null);
  assert.equal(r.fixed[0].severity, 'red');
  assert.match(r.fixed[0].detail, /consentito per disabili, soccorso, carico e scarico/);
  assert.equal(C.conditionalIssues({ motor_vehicle: 'no', 'motor_vehicle:conditional': 'yes @ (bus)' }, veh).fixed.length, 0);
});
