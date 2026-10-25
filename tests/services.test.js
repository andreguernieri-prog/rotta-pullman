// Test delle chiamate a Overpass con un fetch simulato. Esegui con: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');

global.self = global;
global.RPCore = require('../js/core.js');
require('../js/services.js');
const S = global.RPServices;

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const OK = JSON.stringify({ elements: [{ type: 'node', id: 1, lat: 45, lon: 9, tags: { amenity: 'parking', bus: 'yes' } }] });
const STATUS_NOW = 'Connected as: 1\nRate limit: 2\nSlot available after: 2026-10-23T10:00:00Z, in 0 seconds.\n';
const pts = [{ lat: 43.77, lon: 11.25 }];

function installFetch(handler) {
  const calls = [];
  let inflight = 0, maxInflight = 0;
  global.fetch = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/status')) return res(200, STATUS_NOW);
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    try {
      await new Promise((r) => setTimeout(r, 30));
      return await handler(u, opts, calls);
    } finally { inflight--; }
  };
  return { calls, max: () => maxInflight };
}

test('overpass: server pieno (429), attesa indicata dal server e nuovo tentativo riuscito', async () => {
  let n = 0;
  const f = installFetch(async () => (++n === 1 ? res(429, 'rate_limited') : res(200, OK)));
  const els = await S.parkings(pts, 1500);
  assert.equal(els.length, 1);
  assert.ok(f.calls.some((c) => c.endsWith('/api/status')), 'deve leggere la pagina di stato');
  const interp = f.calls.filter((c) => c.endsWith('/interpreter'));
  assert.equal(new Set(interp).size, 1, 'riprova lo stesso server');
});

test('overpass: tutti i server occupati, errore chiaro con i dettagli di ogni server', async () => {
  installFetch(async (u) => (u.includes('mail.ru') ? res(502, 'bad gateway') : res(429, 'rate_limited')));
  await assert.rejects(S.parkings(pts, 1500), (e) => {
    assert.equal(e.code, 'busy');
    assert.match(e.message, /occupati/);
    assert.match(e.detail, /overpass-api\.de: occupato \(429\)/);
    assert.match(e.detail, /overpass\.private\.coffee: occupato \(429\)/);
    assert.match(e.detail, /maps\.mail\.ru: errore 502/);
    return true;
  });
});

test('overpass: server irraggiungibile, si passa al successivo e lo si preferisce dopo', async () => {
  const f = installFetch(async (u) => {
    if (u.includes('overpass-api.de')) throw new TypeError('Failed to fetch');
    return res(200, OK);
  });
  await S.parkings(pts, 1500);
  const before = f.calls.length;
  await S.parkings(pts, 1500);
  const next = f.calls.slice(before).filter((c) => c.endsWith('/interpreter'));
  assert.match(next[0], /private\.coffee/);
});

test('overpass: le richieste partono una alla volta', async () => {
  const f = installFetch(async () => res(200, OK));
  await Promise.all([S.parkings(pts, 1500), S.corridor([[45, 9], [45.01, 9.01]]), S.parkings(pts, 800)]);
  assert.equal(f.max(), 1);
});

test('valhalla: data e ora di partenza, e calcolo senza orario se il server non le accetta', async () => {
  const bodies = [];
  const trip = { trip: { legs: [{ shape: '_p~iF~ps|U_ulLnnqC', maneuvers: [], summary: { length: 1, time: 60 } }], summary: { length: 1, time: 60 } } };
  let n = 0;
  installFetch(async (u) => {
    bodies.push(JSON.parse(decodeURIComponent(u.split('json=')[1])));
    return ++n === 1 ? res(400, JSON.stringify({ error_code: 162, error: 'Invalid date_time' })) : res(200, JSON.stringify(trip));
  });
  const veh = global.RPCore.sanitizeVehicle(global.RPCore.PRESETS[1]);
  const stops = [{ lat: 45, lon: 9 }, { lat: 45.1, lon: 9.1 }];
  await S.routeValhalla(stops, veh, 0.1, { vmax: 100, strictHgv: true, departure: '2026-10-26T08:00' });
  assert.deepEqual(bodies[0].date_time, { type: 1, value: '2026-10-26T08:00' });
  assert.equal(bodies[1].date_time, undefined);
});

