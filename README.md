# Rotta Pullman

Web app per pianificare viaggi di gruppo in pullman: calcola percorsi adatti a mezzi lunghi 12–15 m (e oltre), di varie altezze e pesi, controlla i punti critici lungo la strada e prepara il programma con le pause dell'autista.

Funziona nel browser, su telefono e computer, senza registrazione e senza server propri.

## Cosa fa

- **Percorso in base al mezzo.** Lunghezza, altezza (con margine di sicurezza), larghezza, massa e carico per asse vengono passati al motore di calcolo, che evita le strade con limiti incompatibili. Mezzi tipo pronti: midibus, gran turismo 12/13/14/15 m, bipiano, snodato 18 m. I propri mezzi si salvano nel "garage".
- **Controllo dei punti critici.** Dopo il calcolo, l'app interroga OpenStreetMap lungo tutto il percorso: limiti di altezza, larghezza, lunghezza, massa, carico per asse e divieti per bus o mezzi pesanti. Ogni punto è mostrato sulla mappa con il suo cartello e classificato come *non transitabile* o *da verificare*, con link a Street View.
- **Programma con pause di legge** (Reg. CE 561/2006): 45′ entro 4 h 30 di guida, oppure frazionata 15′ + 30′, oppure doppio autista. Le pause vengono collocate nelle aree di servizio raggiungibili sulla propria carreggiata. Le soste nelle tappe (es. visita di 1 h) contano come pausa. Avvisi oltre 9/10 h di guida e oltre 13 h di impegno.
- **Parcheggi bus** segnati su OpenStreetMap entro 1,5 km da ogni tappa.
- **Indicazioni svolta per svolta**, **GPX** per i navigatori per mezzi pesanti (OsmAnd, Sygic Truck, Garmin…), **link condivisibile** che riapre lo stesso viaggio con lo stesso mezzo, **foglio di viaggio** stampabile.

## Pubblicarla

È un sito statico: basta copiare la cartella su un qualsiasi hosting.

- **GitHub Pages:** carica la cartella in un repository, poi *Settings → Pages → Deploy from a branch → main / root*. L'app sarà su `https://<utente>.github.io/<repository>/`.
- **Netlify, Cloudflare Pages o simili:** trascina la cartella nella pagina di caricamento.
- **Senza hosting:** `dist/rotta-pullman.html` contiene tutta l'app in un solo file. Si apre con un doppio clic sul computer o si invia ai colleghi. Si rigenera con `node tools/build-single.js`.

Sul telefono, dal browser, "Aggiungi a schermata Home" la installa come un'app.

## Servizi usati

Tutti gratuiti e basati su dati OpenStreetMap. Sono servizi pubblici con uso "ragionevole": vanno benissimo per un'agenzia o una piccola flotta, non per migliaia di calcoli al giorno.

| Funzione | Servizio | Note |
|---|---|---|
| Calcolo percorso | [Valhalla FOSSGIS](https://valhalla1.openstreetmap.de) (profilo mezzo pesante) | Predefinito, nessuna chiave |
| Calcolo percorso, alternativa | [openrouteservice](https://openrouteservice.org) (profilo HGV, tipo veicolo *bus*) | Chiave gratuita, 2.000 calcoli/giorno. Tiene conto anche degli accessi riservati ai bus |
| Ricerca indirizzi | Photon (komoot), riserva Nominatim | |
| Punti critici, aree di servizio, parcheggi | Overpass API | Con server di riserva |
| Mappe | CARTO Voyager, OpenStreetMap, Esri (satellite) | |

Per un uso intenso conviene un'istanza Valhalla propria o un abbonamento a un servizio di calcolo: basta cambiare gli indirizzi in `js/services.js`.

## Limiti da conoscere

- I dati OpenStreetMap possono essere incompleti: un sottopasso basso non mappato non verrà segnalato. Rispettare sempre la segnaletica.
- Valhalla usa il profilo "mezzo pesante": con l'opzione *Evita strade vietate ai mezzi pesanti* attiva (predefinita) evita anche strade dove i bus sarebbero ammessi. Se un percorso non si trova, disattivarla: quelle strade restano usabili ma penalizzate, e l'app segnala i divieti da verificare.
- Raggio di sterzata, tornanti e strade strette senza limite segnalato non sono valutabili automaticamente: per i tratti di montagna conviene un'occhiata alla vista satellite o a Street View.
- ZTL e permessi per bus turistici dipendono dal comune: l'app lo ricorda, ma non li verifica.

## Struttura

```
index.html            pagina dell'app
css/app.css           stile (chiaro e scuro, telefono e desktop)
js/core.js            logica pura: limiti, controllo del percorso, pause, GPX, link
js/services.js        chiamate ai servizi esterni
js/app.js             interfaccia e mappa (Leaflet)
vendor/leaflet/       Leaflet 1.9.4
tools/build-single.js crea dist/rotta-pullman.html
tests/                test della logica e test end-to-end
```

## Test

```
node --test tests/core.test.js          # logica (nessuna dipendenza)
npm install && npm run test:e2e         # interfaccia, con servizi esterni simulati
```

I test end-to-end usano risposte simulate con la stessa forma di quelle reali: verificano l'interfaccia, non la qualità dei percorsi.
