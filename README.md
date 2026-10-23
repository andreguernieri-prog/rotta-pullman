# Rotta Pullman

Web app per pianificare viaggi di gruppo in pullman: calcola percorsi adatti a mezzi lunghi 12–15 m (e oltre), di varie altezze e pesi, controlla i punti critici lungo la strada e prepara il programma con le pause dell'autista.

Funziona nel browser, su telefono e computer, senza registrazione e senza server propri.

## Cosa fa

- **Percorso in base al mezzo.** Lunghezza, altezza (con margine di sicurezza), larghezza, massa e carico per asse vengono passati al motore di calcolo, che evita le strade con limiti incompatibili. Mezzi tipo pronti: midibus, gran turismo 12/13/14/15 m, bipiano, snodato 18 m. I propri mezzi si salvano nel "garage".
- **Controllo dei punti critici.** Dopo il calcolo, l'app interroga OpenStreetMap lungo tutto il percorso: limiti di altezza, larghezza, lunghezza, massa, carico per asse e divieti per bus o mezzi pesanti. Ogni punto è mostrato sulla mappa con il suo cartello e classificato come *non transitabile* o *da verificare*, con link a Street View.
- **Programma con pause di legge** (Reg. CE 561/2006): 45′ entro 4 h 30 di guida, oppure frazionata 15′ + 30′, oppure doppio autista. Le pause vengono collocate nelle aree di servizio raggiungibili sulla propria carreggiata. Le soste nelle tappe (es. visita di 1 h) contano come pausa. Avvisi oltre 9/10 h di guida e oltre 13 h di impegno.
- **Permessi e ZTL.** Per ogni tappa l'app riconosce il comune e dice se i bus turistici hanno bisogno di un permesso, di un ticket o di una prenotazione, oppure se l'accesso è vietato. Indica i passaggi per ottenerlo, i costi indicativi, i contatti e i link alle pagine ufficiali. Le città in elenco sono Roma, Firenze, Venezia, Milano, Napoli, Verona, Siena, Pisa, Bologna, Torino, Lucca, Perugia, Bergamo e i comuni della Costiera Amalfitana. Per gli altri comuni l'app avvisa che non ha dati e propone la ricerca delle regole.
- **Parcheggi bus** segnati su OpenStreetMap entro 1,5 km da ogni tappa.
- **Indicazioni svolta per svolta**, **GPX** per i navigatori per mezzi pesanti (OsmAnd, Sygic Truck, Garmin…), **link condivisibile** che riapre lo stesso viaggio con lo stesso mezzo, **foglio di viaggio** stampabile.

## Aggiornare le regole dei permessi

Le regole stanno in `js/permessi.js`, una scheda per comune, con la data dell'ultimo controllo. Non esiste un servizio pubblico con questi dati: vanno aggiornate a mano dai siti ufficiali dei comuni e degli enti che rilasciano i permessi. Il file spiega i campi in testa. Dopo una modifica, `node --test tests/core.test.js` controlla che ogni scheda sia completa.

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
| Comune di ogni tappa | Nominatim, riserva Photon | Al massimo una richiesta al secondo |
| Punti critici, aree di servizio, parcheggi | Overpass API | Un tratto di circa 25 km alla volta, con server di riserva |
| Mappe | OpenStreetMap, Esri (stradale e satellite) | Senza chiave. Le mappe OpenStreetMap funzionano dal sito pubblicato; aprendo il file dal disco si parte con Esri |

Per un uso intenso conviene un'istanza Valhalla propria o un abbonamento a un servizio di calcolo: basta cambiare gli indirizzi in `js/services.js`.

## Limiti da conoscere

- I dati OpenStreetMap possono essere incompleti: un sottopasso basso non mappato non verrà segnalato. Rispettare sempre la segnaletica.
- Valhalla usa il profilo "mezzo pesante": con l'opzione *Evita strade vietate ai mezzi pesanti* attiva (predefinita) evita anche strade dove i bus sarebbero ammessi. Se un percorso non si trova, disattivarla: quelle strade restano usabili ma penalizzate, e l'app segnala i divieti da verificare.
- Raggio di sterzata, tornanti e strade strette senza limite segnalato non sono valutabili automaticamente: per i tratti di montagna conviene un'occhiata alla vista satellite o a Street View.
- Le regole dei permessi sono state raccolte il 23 ottobre 2026 e cambiano spesso: l'app rimanda sempre alla pagina ufficiale da controllare prima di partire.

## Struttura

```
index.html            pagina dell'app
css/app.css           stile (chiaro e scuro, telefono e desktop)
js/core.js            logica pura: limiti, controllo del percorso, pause, permessi, GPX, link
js/permessi.js        regole di accesso per i bus turistici, comune per comune
js/services.js        chiamate ai servizi esterni
js/app.js             interfaccia e mappa (Leaflet)
vendor/leaflet/       Leaflet 1.9.4
tools/build-single.js crea dist/rotta-pullman.html
tests/                test della logica e test end-to-end
```

## Test

```
node --test tests/core.test.js tests/services.test.js   # logica e chiamate ai servizi (nessuna dipendenza)
npm install && npm run test:e2e         # interfaccia, con servizi esterni simulati
```

I test end-to-end usano risposte simulate con la stessa forma di quelle reali: verificano l'interfaccia, non la qualità dei percorsi.
