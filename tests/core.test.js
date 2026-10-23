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
