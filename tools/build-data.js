#!/usr/bin/env node
/*
 * Rotta Pullman — prepara i riquadri dei dati per il controllo del percorso.
 *
 * Ingresso: l'estrazione OpenStreetMap filtrata ed esportata con osmium (GeoJSON, un elemento
 * per riga), vedi .github/workflows/dati-limiti.yml.
 * Uscita:   <cartella>/index.json        indice: data, copertura, elenco dei riquadri
 *           <cartella>/riquadri/<k>.json un file per riquadro di 0,25° (circa 28 × 20 km)
 *           <cartella>/luoghi/<k>.json   luoghi e attrazioni notevoli, riquadri di 0,5° (circa 55 × 40 km):
 *                                         l: [rif, lat, lon, tipo, nome, { w: wikipedia, d: wikidata, u: UNESCO, o: orari, s: sito }]
 *
 * Ogni riquadro contiene, in forma compatta:
 *   r: limiti utili ai bus  [rif, geometria (polyline 5), tag]
 *   s: aree di servizio     [rif, lat, lon, 1 = servizio / 0 = sosta, nome]
 *   p: parcheggi            [rif, lat, lon, tag]: per bus o mezzi pesanti, e quelli generici grandi
 *                           all'aperto (tag _a = superficie in m²), che possono andare bene per un pullman
 *
 * Uso: node tools/build-data.js <ingresso.geojsonseq> <cartella> [--poly italy.poly] [--osm-date <data>]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const C = require('../js/core.js');

const VERSIONE = 1;
const RIQUADRO = 0.25;
const RIQUADRO_LUOGHI = 0.5;

const RESTR_KEYS = ['maxheight', 'maxheight:physical', 'maxwidth', 'maxwidth:physical', 'maxlength', 'maxweight', 'maxweightrating', 'maxaxleload'];
const ACCESS_KEYS = ['hgv', 'bus', 'tourist_bus', 'coach'];
// divieti e limiti a giorni/orari o con condizioni (es. bus:conditional=no @ (Mo-Fr 07:00-19:00))
const COND_TAGS = C.COND_KEYS.map((k) => k + ':conditional');
const KEEP_R = RESTR_KEYS.concat(ACCESS_KEYS, COND_TAGS, ['motor_vehicle', 'vehicle', 'access', 'psv', 'name', 'ref', 'bridge', 'tunnel', 'layer', 'highway',
  'source', 'source:maxheight', 'source:maxweight', 'source:maxwidth', 'source:maxlength', 'source:hgv',
  'check_date', 'check_date:maxheight', 'check_date:maxweight', 'survey:date']);
const KEEP_P = ['name', 'fee', 'capacity', 'capacity:bus', 'capacity:coach', 'access', 'opening_hours', 'bus', 'coach', 'tourist_bus', 'hgv', 'parking', 'maxheight', 'surface', 'operator'];
const NON_ROAD = ['amenity', 'shop', 'building', 'tourism', 'leisure', 'man_made', 'office', 'craft'];

/* Un valore di limite può riguardare un bus? Il più alto supera di poco i 4 m, il più pesante le 30 t */
function limitRelevant(k, v) {
  if (/^maxheight/.test(k)) { const x = C.parseLength(v); return x === 'below_default' || (typeof x === 'number' && x < 4.6); }
  if (/^maxwidth/.test(k)) { const x = C.parseLength(v); return typeof x === 'number' && x < 3; }
  if (k === 'maxlength') { const x = C.parseLength(v); return typeof x === 'number' && x < 25; }
  if (k === 'maxweight' || k === 'maxweightrating') { const x = C.parseWeight(v); return x != null && x < 40.5; }
  if (k === 'maxaxleload') { const x = C.parseWeight(v); return x != null && x < 13; }
  return false;
}

/* strade dove un bus non passa: i divieti a orario lì non servono */
const NON_BUS = /^(footway|path|cycleway|bridleway|steps|track|pedestrian|corridor|proposed|construction|platform|elevator|via_ferrata)$/;

