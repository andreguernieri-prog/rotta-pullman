/*
 * Rotta Pullman — chiamate ai servizi esterni (tutti basati su OpenStreetMap).
 *  - Ricerca indirizzi: Photon (komoot), con Nominatim come riserva
 *  - Calcolo percorso: Valhalla (FOSSGIS) profilo "truck" con dimensioni del mezzo,
 *    oppure openrouteservice profilo HGV con vehicle_type "bus" (serve una chiave gratuita)
 *  - Controllo limiti, aree di servizio e parcheggi bus: Overpass API
 */
(function (root) {
  'use strict';
  const C = root.RPCore;

  const URLS = {
    photon: 'https://photon.komoot.io',
    nominatim: 'https://nominatim.openstreetmap.org',
    valhalla: 'https://valhalla1.openstreetmap.de',
    ors: 'https://api.openrouteservice.org',
    overpass: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ],
  };

  class ServiceError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  async function request(url, opts = {}, timeoutMs = 25000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const outer = opts.signal;
    if (outer) {
      if (outer.aborted) ctrl.abort();
      else outer.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    try {
      const res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
      let data = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      return { ok: res.ok, status: res.status, data, text };
    } catch (e) {
      if (outer && outer.aborted) throw new ServiceError('Operazione annullata.', 'aborted');
      if (e.name === 'AbortError') throw new ServiceError('Il servizio non ha risposto in tempo. Riprova.', 'timeout');
      throw new ServiceError('Servizio non raggiungibile. Controlla la connessione a internet.', 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------ Indirizzi ------------------------------ */
  function photonItem(f) {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const street = p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : '';
    const place = p.city || p.town || p.village || p.district || p.county || '';
    const main = p.name || street || place || p.state || 'Punto senza nome';
    const sub = [p.name && street ? street : '', place && place !== main ? place : '', p.county && p.county !== place && p.county !== main ? p.county : '', p.country && p.countrycode !== 'IT' ? p.country : '']
      .filter(Boolean).join(', ');
    const label = main + (place && place !== main ? ', ' + place : '');
    return { main, sub, label, lat, lon };
  }

  async function geocode(q, near, signal) {
    const u = new URL(URLS.photon + '/api/');
    u.searchParams.set('q', q);
    u.searchParams.set('limit', '7');
    if (near) {
      u.searchParams.set('lat', near.lat.toFixed(4));
      u.searchParams.set('lon', near.lng.toFixed(4));
    }
    const r = await request(u.toString(), { signal }, 12000);
    if (!r.ok || !r.data || !Array.isArray(r.data.features)) throw new ServiceError('Ricerca indirizzi non disponibile.', 'geocode');
    return r.data.features.map(photonItem);
  }

  async function geocodeFallback(q, signal) {
    const u = new URL(URLS.nominatim + '/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('limit', '5');
    u.searchParams.set('accept-language', 'it');
    const r = await request(u.toString(), { signal }, 12000);
    if (!r.ok || !Array.isArray(r.data)) throw new ServiceError('Ricerca indirizzi non disponibile.', 'geocode');
    return r.data.map((x) => {
      const parts = String(x.display_name || '').split(', ');
      return { main: parts[0] || x.name, sub: parts.slice(1, 4).join(', '), label: parts.slice(0, 2).join(', '), lat: Number(x.lat), lon: Number(x.lon) };
    });
  }

  async function reverse(lat, lon) {
    const u = new URL(URLS.photon + '/reverse');
    u.searchParams.set('lat', lat.toFixed(6));
    u.searchParams.set('lon', lon.toFixed(6));
    u.searchParams.set('limit', '1');
    const r = await request(u.toString(), {}, 10000);
    const f = r.ok && r.data && r.data.features && r.data.features[0];
    return f ? photonItem(f).label : null;
  }

  /* ------------------------------ Percorso ------------------------------ */
  function valhallaBody(stops, veh, margin, opt) {
    return {
      locations: stops.map((s) => ({ lat: +s.lat.toFixed(6), lon: +s.lon.toFixed(6), type: 'break' })),
      costing: 'truck',
      costing_options: {
        truck: {
          height: +(veh.altezza + margin).toFixed(2),
          width: veh.larghezza,
          length: veh.lunghezza,
          weight: veh.peso,
          axle_load: veh.caricoAsse,
          axle_count: veh.assi,
          hazmat: false,
          top_speed: opt.vmax,
          use_highways: opt.avoidHighways ? 0 : 1,
          use_tolls: opt.avoidTolls ? 0 : 0.5,
          use_ferry: opt.avoidFerries ? 0 : 0.5,
          use_living_streets: 0,
          use_tracks: 0,
          service_penalty: 300,
          exclude_unpaved: true,
          // I divieti per i soli camion spesso non valgono per i bus: in modalità meno prudente
          // quelle strade restano percorribili ma penalizzate.
          hgv_no_access_penalty: opt.strictHgv ? 43200 : 1800,
        },
      },
      units: 'kilometers',
      language: 'it-IT',
      directions_type: 'maneuvers',
    };
  }

  async function routeValhalla(stops, veh, margin, opt, signal) {
    const body = valhallaBody(stops, veh, margin, opt);
    const url = URLS.valhalla + '/route?json=' + encodeURIComponent(JSON.stringify(body));
    const r = await request(url, { signal }, 45000);
    if (!r.ok || !r.data || !r.data.trip) {
      const code = r.data && r.data.error_code;
      if (code === 442 || code === 443) {
        throw new ServiceError('Nessun percorso compatibile con le dimensioni del mezzo. Prova a spostare le tappe su strade principali o, se il mezzo è un bus, disattiva “Evita strade vietate ai mezzi pesanti”.', 'noroute');
      }
      if (code === 171 || code === 170 || code === 172) {
        throw new ServiceError('Una tappa è troppo lontana da una strada percorribile dal mezzo. Spostala più vicino a una strada principale.', 'nopoint');
      }
      if (code === 154 || code === 150) throw new ServiceError('Percorso troppo lungo per il servizio gratuito: aggiungi tappe intermedie.', 'toolong');
      if (r.status === 429) throw new ServiceError('Troppe richieste al servizio di calcolo. Attendi un minuto e riprova.', 'rate');
      throw new ServiceError((r.data && r.data.error) ? `Il servizio di calcolo ha risposto: ${r.data.error}` : 'Il servizio di calcolo non è disponibile. Riprova tra poco.', 'route');
    }
    return C.normalizeValhalla(r.data);
  }

  async function routeOrs(stops, veh, margin, opt, key, signal) {
    if (!key) throw new ServiceError('Per usare openrouteservice inserisci la tua chiave gratuita nelle preferenze di percorso.', 'nokey');
    const avoid = [];
    if (opt.avoidTolls) avoid.push('tollways');
    if (opt.avoidHighways) avoid.push('highways');
    if (opt.avoidFerries) avoid.push('ferries');
    const body = {
      coordinates: stops.map((s) => [+s.lon.toFixed(6), +s.lat.toFixed(6)]),
      instructions: true,
      language: 'it',
      units: 'km',
      maximum_speed: Math.max(80, opt.vmax),
      extra_info: ['tollways'],
      options: {
        vehicle_type: 'bus',
        profile_params: {
          restrictions: {
            length: veh.lunghezza,
            width: veh.larghezza,
            height: +(veh.altezza + margin).toFixed(2),
            weight: veh.peso,
            axleload: veh.caricoAsse,
          },
        },
      },
    };
    if (avoid.length) body.options.avoid_features = avoid;
    const r = await request(URLS.ors + '/v2/directions/driving-hgv/geojson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key, Accept: 'application/json, application/geo+json' },
      body: JSON.stringify(body),
      signal,
    }, 45000);
    if (!r.ok) {
      const err = r.data && r.data.error;
      const code = err && err.code;
      if (r.status === 401 || r.status === 403) throw new ServiceError('La chiave openrouteservice non è valida o è scaduta.', 'nokey');
      if (r.status === 429) throw new ServiceError('Limite giornaliero di openrouteservice raggiunto. Usa Valhalla o riprova domani.', 'rate');
      if (code === 2009) throw new ServiceError('Nessun percorso compatibile con le dimensioni del mezzo. Prova a spostare le tappe su strade principali.', 'noroute');
      if (code === 2010) throw new ServiceError('Una tappa è troppo lontana da una strada percorribile dal mezzo.', 'nopoint');
      if (code === 2004) throw new ServiceError('Percorso troppo lungo per openrouteservice (massimo circa 6.000 km).', 'toolong');
      throw new ServiceError(err && err.message ? `openrouteservice: ${err.message}` : 'openrouteservice non è disponibile. Riprova tra poco.', 'route');
    }
    return C.normalizeOrs(r.data);
  }

  /* ------------------------------ Overpass ------------------------------ */
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new ServiceError('Operazione annullata.', 'aborted')); }, { once: true });
  });

  // l'ultimo server che ha risposto bene viene provato per primo
  let preferredOverpass = null;
  function overpassOrder() {
    const list = URLS.overpass.slice();
    if (preferredOverpass) { list.splice(list.indexOf(preferredOverpass), 1); list.unshift(preferredOverpass); }
    return list;
  }

  /*
   * Le richieste a Overpass partono una alla volta: i server pubblici concedono poche
   * richieste contemporanee per utente e rispondono 429 a chi ne manda troppe insieme.
   */
  let overpassQueue = Promise.resolve();
  function queued(fn) {
    const run = overpassQueue.then(fn, fn);
    overpassQueue = run.catch(() => {});
    return run;
  }

  const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return u; } };

  /* secondi da attendere secondo la pagina di stato del server ("... in 7 seconds.") */
  async function overpassWait(ep, signal) {
    try {
      const r = await request(ep.replace(/\/interpreter$/, '/status'), { signal }, 8000);
      const t = r.text || '';
      if (/slots? available now/i.test(t)) return 1;
      const m = t.match(/in (\d+) seconds?/i);
      if (m) return Math.min(30, Number(m[1]) + 1);
    } catch (e) {
      if (e.code === 'aborted') throw e;
    }
    return 5;
  }

  function overpass(query, signal, timeoutMs) {
    return queued(() => overpassNow(query, signal, timeoutMs));
  }

  async function overpassNow(query, signal, timeoutMs) {
    if (signal && signal.aborted) throw new ServiceError('Operazione annullata.', 'aborted');
    const log = [];
    let busy = false, heavy = false;
    for (const ep of overpassOrder()) {
      const host = hostOf(ep);
      let waited = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        let r;
        try {
          r = await request(ep, { method: 'POST', body: new URLSearchParams({ data: query }), signal }, timeoutMs || 60000);
        } catch (e) {
          if (e.code === 'aborted') throw e;
          log.push(`${host}: ${e.code === 'timeout' ? 'nessuna risposta in tempo' : 'non raggiungibile'}`);
          break;
        }
        if (r.ok && r.data && Array.isArray(r.data.elements)) {
          if (r.data.remark && /runtime error|timed out|out of memory/i.test(r.data.remark)) {
            heavy = true;
            log.push(`${host}: ricerca troppo pesante`);
            break;
          }
          preferredOverpass = ep;
          return r.data;
        }
        const full = r.status === 429 || r.status === 504;
        if (full) busy = true;
        if (full && attempt < 2 && waited < 40) {
          // server pieno: si aspetta quanto indica il server e si riprova lo stesso server
          const sec = await overpassWait(ep, signal);
          waited += sec;
          await sleep(sec * 1000, signal);
          continue;
        }
        log.push(`${host}: ${full ? 'occupato (' + r.status + ')' : r.ok ? 'risposta non valida' : 'errore ' + r.status}`);
        break;
      }
    }
    const err = new ServiceError(
      busy ? 'I server OpenStreetMap sono occupati: troppe richieste in poco tempo.'
        : heavy ? 'Il server OpenStreetMap non ha completato la ricerca.'
          : 'I server OpenStreetMap non rispondono.',
      busy ? 'busy' : 'overpass');
    err.detail = log.join(' · ');
    throw err;
  }

  const RESTRICTION_KEYS = '^(maxheight|maxheight:physical|maxwidth|maxwidth:physical|maxlength|maxweight|maxweightrating|maxaxleload)$';

  function lineArg(points) {
    return points.map((p) => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join(',');
  }
  function chunks(points, size) {
    const out = [];
    for (let i = 0; i < points.length - 1; i += size - 1) out.push(points.slice(i, Math.min(points.length, i + size)));
    return out;
  }

  /* limiti lungo un tratto di percorso + aree di servizio raggiungibili */
  const CORRIDOR_TIMEOUT = 50;
  function corridorQuery(coords) {
    const fine = chunks(C.simplify(coords, 4), 250);
    const coarse = chunks(C.simplify(coords, 60), 250);
    const near = fine.map((c) => `  way(around:10,${lineArg(c)})[highway];`).join('\n');
    const svc = coarse.map((c) => `  nw(around:400,${lineArg(c)})[highway~"^(services|rest_area)$"];`).join('\n');
    return `[out:json][timeout:${CORRIDOR_TIMEOUT}];
(
${near}
)->.near;
(
  way.near[~"${RESTRICTION_KEYS}"~"."];
  way.near[~"^(hgv|bus|tourist_bus|coach)$"~"^no$"];
  node(w.near)[~"${RESTRICTION_KEYS}"~"."];
)->.lim;
.lim out body geom;
(
${svc}
)->.svc;
.svc out body center;`;
  }

  /* un tratto alla volta: richieste brevi, che i server pubblici accettano senza scadere */
  async function corridor(coords, signal) {
    const data = await overpass(corridorQuery(coords), signal, (CORRIDOR_TIMEOUT + 15) * 1000);
    return data.elements;
  }

  /* parcheggi adatti ai bus vicino alle tappe */
  async function parkings(points, radius, signal) {
    const parts = points.map((p) => {
      const a = `around:${radius},${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
      return `  nw(${a})[amenity=parking][~"^(bus|coach|tourist_bus)$"~"^(yes|designated)$"];
  nw(${a})[amenity=parking][parking~"^(bus|coach)"];
  nw(${a})[amenity=parking][hgv~"^(yes|designated)$"];`;
    }).join('\n');
    const q = `[out:json][timeout:25];
(
${parts}
);
out body center;`;
    const data = await overpass(q, signal, 35000);
    return data.elements;
  }

  /* ------------------------------ Comune di una tappa ------------------------------ */
  /*
   * Nominatim al livello del comune restituisce nome e sigla della provincia (IT-FI → FI).
   * Se non risponde si usa Photon, che dà solo il nome.
   */
  async function comuneAt(lat, lon, signal) {
    try {
      const u = new URL(URLS.nominatim + '/reverse');
      u.searchParams.set('format', 'jsonv2');
      u.searchParams.set('lat', lat.toFixed(6));
      u.searchParams.set('lon', lon.toFixed(6));
      u.searchParams.set('zoom', '10');
      u.searchParams.set('addressdetails', '1');
      u.searchParams.set('accept-language', 'it');
      const r = await request(u.toString(), { signal }, 12000);
      const a = r.ok && r.data && r.data.address;
      if (a) {
        const nome = a.city || a.town || a.village || a.municipality || a.hamlet || null;
        const iso = String(a['ISO3166-2-lvl6'] || '');
        const m = iso.match(/^IT-([A-Z]{2})$/);
        if (nome) return { nome, prov: m ? m[1] : null, paese: String(a.country_code || '').toUpperCase() || null, fonte: 'nominatim' };
      }
    } catch (e) {
      if (e.code === 'aborted') throw e;
    }
    const u2 = new URL(URLS.photon + '/reverse');
    u2.searchParams.set('lat', lat.toFixed(6));
    u2.searchParams.set('lon', lon.toFixed(6));
    u2.searchParams.set('limit', '1');
    const r2 = await request(u2.toString(), { signal }, 10000);
    const f = r2.ok && r2.data && r2.data.features && r2.data.features[0];
    const p = f && f.properties;
    if (!p) throw new ServiceError('Non riesco a riconoscere il comune della tappa.', 'comune');
    const isPlace = p.osm_key === 'place' && /^(city|town|village)$/.test(p.osm_value || '');
    const nome = p.city || (isPlace ? p.name : null);
    if (!nome) throw new ServiceError('Non riesco a riconoscere il comune della tappa.', 'comune');
    return { nome, prov: null, paese: p.countrycode ? String(p.countrycode).toUpperCase() : null, fonte: 'photon' };
  }

  /* ------------------------------ Dati scaricati (riquadri) ------------------------------ */
  /*
   * Ogni settimana GitHub Actions prepara i limiti di tutta Italia in riquadri di 0,25° e li
   * pubblica sul ramo "dati" del repository. L'app scarica solo i riquadri del percorso e li
   * conserva sul dispositivo finché non esce un aggiornamento.
   */
  function dataBase() {
    try {
      const host = location.hostname;
      const repo = location.pathname.split('/').filter(Boolean)[0];
      if (/\.github\.io$/.test(host) && repo) return `https://raw.githubusercontent.com/${host.split('.')[0]}/${repo}/dati/`;
    } catch (e) { /* fuori dal browser */ }
    return 'https://raw.githubusercontent.com/andreguernieri-prog/rotta-pullman/dati/';
  }
  URLS.dati = dataBase();
  const DATA_CACHE = 'rotta-pullman-dati';
  let indexPromise = null;

  async function openDataCache() {
    try { return typeof caches !== 'undefined' ? await caches.open(DATA_CACHE) : null; } catch (e) { return null; }
  }

  async function dropOldTiles(generato) {
    const c = await openDataCache();
    if (!c) return;
    try {
      const tag = 'v=' + encodeURIComponent(generato);
      for (const req of await c.keys()) if (!req.url.includes(tag)) await c.delete(req);
    } catch (e) { /* pulizia non essenziale */ }
  }

  /* indice dei dati, o null se non disponibile (l'app userà Overpass) */
  function dataIndex() {
    if (!indexPromise) {
      indexPromise = (async () => {
        const r = await request(URLS.dati + 'index.json?h=' + Math.floor(Date.now() / 36e5), {}, 15000);
        if (!r.ok || !r.data || r.data.versione !== 1 || !r.data.riquadri || !r.data.copertura) return null;
        dropOldTiles(r.data.generato);
        return r.data;
      })().catch(() => null);
      indexPromise.then((v) => { if (!v) indexPromise = null; });
    }
    return indexPromise;
  }

  const tileMem = new Map();
  async function dataTile(index, key, signal) {
    const url = URLS.dati + 'riquadri/' + key + '.json?v=' + encodeURIComponent(index.generato);
    if (tileMem.has(url)) return tileMem.get(url);
    const c = await openDataCache();
    let data = null;
    if (c) { try { const hit = await c.match(url); if (hit) data = await hit.json(); } catch (e) { data = null; } }
    if (!data) {
      const r = await request(url, { signal }, 30000);
      if (!r.ok || !r.data) throw new ServiceError('Dati dei limiti non disponibili per questa zona.', 'tile');
      data = r.data;
      if (c) { try { await c.put(url, new Response(r.text, { headers: { 'Content-Type': 'application/json' } })); } catch (e) { /* memoria piena */ } }
    }
    tileMem.set(url, data);
    if (tileMem.size > 120) tileMem.delete(tileMem.keys().next().value);
    return data;
  }

  /* riquadri richiesti, quattro alla volta; quelli vuoti non esistono e si saltano */
  async function dataTiles(index, keys, signal) {
    const wanted = keys.filter((k) => index.riquadri[k]);
    const out = [];
    let next = 0;
    const worker = async () => {
      while (next < wanted.length) {
        const k = wanted[next++];
        out.push(await dataTile(index, k, signal));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }

  root.RPServices = { URLS, ServiceError, geocode, geocodeFallback, reverse, routeValhalla, routeOrs, corridor, corridorQuery, parkings, valhallaBody, comuneAt, sleep, dataIndex, dataTiles };
})(typeof self !== 'undefined' ? self : this);
