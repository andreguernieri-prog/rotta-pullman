// Test della preparazione dei riquadri e della loro lettura nell'app. Esegui con: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const D = require('../tools/build-data.js');

const line = (type, id, coords, tags) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords.map(([la, lo]) => [lo, la]) }, properties: Object.assign({ '@type': type, '@id': id }, tags) });
const point = (id, la, lo, tags) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] }, properties: Object.assign({ '@type': 'node', '@id': id }, tags) });
const poly = (id, ring, tags) => ({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[ring.map(([la, lo]) => [lo, la])]] }, properties: Object.assign({ '@type': 'way', '@id': id }, tags) });

function build(features) {
  const b = D.createBuilder();
  features.forEach((f) => b.add(f));
  return b.finish({ generato: '2026-10-26T04:00:00Z', copertura: [[[44, 8], [47, 8], [47, 12], [44, 12], [44, 8]]] });
}

test('dati: solo i limiti che riguardano un bus', () => {
  const t = (tags) => D.relevantRestriction(tags);
  assert.equal(t({ maxheight: '3.8' }), true);
  assert.equal(t({ maxheight: '4.5' }), true);
  assert.equal(t({ maxheight: '5' }), false);
  assert.equal(t({ maxheight: 'below_default' }), true);
  assert.equal(t({ maxweight: '7.5' }), true);
  assert.equal(t({ maxweight: '44' }), false);
  assert.equal(t({ maxwidth: '2.3' }), true);
  assert.equal(t({ maxlength: '12' }), true);
  assert.equal(t({ hgv: 'no' }), true);
  assert.equal(t({ hgv: 'destination' }), false);
  assert.equal(D.isBusParking({ amenity: 'parking', bus: 'designated' }), true);
  assert.equal(D.isBusParking({ amenity: 'parking', parking: 'bus_bay' }), true);
  assert.equal(D.isBusParking({ amenity: 'parking' }), false);
});

test('dati: riquadri compatti, doppioni eliminati, elementi non stradali scartati', () => {
  const { index, tiles } = build([
    line('way', 1, [[45.48, 9.2], [45.481, 9.2], [45.482, 9.2]], { highway: 'primary', maxheight: '3.5', name: 'Sottopasso' }),
    line('way', 2, [[45.48, 9.21], [45.49, 9.21]], { building: 'yes', maxheight: '2' }),
    point(3, 45.4815, 9.2, { barrier: 'height_restrictor', maxheight: '3.2' }),
    point(4, 45.47, 9.19, { amenity: 'cafe', maxheight: '2.1' }),
    line('way', 5, [[45.5, 9.3], [45.501, 9.3], [45.5, 9.3]], { highway: 'services', name: 'Area Test' }),
    poly(5, [[45.5, 9.3], [45.501, 9.3], [45.501, 9.301], [45.5, 9.3]], { highway: 'services', name: 'Area Test' }),
    point(6, 45.465, 9.19, { amenity: 'parking', coach: 'yes', name: 'Piazzale pullman' }),
    point(7, 45.466, 9.19, { amenity: 'parking' }),
    line('way', 8, [[45.249, 9.0], [45.251, 9.0]], { highway: 'secondary', maxweight: '3.5' }), // a cavallo di due riquadri
  ]);
  assert.equal(index.conteggi.limiti, 3);
  assert.equal(index.conteggi.aree, 1);
  assert.equal(index.conteggi.parcheggi, 1);
  const k = C.tileKey(45.48, 9.2, D.RIQUADRO);
  const els = C.tileToElements(tiles.get(k));
  const way = els.find((e) => e.type === 'way' && e.id === 1);
  assert.equal(way.tags.maxheight, '3.5');
  assert.equal(way.geometry.length, 2); // punti allineati semplificati
  assert.ok(Math.abs(way.geometry[1].lat - 45.482) < 2e-5);
  const node = els.find((e) => e.type === 'node' && e.id === 3);
  assert.equal(node.lat, 45.4815);
  assert.ok(els.some((e) => e.tags.amenity === 'parking' && e.center && e.tags.name === 'Piazzale pullman'));
  assert.ok(!els.some((e) => e.id === 2 || e.id === 4 || e.id === 7));
  const svc = C.tileToElements(tiles.get(C.tileKey(45.5, 9.3, D.RIQUADRO))).filter((e) => e.tags.highway === 'services');
  assert.equal(svc.length, 1);
  const k1 = C.tileKey(45.249, 9.0, D.RIQUADRO), k2 = C.tileKey(45.251, 9.0, D.RIQUADRO);
  assert.notEqual(k1, k2);
  assert.ok(tiles.get(k1).r.some((r) => r[0] === 'w8') && tiles.get(k2).r.some((r) => r[0] === 'w8'));
  assert.equal(index.riquadri[k], tiles.get(k).r.length + tiles.get(k).s.length + tiles.get(k).p.length);
});