/* Tiene solo i limiti che un bus può incontrare, compresi quelli a orario o con condizioni */
function relevantRestriction(t) {
  if (RESTR_KEYS.some((k) => t[k] != null && limitRelevant(k, t[k]))) return true;
  if (ACCESS_KEYS.some((k) => t[k] === 'no')) return true;
  if (NON_BUS.test(t.highway || '')) return false;
  for (const k of C.COND_KEYS) {
    const raw = t[k + ':conditional'];
    if (raw == null) continue;
    if (!/^max/.test(k)) return true; // divieti di accesso: si valutano nell'app con il mezzo e l'orario
    const rules = C.parseConditional(raw);
    if (!rules || rules.some((r) => limitRelevant(k, r.value))) return true;
  }
  return false;
}

function isBusParking(t) {
  const k = C.parkingKind(t, 0);
  return k === 'bus' || k === 'pesanti';
}

/* superficie in m² di un poligono GeoJSON (anelli esterni meno i buchi) */
function areaOf(g) {
  if (!g) return 0;
  const ring = (r) => C.ringArea(r.map((c) => [c[1], c[0]]));
  const poly = (rings) => Math.max(0, ring(rings[0] || []) - rings.slice(1).reduce((s, r) => s + ring(r), 0));
  if (g.type === 'Polygon') return poly(g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.reduce((s, p) => s + poly(p), 0);
  // via chiusa esportata come linea
  if (g.type === 'LineString' && g.coordinates.length > 3) {
    const a = g.coordinates[0], b = g.coordinates[g.coordinates.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring(g.coordinates);
  }
  return 0;
}

function pick(t, keys) {
  const o = {};
  for (const k of keys) if (t[k] != null && t[k] !== '') o[k] = String(t[k]).slice(0, /:conditional$/.test(k) ? 300 : 120);
  return o;
}

const r5 = (x) => Math.round(x * 1e5) / 1e5;

/* osmium esporta la data come secondi dal 1970 (0 se manca); si accetta anche il testo ISO */
function isoDay(ts) {
  if (!ts) return null;
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return isFinite(d) ? d.toISOString().slice(0, 10) : null;
}

/* linea principale di una geometria GeoJSON, come [[lat, lon], ...] */
function lineOf(g) {
  if (!g) return null;
  const ll = (c) => [c[1], c[0]];
  switch (g.type) {
    case 'Point': return [ll(g.coordinates)];
    case 'LineString': return g.coordinates.map(ll);
    case 'MultiLineString': return g.coordinates[0] ? g.coordinates[0].map(ll) : null;
    case 'Polygon': return g.coordinates[0] ? g.coordinates[0].map(ll) : null;
    case 'MultiPolygon': return g.coordinates[0] && g.coordinates[0][0] ? g.coordinates[0][0].map(ll) : null;
    default: return null;
  }
}

function centroid(g) {
  const pts = lineOf(g);
  if (!pts || !pts.length) return null;
  let la = 0, lo = 0;
  for (const p of pts) { la += p[0]; lo += p[1]; }
  return [la / pts.length, lo / pts.length];
}

function tilesOfBox(pts) {
  let a0 = Infinity, o0 = Infinity, a1 = -Infinity, o1 = -Infinity;
  for (const p of pts) { a0 = Math.min(a0, p[0]); a1 = Math.max(a1, p[0]); o0 = Math.min(o0, p[1]); o1 = Math.max(o1, p[1]); }
  const out = [];
  for (let y = Math.floor(a0 / RIQUADRO); y <= Math.floor(a1 / RIQUADRO); y++) {
    for (let x = Math.floor(o0 / RIQUADRO); x <= Math.floor(o1 / RIQUADRO); x++) out.push(y + '_' + x);
  }
  return out;
}

/* Raccoglie gli elementi e li divide in riquadri */
function createBuilder() {
  const tiles = new Map();
  const places = new Map();
  const seen = new Set();
  const stats = { limiti: 0, aree: 0, parcheggi: 0, generici: 0, luoghi: 0, scartati: 0 };
  const get = (k) => {
    let t = tiles.get(k);
    if (!t) { t = { r: [], s: [], p: [] }; tiles.set(k, t); }
    return t;
  };

  function add(feature) {
    const pr = feature && feature.properties;
    if (!pr || !feature.geometry) return;
    const type = pr['@type'], id = pr['@id'];
    if (!type || id == null) return;
    const t = {};
    for (const k of Object.keys(pr)) if (k[0] !== '@') t[k] = pr[k];
    const ref = (type === 'node' ? 'n' : type === 'way' ? 'w' : 'r') + id;

    // luoghi e attrazioni notevoli
    const pk = C.placeKind(t);
    if (pk) {
      if (!seen.has('l' + ref)) {
        seen.add('l' + ref);
        const c = centroid(feature.geometry);
        if (c) {
          const x = {};
          if (t.wikipedia) x.w = String(t.wikipedia).slice(0, 120);
          if (t.wikidata) x.d = String(t.wikidata).slice(0, 20);
          if (t.heritage === '1' || /whc|unesco/i.test(t['heritage:operator'] || '')) x.u = 1;
          if (t.opening_hours) x.o = String(t.opening_hours).slice(0, 120);
          if (t.website) x.s = String(t.website).slice(0, 200);
          const k = C.tileKey(c[0], c[1], RIQUADRO_LUOGHI);
          if (!places.has(k)) places.set(k, []);
          places.get(k).push([ref, r5(c[0]), r5(c[1]), pk, String(t.name).slice(0, 100), x]);
          stats.luoghi++;
        }
      }
      if (!t.highway && !t.amenity) return;
    }
    if (t.highway === 'services' || t.highway === 'rest_area') {
      if (seen.has('s' + ref)) return;
      seen.add('s' + ref);
      const c = centroid(feature.geometry);
      if (!c) return;
      get(C.tileKey(c[0], c[1], RIQUADRO)).s.push([ref, r5(c[0]), r5(c[1]), t.highway === 'services' ? 1 : 0, String(t.name || '').slice(0, 80)]);
      stats.aree++;
      return;
    }
    if (t.amenity === 'parking') {
      const area = areaOf(feature.geometry);
      const kind = C.parkingKind(t, area);
      if (!kind) { stats.scartati++; return; }
      if (seen.has('p' + ref)) return;
      seen.add('p' + ref);
      const c = centroid(feature.geometry);
      if (!c) return;
      const tags = pick(t, KEEP_P);
      if (area >= 100) tags._a = String(Math.round(area / 100) * 100);
      get(C.tileKey(c[0], c[1], RIQUADRO)).p.push([ref, r5(c[0]), r5(c[1]), tags]);
      if (kind === 'generico') stats.generici++; else stats.parcheggi++;
      return;
    }
    if (type === 'relation') return;
    if (type === 'way' && !t.highway) { stats.scartati++; return; }
    if (type === 'node' && NON_ROAD.some((k) => t[k] != null)) { stats.scartati++; return; }
    if (!relevantRestriction(t)) { stats.scartati++; return; }
    if (seen.has('r' + ref)) return;
    seen.add('r' + ref);
    let pts = lineOf(feature.geometry);
    if (!pts || !pts.length) return;
    if (pts.length > 2) pts = C.simplify(pts, 2);
    const tags = pick(t, KEEP_R);
    // data dell'ultima modifica e versione (da osmium export -a timestamp,version)
    const d = isoDay(pr['@timestamp']);
    if (d) tags._d = d;
    if (pr['@version']) tags._v = String(pr['@version']);
    const rec = [ref, C.encodePolyline(pts, 5), tags];
    for (const k of tilesOfBox(pts)) get(k).r.push(rec);
    stats.limiti++;
  }

  function finish(meta) {
    const index = {
      versione: VERSIONE,
      generato: meta.generato,
      datiOsm: meta.datiOsm || null,
      fonte: meta.fonte || 'OpenStreetMap',
      riquadro: RIQUADRO,
      riquadroLuoghi: RIQUADRO_LUOGHI,
      copertura: meta.copertura || null,
      conteggi: stats,
      riquadri: {},
      luoghi: {},
    };
    const keys = Array.from(tiles.keys()).sort();
    for (const k of keys) {
      const t = tiles.get(k);
      index.riquadri[k] = t.r.length + t.s.length + t.p.length;
    }
    for (const k of Array.from(places.keys()).sort()) index.luoghi[k] = places.get(k).length;
    return { index, tiles, places };
  }

  return { add, finish, stats };
}

/* File .poly di Geofabrik -> anelli esterni [[lat, lon], ...], semplificati */
function parsePoly(text, tolM) {
  const rings = [];
  let cur = null, hole = false;
  const lines = String(text).split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l === 'END') {
      if (!cur) break;
      if (!hole && cur.length > 2) rings.push(cur);
      cur = null;
      continue;
    }
    if (!cur) { hole = l.startsWith('!'); cur = []; continue; }
    const [lon, lat] = l.split(/\s+/).map(Number);
    if (isFinite(lat) && isFinite(lon)) cur.push([lat, lon]);
  }
  return rings.map((ring) => C.simplify(ring, tolM || 300).map((p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]));
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const polyPath = opt('--poly');
  const osmDate = opt('--osm-date');
  const [input, outDir] = args;
  if (!input || !outDir) {
    console.error('Uso: node tools/build-data.js <ingresso.geojsonseq> <cartella> [--poly italy.poly] [--osm-date <data>]');
    process.exit(2);
  }
  const b = createBuilder();
  const rl = readline.createInterface({ input: fs.createReadStream(input, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (let line of rl) {
    line = line.replace(/^\u001e/, '').trim();
    if (!line) continue;
    n++;
    try { b.add(JSON.parse(line)); } catch (e) { /* riga non valida: si salta */ }
  }
  const copertura = polyPath ? parsePoly(fs.readFileSync(polyPath, 'utf8'), 300) : null;
  const { index, tiles, places } = b.finish({ generato: new Date().toISOString(), datiOsm: osmDate, fonte: 'OpenStreetMap, estrazione Geofabrik Italia', copertura });

  fs.mkdirSync(path.join(outDir, 'riquadri'), { recursive: true });
  let bytes = 0, max = 0, maxKey = '';
  for (const [k, t] of tiles) {
    const body = JSON.stringify(Object.assign({ v: VERSIONE, k }, t));
    fs.writeFileSync(path.join(outDir, 'riquadri', k + '.json'), body);
    bytes += body.length;
    if (body.length > max) { max = body.length; maxKey = k; }
  }
  fs.mkdirSync(path.join(outDir, 'luoghi'), { recursive: true });
  let pbytes = 0;
  for (const [k, l] of places) {
    const body = JSON.stringify({ v: VERSIONE, k, l });
    fs.writeFileSync(path.join(outDir, 'luoghi', k + '.json'), body);
    pbytes += body.length;
  }
  console.log(`Luoghi: ${b.stats.luoghi} in ${places.size} riquadri · ${(pbytes / 1048576).toFixed(1)} MB`);
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
  console.log(`Elementi letti: ${n}`);
  console.log(`Limiti: ${b.stats.limiti} · aree di servizio: ${b.stats.aree} · parcheggi bus: ${b.stats.parcheggi} · parcheggi grandi generici: ${b.stats.generici} · scartati: ${b.stats.scartati}`);
  console.log(`Riquadri: ${tiles.size} · totale ${(bytes / 1048576).toFixed(1)} MB (non compressi) · il più grande ${maxKey} ${(max / 1024).toFixed(0)} KB`);
  console.log(`Copertura: ${copertura ? copertura.length + ' anelli, ' + copertura.reduce((s, r) => s + r.length, 0) + ' punti' : 'nessuna'}`);
}

if (require.main === module) {
  main(process.argv).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { createBuilder, parsePoly, relevantRestriction, isBusParking, areaOf, isoDay, RIQUADRO, RIQUADRO_LUOGHI, VERSIONE };
