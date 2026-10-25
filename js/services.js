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
  const NOROUTE_MSG = 'Nessun percorso per questo mezzo. Di solito una tappa si raggiunge solo da strade con limiti (ponte, strettoia, sottopasso) o chiuse al traffico: spostala dove il pullman si ferma davvero, per esempio un parcheggio o la strada principale.';
  function valhallaBody(stops, veh, margin, opt) {
    const body = {
      // radius: per una tappa irraggiungibile, Valhalla può arrivare alla strada percorribile più vicina entro quel raggio
      locations: stops.map((s) => Object.assign({ lat: +s.lat.toFixed(6), lon: +s.lon.toFixed(6), type: 'break' }, s.radius ? { radius: s.radius } : {})),
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
    // con data e ora di partenza Valhalla rispetta i divieti a orario che conosce (es. hgv:conditional)
    if (opt.departure && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(opt.departure)) body.date_time = { type: 1, value: opt.departure.slice(0, 16) };
    // punti non transitabili da evitare: Valhalla esclude le strade più vicine a ciascuno
    if (opt.avoid && opt.avoid.length) body.exclude_locations = opt.avoid.slice(0, 50).map((p) => ({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) }));
    return body;
  }

  async function routeValhalla(stops, veh, margin, opt, signal) {
    const body = valhallaBody(stops, veh, margin, opt);
    const ask = (b) => request(URLS.valhalla + '/route?json=' + encodeURIComponent(JSON.stringify(b)), { signal }, 45000);
    let r = await ask(body);
    const known = [442, 443, 170, 171, 172, 150, 154];
    if (body.date_time && !r.ok && r.status >= 400 && r.status < 500 && r.status !== 429 && !(r.data && known.includes(r.data.error_code))) {
      // data non accettata: si calcola senza orario
      delete body.date_time;
      r = await ask(body);
    }
    if (!r.ok || !r.data || !r.data.trip) {
      const code = r.data && r.data.error_code;
      if (code === 442 || code === 443) {
        throw new ServiceError(NOROUTE_MSG + (opt.strictHgv ? ' Se non basta, disattiva “Evita strade vietate ai mezzi pesanti”: molti divieti per i camion non valgono per i bus.' : ''), 'noroute');
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
    // punti non transitabili da evitare: un quadrato di circa 24 m intorno a ciascuno
    if (opt.avoid && opt.avoid.length) {
      body.options.avoid_polygons = {
        type: 'MultiPolygon',
        coordinates: opt.avoid.slice(0, 50).map((p) => {
          const dLat = 12 / 110540, dLon = 12 / (111320 * Math.cos(p.lat * Math.PI / 180));
          const r6 = (x) => +x.toFixed(6);
          return [[[r6(p.lon - dLon), r6(p.lat - dLat)], [r6(p.lon + dLon), r6(p.lat - dLat)], [r6(p.lon + dLon), r6(p.lat + dLat)], [r6(p.lon - dLon), r6(p.lat + dLat)], [r6(p.lon - dLon), r6(p.lat - dLat)]]];
        }),
      };
    }
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
      if (code === 2009) throw new ServiceError(NOROUTE_MSG, 'noroute');
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
  // divieti e limiti a giorni/orari o con condizioni
  const CONDITIONAL_KEYS = '^(' + C.COND_KEYS.join('|') + '):conditional$';

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
  way.near[~"${CONDITIONAL_KEYS}"~"."];
  node(w.near)[~"${RESTRICTION_KEYS}"~"."];
  node(w.near)[~"${CONDITIONAL_KEYS}"~"."];
)->.lim;
.lim out meta geom;
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

  /*
   * Parcheggi intorno all'arrivo: quelli per bus o mezzi pesanti fino a "far" metri,
   * quelli generici all'aperto entro "near" metri (con il perimetro, per stimarne la superficie).
   * radius: numero (stesso raggio per tutti) oppure { near, far }.
   */
  async function parkings(points, radius, signal) {
    const near = typeof radius === 'number' ? radius : radius.near;
    const far = typeof radius === 'number' ? radius : radius.far;
    const at = (p, r) => `around:${r},${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    const bus = points.map((p) => {
      const a = at(p, far);
      return `  nw(${a})[amenity=parking][~"^(bus|coach|tourist_bus)$"~"^(yes|designated)$"];
  nw(${a})[amenity=parking][parking~"^(bus|coach)"];
  nw(${a})[amenity=parking][hgv~"^(yes|designated)$"];`;
    }).join('\n');
    const gen = points.map((p) => {
      const a = at(p, near);
      return `  way(${a})[amenity=parking][access!~"^(private|no)$"][parking!~"^(underground|multi-storey|rooftop|garage_boxes|carports|sheds|lane|street_side|on_kerb|half_on_kerb)$"];
  node(${a})[amenity=parking][capacity][access!~"^(private|no)$"];`;
    }).join('\n');
    const q = `[out:json][timeout:25];
(
${bus}
);
out body center;
(
${gen}
);
out body geom;`;
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

  /* ------------------------------ TomTom (seconda opinione) ------------------------------ */
  /*
   * Percorso TomTom tra le stesse tappe. mode 'bus': con le dimensioni del mezzo; 'car': come auto.
   * Restituisce i punti [[lat, lon], ...]. Serve la chiave gratuita dell'utente (developer.tomtom.com).
   */
  /*
   * Strade OpenStreetMap percorse (Valhalla trace_attributes): per ogni strada l'identificativo della via,
   * se è un ponte o una galleria, e dove inizia e finisce. Serve a dire con certezza se un limite è sulla
   * strada percorsa o su una che passa sotto o sopra. Il servizio pubblico accetta tracce fino a 200 km:
   * il percorso si invia a tratti di circa 80 km. Un tratto che non risponde resta scoperto (failed).
   * La richiesta è un POST "semplice" (testo), senza intestazioni aggiuntive.
   */
  const TRACE_CHUNK_M = 80000;
  async function traceWays(coords, signal) {
    const chunks = [];
    let cur = [coords[0]], len = 0;
    for (let i = 1; i < coords.length; i++) {
      cur.push(coords[i]);
      len += C.haversine(coords[i - 1], coords[i]);
      if (len >= TRACE_CHUNK_M && i < coords.length - 1) { chunks.push(cur); cur = [coords[i]]; len = 0; }
    }
    if (cur.length > 1) chunks.push(cur);
    const runs = [];
    let failed = 0;
    for (const ch of chunks) {
      const pts = ch.length > 4000 ? C.simplify(ch, 1) : ch;
      const body = {
        encoded_polyline: C.encodePolyline(pts, 6),
        costing: 'auto',
        shape_match: 'walk_or_snap',
        filters: { attributes: ['shape', 'edge.way_id', 'edge.bridge', 'edge.tunnel', 'edge.begin_shape_index', 'edge.end_shape_index'], action: 'include' },
      };
      let r;
      try {
        r = await request(URLS.valhalla + '/trace_attributes', { method: 'POST', body: JSON.stringify(body), signal }, 30000);
      } catch (e) {
        if (e.code === 'aborted') throw e;
        failed++; continue;
      }
      if (!r.ok || !r.data || !Array.isArray(r.data.edges) || !r.data.shape) { failed++; continue; }
      const shape = C.decodePolyline(r.data.shape, 6);
      for (const e of r.data.edges) {
        const a = shape[e.begin_shape_index], b = shape[e.end_shape_index];
        if (!a || !b || e.way_id == null) continue;
        runs.push({ id: Number(e.way_id), bridge: !!e.bridge, tunnel: !!e.tunnel, from: a, to: b });
      }
    }
    return { runs, failed, chunks: chunks.length };
  }

  /* segnalazioni di traffico TomTom in un riquadro [minLon, minLat, maxLon, maxLat], in italiano */
  const INCIDENT_FIELDS = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity}}}';
  async function tomtomIncidents(bbox, key, signal) {
    const u = new URL('https://api.tomtom.com/traffic/services/5/incidentDetails');
    u.searchParams.set('key', key);
    u.searchParams.set('bbox', bbox.join(','));
    u.searchParams.set('fields', INCIDENT_FIELDS);
    u.searchParams.set('language', 'it-IT');
    u.searchParams.set('timeValidityFilter', 'present,future');
    const r = await request(u.toString(), { signal }, 20000);
    if (r.status === 401 || r.status === 403) throw new ServiceError('La chiave TomTom non è abilitata al servizio Traffic: attivalo nel tuo account su developer.tomtom.com.', 'nokey');
    if (r.status === 429) throw new ServiceError('Limite di richieste TomTom raggiunto: riprova più tardi.', 'rate');
    if (!r.ok || !r.data) throw new ServiceError('Il servizio traffico di TomTom non risponde. Riprova tra poco.', 'traffic');
    return r.data.incidents || [];
  }

  async function tomtomRoute(stops, veh, margin, opt, key, mode, signal) {
    const locs = stops.map((s) => s.lat.toFixed(6) + ',' + s.lon.toFixed(6)).join(':');
    const u = new URL('https://api.tomtom.com/routing/1/calculateRoute/' + locs + '/json');
    u.searchParams.set('key', key);
    u.searchParams.set('routeType', 'fastest');
    u.searchParams.set('traffic', 'false');
    u.searchParams.set('routeRepresentation', 'polyline');
    if (mode === 'bus') {
      u.searchParams.set('travelMode', 'bus');
      u.searchParams.set('vehicleHeight', (veh.altezza + margin).toFixed(2));
      u.searchParams.set('vehicleWidth', String(veh.larghezza));
      u.searchParams.set('vehicleLength', String(veh.lunghezza));
      u.searchParams.set('vehicleWeight', String(Math.round(veh.peso * 1000)));
      u.searchParams.set('vehicleAxleWeight', String(Math.round(veh.caricoAsse * 1000)));
      u.searchParams.set('vehicleCommercial', 'true');
      u.searchParams.set('vehicleMaxSpeed', String(opt.vmax || 100));
    } else {
      u.searchParams.set('travelMode', 'car');
    }
    if (opt.avoidTolls) u.searchParams.append('avoid', 'tollRoads');
    if (opt.avoidHighways) u.searchParams.append('avoid', 'motorways');
    if (opt.avoidFerries) u.searchParams.append('avoid', 'ferries');
    const r = await request(u.toString(), { signal }, 30000);
    if (r.status === 401 || r.status === 403) throw new ServiceError('La chiave TomTom non è valida o non è abilitata alla Routing API.', 'nokey');
    if (r.status === 429) throw new ServiceError('Limite giornaliero di TomTom raggiunto: riprova domani.', 'rate');
    const route = r.ok && r.data && r.data.routes && r.data.routes[0];
    if (!route) {
      const msg = r.data && r.data.detailedError && r.data.detailedError.message;
      throw new ServiceError(msg ? 'TomTom: ' + msg : 'TomTom non ha calcolato il percorso.', 'tomtom');
    }
    const pts = [];
    for (const leg of route.legs || []) for (const p of leg.points || []) pts.push([p.latitude, p.longitude]);
    if (pts.length < 2) throw new ServiceError('TomTom ha restituito un percorso vuoto.', 'tomtom');
    return pts;
  }

  /* ------------------------------ Mapillary (foto stradali) ------------------------------ */
  /* foto più recente entro ~40 m e cartelli di limite rilevati nelle foto; serve un token gratuito */
  async function mapillaryNear(lat, lon, token, signal) {
    const dLat = 0.00036, dLon = 0.0005;
    const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((x) => x.toFixed(6)).join(',');
    const base = 'https://graph.mapillary.com/';
    const tk = 'access_token=' + encodeURIComponent(token);
    const [imgs, feats] = await Promise.all([
      request(`${base}images?${tk}&fields=id,thumb_256_url,captured_at&bbox=${bbox}&limit=30`, { signal }, 12000),
      request(`${base}map_features?${tk}&fields=id,object_value,geometry,last_seen_at&bbox=${bbox}`, { signal }, 12000),
    ]);
    if ([imgs.status, feats.status].some((x) => x === 401 || x === 403)) throw new ServiceError('Il token Mapillary non è valido.', 'nokey');
    const list = (imgs.ok && imgs.data && imgs.data.data) || [];
    list.sort((a, b) => (b.captured_at || 0) - (a.captured_at || 0));
    const signs = ((feats.ok && feats.data && feats.data.data) || [])
      .filter((f) => /height|weight|width|length|axle|heavy|truck|goods|bus/i.test(f.object_value || ''));
    return { image: list[0] || null, signs };
  }

  root.RPServices = { URLS, ServiceError, geocode, geocodeFallback, reverse, routeValhalla, routeOrs, corridor, corridorQuery, parkings, valhallaBody, comuneAt, sleep, dataIndex, dataTiles, tomtomRoute, tomtomIncidents, mapillaryNear, traceWays };
})(typeof self !== 'undefined' ? self : this);