test('dati: stesso risultato del controllo con i riquadri e con Overpass', () => {
  const route = [];
  for (let i = 0; i < 60; i++) route.push([45.47 + i * 0.0005, 9.2]);
  const idx = new C.RouteIndex(route);
  const veh = C.sanitizeVehicle(C.PRESETS.find((p) => p.id === 'gt13'));
  const overpassLike = [
    { type: 'way', id: 1, tags: { highway: 'primary', maxheight: '3.5', name: 'Sottopasso' }, geometry: [{ lat: 45.48, lon: 9.2 }, { lat: 45.481, lon: 9.2 }, { lat: 45.482, lon: 9.2 }] },
    { type: 'way', id: 9, tags: { highway: 'tertiary', hgv: 'no' }, geometry: [{ lat: 45.49, lon: 9.2 }, { lat: 45.491, lon: 9.2 }] },
  ];
  const { tiles } = build([
    line('way', 1, [[45.48, 9.2], [45.481, 9.2], [45.482, 9.2]], { highway: 'primary', maxheight: '3.5', name: 'Sottopasso' }),
    line('way', 9, [[45.49, 9.2], [45.491, 9.2]], { highway: 'tertiary', hgv: 'no' }),
  ]);
  const local = Array.from(tiles.values()).flatMap(C.tileToElements);
  const a = C.analyzeElements(overpassLike, idx, veh);
  const b = C.analyzeElements(local, idx, veh);
  assert.deepEqual(b.hazards.map((h) => h.title), a.hazards.map((h) => h.title));
  assert.equal(b.checked, a.checked);
});

test('dati: copertura e riquadri attraversati dal percorso', () => {
  const rings = [[[44, 8], [47, 8], [47, 12], [44, 12], [44, 8]]];
  assert.equal(C.pointInRings(45.5, 9.2, rings), true);
  assert.equal(C.pointInRings(46.2, 6.1, rings), false); // Ginevra
  const inside = [[45.4, 9.1], [45.0, 9.7], [44.5, 11.3]];
  assert.equal(C.coordsCovered(inside, rings), true);
  assert.equal(C.coordsCovered([[45.4, 9.1], [46.2, 6.1]], rings), false);
  assert.equal(C.coordsCovered(inside, null), false);
  const keys = C.tilesForCoords([[45.1, 9.1], [45.1, 9.9]], 0.25, 500);
  assert.deepEqual(keys.sort(), ['180_36', '180_37', '180_38', '180_39']);
  assert.deepEqual(C.tilesAround(45.0001, 9.1, 500, 0.25).sort(), ['179_36', '180_36']);
});

test('dati: file .poly di Geofabrik', () => {
  const rings = D.parsePoly('italy\n1\n   6.6 45.0\n   9.5 47.0\n   12.0 46.8\n   9.0 44.0\n   6.6 45.0\nEND\n!2\n   9.1 45.4\n   9.3 45.4\n   9.3 45.5\nEND\nEND\n');
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0][0], [45, 6.6]);
});

test('dati: il filtro veloce non scarta vie vicine al percorso', () => {
  const idx = new C.RouteIndex([[45.0, 9.0], [45.01, 9.0]]);
  assert.equal(idx.nearBox(45.004, 9.0001, 45.005, 9.0002, 40), true);
  assert.equal(idx.nearBox(45.004, 9.05, 45.005, 9.06, 40), false);
});

test('dati: data e versione della modifica nei riquadri', () => {
  const f = line('way', 11, [[45.48, 9.2], [45.481, 9.2]], { highway: 'primary', maxheight: '3.5', 'source:maxheight': 'sign' });
  f.properties['@timestamp'] = 1552377600; // come lo esporta osmium: 2019-03-12T08:00:00Z
  f.properties['@version'] = 4;
  const { tiles } = build([f]);
  const el = C.tileToElements(tiles.get(C.tileKey(45.48, 9.2, D.RIQUADRO)))[0];
  const m = C.osmMeta(el, 'altezza');
  assert.equal(m.date, '2019-03-12');
  assert.equal(m.version, 4);
  assert.equal(m.source, 'sign');
  assert.equal(m.highway, 'primary');
});

