# Rotta Pullman

Web app per pianificare viaggi di gruppo in pullman: calcola percorsi adatti a mezzi lunghi 12–15 m (e oltre), di varie altezze e pesi, controlla i punti critici lungo la strada e prepara il programma con le pause dell'autista.

Funziona nel browser, su telefono e computer, senza registrazione e senza server propri.

## Cosa fa

- **Percorso in base al mezzo.** Lunghezza, altezza (con margine di sicurezza), larghezza, massa e carico per asse vengono passati al motore di calcolo, che evita le strade con limiti incompatibili. Mezzi tipo pronti: midibus, gran turismo 12/13/14/15 m, bipiano, snodato 18 m. I propri mezzi si salvano nel "garage".
- **Controllo dei punti critici.** Dopo il calcolo, l'app interroga OpenStreetMap lungo tutto il percorso: limiti di altezza, larghezza, lunghezza, massa, carico per asse e divieti per bus o mezzi pesanti. Ogni punto è mostrato sulla mappa con il suo cartello e classificato come *non transitabile* o *da verificare*, con link a Street View.
- **Sul percorso o vicino al percorso.** Un limite è *sul percorso* quando la sua strada coincide con quella percorsa (stessi tratti, o stesso nome o sigla). Se è solo a pochi metri, per esempio una laterale o una strada che passa sotto un viadotto, viene comunque segnalato, ma come *Forse non sul percorso*: icona sbiadita con «?» sulla mappa, bordo tratteggiato, distanza in metri. Dalla scheda l'operatore indica se riguarda il percorso o no; la scelta resta salvata sul dispositivo per quel viaggio e si può annullare.
- **Divieti a giorni e orari.** I divieti e i limiti che OpenStreetMap riporta con una condizione (per esempio «bus vietati lun–ven 7–19», «massa max 3,5 t dalle 7 alle 20», «chiusa da novembre ad aprile», festivi compresi) vengono confrontati con l'ora stimata di passaggio, che tiene conto delle pause. Ogni divieto risulta *vietato al passaggio*, *a ridosso dell'orario* (entro un'ora), *non in vigore al passaggio* (in una sezione a parte) o *da verificare* se la condizione non è leggibile o dipende dal meteo. Cambiando data o ora di partenza lo stato si aggiorna. La data di partenza viene passata anche al calcolo del percorso, che evita i divieti a orario che conosce. Il calendario nazionale dei divieti per i mezzi pesanti (festivi ed estate) riguarda i veicoli che trasportano merci sopra 7,5 t e non gli autobus: l'app lo ricorda nel riquadro del controllo.
- **Programma con pause di legge** (Reg. CE 561/2006): 45′ entro 4 h 30 di guida, oppure frazionata 15′ + 30′, oppure doppio autista. Le pause vengono collocate nelle aree di servizio raggiungibili sulla propria carreggiata. Le soste nelle tappe (es. visita di 1 h) contano come pausa. Avvisi oltre 9/10 h di guida e oltre 13 h di impegno.
- **Permessi e ZTL.** Per ogni tappa l'app riconosce il comune e dice se i bus turistici hanno bisogno di un permesso, di un ticket o di una prenotazione, oppure se l'accesso è vietato. Indica i passaggi per ottenerlo, i costi indicativi, i contatti e i link alle pagine ufficiali. Le città in elenco sono Roma, Firenze, Venezia, Milano, Napoli, Verona, Siena, Pisa, Bologna, Torino, Lucca, Perugia, Bergamo e i comuni della Costiera Amalfitana. Per gli altri comuni l'app avvisa che non ha dati e propone la ricerca delle regole.
- **Parcheggi vicino all'arrivo**, da OpenStreetMap: quelli segnati per bus o mezzi pesanti entro 1 km; se non ce ne sono, i più vicini fino a 5 km. In più, i parcheggi generici grandi e all'aperto entro 1 km (almeno 2.500 m² o 60 posti, esclusi quelli sotterranei, a più piani, privati o con limite di altezza), indicati come *da verificare*, con vista satellite e Street View. Un pulsante apre una nota su OpenStreetMap per segnalare un parcheggio bus mancante.
- **Indicazioni svolta per svolta**, **GPX** per i navigatori per mezzi pesanti (OsmAnd, Sygic Truck, Garmin…), **link condivisibile** che riapre lo stesso viaggio con lo stesso mezzo, **foglio di viaggio** stampabile.

## Dati dei limiti scaricati ogni settimana

Per non interrogare i server OpenStreetMap a ogni percorso, la procedura `.github/workflows/dati-limiti.yml` gira ogni lunedì su GitHub Actions:

1. scarica da Geofabrik la mappa OpenStreetMap dell'Italia;
2. con osmium estrae limiti di altezza, larghezza, lunghezza e peso, divieti per bus e mezzi pesanti (anche quelli a giorni e orari), aree di servizio, parcheggi per bus e parcheggi grandi all'aperto;
3. con `tools/build-data.js` tiene solo i limiti che riguardano un bus e li divide in riquadri di 0,25° (circa 28 × 20 km);
4. pubblica il risultato sul ramo `dati`, sovrascrivendolo: lo storico del repository non cresce.

L'app scarica solo i riquadri attraversati dal percorso e li conserva sul dispositivo fino all'aggiornamento successivo. Per i tratti fuori dalla copertura (l'estero) e se i dati non sono disponibili usa Overpass come prima. Il riquadro del controllo indica la data dei dati e avvisa se hanno più di tre settimane.

La procedura si può avviare a mano da GitHub: scheda Actions, "Dati dei limiti (Italia)", Run workflow.

## Verifica dei dati di OpenStreetMap

I limiti di OpenStreetMap sono inseriti da volontari e possono contenere errori. Per ogni punto critico la scheda mostra:

- data dell'ultima modifica, versione e fonte dichiarata del dato (per esempio "cartello stradale"), con un avviso se il dato ha molti anni o se il valore è insolito per il tipo di strada;
- **seconda verifica con TomTom** (facoltativa): con una chiave gratuita di developer.tomtom.com, inserita nelle preferenze di percorso, l'app calcola lo stesso viaggio con TomTom due volte, con le dimensioni del mezzo e come auto. Dove TomTom percorre il tratto in auto ma lo evita col bus, conosce probabilmente un limite: l'app conferma i punti di OpenStreetMap, segnala quando i due dati non concordano e aggiunge i tratti che OpenStreetMap non riporta;
- **foto Mapillary**: collegamento alle foto stradali del punto; con un token gratuito di Mapillary, anche la foto più recente e i cartelli di limite riconosciuti nelle foto;
- **Segnala un errore**: apre una nota su OpenStreetMap nel punto, così l'errore viene corretto per tutti.

Le chiavi restano solo sul dispositivo e non entrano nei link condivisi.

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
| Punti critici, aree di servizio, parcheggi | Dati OpenStreetMap scaricati ogni settimana (Geofabrik) | In Italia. Fuori Italia o se i dati mancano: Overpass API, un tratto di circa 25 km alla volta |
| Mappe | OpenStreetMap, Esri (stradale e satellite) | Senza chiave. Le mappe OpenStreetMap funzionano dal sito pubblicato; aprendo il file dal disco si parte con Esri |

Per un uso intenso conviene un'istanza Valhalla propria o un abbonamento a un servizio di calcolo: basta cambiare gli indirizzi in `js/services.js`.

## Limiti da conoscere

- I dati OpenStreetMap possono essere incompleti: un sottopasso basso non mappato non verrà segnalato. Rispettare sempre la segnaletica.
- Molte ordinanze locali a orario (ZTL, divieti estivi, chiusure temporanee) non sono su OpenStreetMap. Per le città più visitate le regole sono nella sezione permessi; per il resto valgono i cartelli e le ordinanze del comune.
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
tools/build-data.js   prepara i riquadri dei limiti (usato dalla procedura settimanale)
.github/workflows/    procedura settimanale dei dati
tests/                test della logica e test end-to-end
```

## Test

```
node --test tests/core.test.js tests/services.test.js tests/data.test.js   # logica, servizi e dati (nessuna dipendenza)
npm install && npm run test:e2e         # interfaccia, con servizi esterni simulati
```

I test end-to-end usano risposte simulate con la stessa forma di quelle reali: verificano l'interfaccia, non la qualità dei percorsi.