test('overpass: la ricerca lungo il percorso chiede anche i divieti a orario', () => {
  const q = S.corridorQuery([[45, 9], [45.01, 9]]);
  assert.match(q, /:conditional\$"~"\."/);
  assert.match(q, /motor_vehicle\|vehicle\|access\|hgv/);
});

test('overpass: parcheggi per bus fino a 5 km, generici entro 1 km con il perimetro', async () => {
  let q = '';
  installFetch(async (u, opts) => { q = new URLSearchParams(String(opts.body)).get('data'); return res(200, OK); });
  await S.parkings(pts, { near: 1000, far: 5000 });
  assert.match(q, /nw\(around:5000,[^)]*\)\[amenity=parking\]\[~"\^\(bus\|coach\|tourist_bus\)\$"/);
  assert.match(q, /way\(around:1000,[^)]*\)\[amenity=parking\]\[access!~/);
  assert.match(q, /out body geom;/);
  assert.match(q, /multi-storey/);
});

test('valhalla: strade percorse a tratti di 80 km, con ponti e gallerie; un tratto senza risposta resta scoperto', async () => {
  const coords = [];
  for (let i = 0; i <= 200; i++) coords.push([45 + i * 0.009, 9]); // ~200 km verso nord
  const sent = [];
  let n = 0;
  global.fetch = async (url, opts) => {
    sent.push({ url: String(url), opts });
    const body = JSON.parse(opts.body);
    const shape = global.RPCore.decodePolyline(body.encoded_polyline, 6);
    if (++n === 2) return res(504, 'Gateway Timeout');
    return res(200, JSON.stringify({ shape: body.encoded_polyline, edges: [
      { way_id: 100 + n, bridge: n === 1, tunnel: false, begin_shape_index: 0, end_shape_index: Math.floor(shape.length / 2) },
      { way_id: 200 + n, begin_shape_index: Math.floor(shape.length / 2), end_shape_index: shape.length - 1 },
    ] }));
  };
  const out = await S.traceWays(coords);
  assert.equal(out.chunks, 3);
  assert.equal(out.failed, 1);
  assert.equal(out.runs.length, 4);
  assert.deepEqual(out.runs.map((r) => r.id), [101, 201, 103, 203]);
  assert.equal(out.runs[0].bridge, true);
  assert.ok(sent.every((x) => x.url.endsWith('/trace_attributes') && x.opts.method === 'POST' && !x.opts.headers), 'POST semplice, senza intestazioni');
  assert.deepEqual(JSON.parse(sent[0].opts.body).filters.attributes.slice(0, 2), ['shape', 'edge.way_id']);
});

test('tomtom: segnalazioni di traffico in un riquadro, in italiano, presenti e future', async () => {
  let url = '';
  global.fetch = async (u) => { url = String(u); return res(200, JSON.stringify({ incidents: [{ type: 'Feature', properties: { id: 'x' } }] })); };
  const out = await S.tomtomIncidents([11, 44, 11.5, 44.5], 'CHIAVE');
  assert.equal(out.length, 1);
  const q = new URL(url);
  assert.equal(q.origin + q.pathname, 'https://api.tomtom.com/traffic/services/5/incidentDetails');
  assert.equal(q.searchParams.get('bbox'), '11,44,11.5,44.5');
  assert.equal(q.searchParams.get('language'), 'it-IT');
  assert.equal(q.searchParams.get('timeValidityFilter'), 'present,future');
  assert.match(q.searchParams.get('fields'), /iconCategory.*delay.*roadNumbers/);
  global.fetch = async () => res(403, '{}');
  await assert.rejects(S.tomtomIncidents([11, 44, 11.5, 44.5], 'CHIAVE'), /non è abilitata al servizio Traffic/);
});