test('dati: ponte, galleria e livello restano nei riquadri', () => {
  const { tiles } = build([
    line('way', 12, [[45.48, 9.2], [45.481, 9.2]], { highway: 'primary', maxheight: '3.5', tunnel: 'yes', layer: '-1' }),
    line('way', 13, [[45.482, 9.2], [45.483, 9.2]], { highway: 'secondary', maxweight: '7.5', bridge: 'yes', layer: '1' }),
  ]);
  const els = C.tileToElements(tiles.get(C.tileKey(45.48, 9.2, D.RIQUADRO)));
  const t = els.find((e) => e.id === 12).tags, b = els.find((e) => e.id === 13).tags;
  assert.equal(t.tunnel, 'yes');
  assert.equal(t.layer, '-1');
  assert.equal(b.bridge, 'yes');
  assert.equal(b.layer, '1');
});

test('dati: conversione delle date di osmium', () => {
  assert.equal(D.isoDay(1552377600), '2019-03-12');
  assert.equal(D.isoDay('2019-03-12T08:00:00Z'), '2019-03-12');
  assert.equal(D.isoDay(0), null);
  assert.equal(D.isoDay(undefined), null);
});

test('dati: i divieti a orario restano, non sui sentieri', () => {
  assert.equal(D.relevantRestriction({ highway: 'secondary', 'bus:conditional': 'no @ (Mo-Fr 07:00-19:00)' }), true);
  assert.equal(D.relevantRestriction({ highway: 'track', 'motor_vehicle:conditional': 'no @ (Nov-Apr)' }), false);
  assert.equal(D.relevantRestriction({ highway: 'primary', 'maxweight:conditional': '3.5 @ (07:00-20:00)' }), true);
  assert.equal(D.relevantRestriction({ highway: 'primary', 'maxweight:conditional': '44 @ (07:00-20:00)' }), false);
  const long = 'no @ (Mo-Fr 07:00-09:00,12:00-14:00,16:00-19:00; Sa 08:00-13:00; PH off) ; destination @ (Su 08:00-12:00 AND weight>3.5) ; delivery @ (Mo-Sa 05:00-07:00)';
  const { tiles } = build([line('way', 31, [[45.48, 9.2], [45.481, 9.2]], { highway: 'secondary', 'motor_vehicle:conditional': long, motor_vehicle: 'yes', bus: 'no' })]);
  const el = C.tileToElements(tiles.get(C.tileKey(45.48, 9.2, D.RIQUADRO)))[0];
  assert.equal(el.tags['motor_vehicle:conditional'], long, 'condizioni lunghe non troncate');
  assert.equal(el.tags.motor_vehicle, 'yes');
});

test('dati: parcheggi grandi generici con la superficie, piccoli e coperti scartati', () => {
  const sq = (lat, lon, m) => { const d = m / 2 / 110540, e = m / 2 / (111320 * Math.cos(lat * Math.PI / 180)); return [[lat - d, lon - e], [lat - d, lon + e], [lat + d, lon + e], [lat + d, lon - e], [lat - d, lon - e]]; };
  const { index, tiles } = build([
    poly(41, sq(45.48, 9.2, 60), { amenity: 'parking', name: 'Piazzale', fee: 'no' }),
    poly(42, sq(45.481, 9.2, 20), { amenity: 'parking' }),
    poly(43, sq(45.482, 9.2, 80), { amenity: 'parking', parking: 'multi-storey' }),
    line('way', 44, sq(45.483, 9.2, 70), { amenity: 'parking' }), // via chiusa esportata come linea
    point(45, 45.484, 9.2, { amenity: 'parking', capacity: '150' }),
  ]);
  assert.equal(index.conteggi.generici, 3);
  const els = C.tileToElements(tiles.get(C.tileKey(45.48, 9.2, D.RIQUADRO))).filter((e) => e.tags.amenity === 'parking');
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  assert.ok(Math.abs(Number(byId[41].tags._a) - 3600) <= 100);
  assert.equal(byId[41].tags.fee, 'no');
  assert.ok(Math.abs(Number(byId[44].tags._a) - 4900) <= 100);
  assert.equal(byId[45].tags.capacity, '150');
  assert.ok(!byId[42] && !byId[43]);
  assert.equal(D.areaOf({ type: 'Point', coordinates: [9, 45] }), 0);
});
