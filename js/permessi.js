/*
 * Rotta Pullman — regole di accesso per i bus turistici, comune per comune.
 *
 * Fonti: siti ufficiali dei comuni e degli enti che gestiscono i permessi, consultati il
 * 23 ottobre 2026. Regole e tariffe cambiano spesso: ogni scheda rimanda alla pagina
 * ufficiale e l'app invita sempre a controllarla prima di partire.
 *
 * Per aggiungere o correggere un comune basta modificare questo file:
 *  - comuni:  nome del comune come su OpenStreetMap + sigla della provincia
 *  - stato:   'permesso' (serve un permesso o un ticket), 'limitato' (accesso vietato o
 *             ristretto, con eccezioni), 'verifica' (regole da controllare caso per caso)
 *  - passi:   cosa fare, in ordine
 *  - link:    pagine ufficiali (la prima è la principale)
 *  - affidabilita: 'confermato' se le fonti ufficiali concordano, 'parziale' se mancano dettagli
 */
(function (root) {
  'use strict';
  root.RPPermessi = {
    verificato: '2026-10-23',
    elencoNazionale: {
      testo: 'Elenco ANAV dei ticket bus nelle città italiane (febbraio 2025)',
      url: 'https://www.anav.it/wp-content/uploads/2023/04/TICKET.BUS_.NELLE_.PRINCIPALI.CITTA_.Elenco_feb.2025.pdf',
    },
    regole: [
      {
        id: 'roma',
        comuni: [{ nome: 'Roma', prov: 'RM' }],
        stato: 'permesso',
        titolo: 'Permesso ZTL Bus obbligatorio',
        sintesi: 'Dentro il Grande Raccordo Anulare i bus turistici circolano solo con un permesso. Il permesso A vale per la ZTL Bus A, la fascia tra il GRA e la zona semicentrale. Il permesso B vale per le ZTL Bus A e B, la zona semicentrale che comprende l\'area vaticana. Il centro storico è vietato ai bus turistici, salvo casi particolari.',
        passi: [
          'Dal 1° gennaio 2026 i permessi si acquistano solo online sul sito di Roma Servizi per la Mobilità: il check point non li vende più.',
          'Accedi con lo SPID del legale rappresentante dell\'azienda, o di una persona da lui delegata.',
          'Scegli il permesso (A o B, giornaliero o carnet di ingressi) indicando targa, classe Euro, lunghezza del mezzo e giorno di ingresso.',
          'Paga con PagoPA (carta di credito): il bonifico non è più accettato. Muoviti con qualche giorno di anticipo, per alcune tipologie la richiesta va fatta 5 giorni prima.',
          'Stampa il permesso su un foglio A4 ed esponilo sul parabrezza.',
        ],
        costi: 'Indicativi, giornaliero online per bus oltre 8 m: permesso A circa 30 €, permesso B circa 451 €. Gli importi sono cambiati più volte dopo il Giubileo: controlla la tabella ufficiale.',
        link: [
          { testo: 'Bus turistici, Roma Servizi per la Mobilità', url: 'https://romamobilita.it/servizi-al-pubblico/bus-turistici/' },
          { testo: 'Acquisto dei permessi e tariffe', url: 'https://romamobilita.it/servizi-al-pubblico/tariffe-bus-turistici/' },
        ],
        affidabilita: 'confermato',
      },
      {
        id: 'firenze',
        comuni: [{ nome: 'Firenze', prov: 'FI' }],
        stato: 'permesso',
        titolo: 'Contrassegno ZTL Bus obbligatorio',
        sintesi: 'I bus turistici entrano nella ZTL Bus di Firenze solo con un contrassegno a pagamento, acquistabile esclusivamente online. Si circola sugli itinerari stabiliti e si sosta solo nelle aree autorizzate.',
        passi: [
          'Registra l\'azienda sul portale di Servizi alla Strada (SAS) e censisci il bus con la carta di circolazione: targa, proprietà, lunghezza e classe del motore.',
          'Carica i documenti almeno 3 giorni prima del viaggio: la registrazione deve essere convalidata dall\'ufficio.',
          'Acquista il contrassegno online. La tariffa dipende da lunghezza, classe ambientale e durata della permanenza.',
          'Esponi il contrassegno sul parabrezza. I check point sono chiusi: senza contrassegno comprato online non si entra.',
        ],
        discesa: 'Salita, discesa e sosta sono ammesse solo nelle aree indicate da SAS (pagina "Parcheggi, salite e discese").',
        contatti: 'Ufficio ZTL Bus di SAS: ztlbus@serviziallastrada.it',
        link: [
          { testo: 'Permessi bus turistici, Comune di Firenze', url: 'https://servizi.comune.fi.it/servizi/scheda-servizio/permessi-bus-turistici' },
          { testo: 'Contrassegni online ZTL (SAS)', url: 'https://www.serviziallastrada.it/contrassegni-online-ztl' },
          { testo: 'Parcheggi, salite e discese', url: 'https://www.serviziallastrada.it/servizi-al-turista/autorizzazioni-circolazione-e-sosta-autobus/parcheggi-salitediscese' },
        ],
        affidabilita: 'confermato',
      },
      {
        id: 'venezia',
        comuni: [{ nome: 'Venezia', prov: 'VE' }],
        stato: 'permesso',
        titolo: 'Pass ZTL Bus obbligatorio',
        sintesi: 'Per entrare nella ZTL Bus di Venezia serve un pass a pagamento. Il prezzo dipende dalla destinazione finale (centro storico e Tronchetto, oppure terraferma e Lido) e dalla classe Euro del mezzo. Chi circola o sosta fuori dalla destinazione scelta paga una multa più la differenza di prezzo.',
        passi: [
          'Acquista il pass online sul portale ZTL Bus di AVM, con carta o conto prepagato. In alternativa si compra ai check-in all\'ingresso della città.',
          'Scegli la destinazione giusta: Venezia e Tronchetto, oppure terraferma e Lido.',
          'Se il gruppo dorme in un hotel del Comune di Venezia, chiedi il "pass alberghi" a tariffa ridotta presentando la conferma della prenotazione.',
        ],
        discesa: 'Per il centro storico i bus arrivano a Tronchetto o a Piazzale Roma. Secondo AVM, dal 1° giugno al 31 ottobre 2026 all\'Isola Nova del Tronchetto è ammessa la sosta temporanea fino a 2 ore (prima ora gratuita, poi 15 €).',
        costi: 'Fissati dalla delibera di Giunta n. 8 del 16 gennaio 2026. Le pagine AVM riportano importi diversi tra loro: controlla il prezzo per la tua categoria prima di pagare.',
        nota: 'Nei giorni previsti dal Comune, i passeggeri che visitano il centro storico pagano anche il contributo di accesso (cda.ve.it).',
        link: [
          { testo: 'ZTL Bus, AVM Venezia', url: 'https://avm.avmspa.it/it/content/ztl-bus-0' },
          { testo: 'Tariffe ZTL Bus', url: 'https://avm.avmspa.it/it/content/tariffe-ztl-bus-0' },
          { testo: 'Acquista online', url: 'https://tripplanner.veneziaunica.it/it/content/ztl-bus-acquista-online' },
        ],
        affidabilita: 'confermato',
      },
      {
        id: 'milano',
        comuni: [{ nome: 'Milano', prov: 'MI' }],
        stato: 'permesso',
        titolo: 'Ticket Area C per bus turistici',
        sintesi: 'Per entrare in Area C, la Cerchia dei Bastioni, negli orari di attivazione, i bus turistici pagano un ticket in base alla lunghezza. Il ticket comprende 5 ore di sosta gratuita nelle aree riservate ai bus.',
        passi: [
          'Acquista e attiva il ticket online su My Area C entro la mezzanotte del giorno dopo l\'ingresso, oppure al parcometro il giorno stesso.',
          'Controlla anche i limiti di Area B, che vale su quasi tutta la città, per la classe Euro del mezzo.',
        ],
        costi: 'Fino a 8 m: 60 €. Da 8 a 10,5 m: 97,50 €. Oltre 10,5 m: 150 € (tariffe in vigore dal 30 ottobre 2023). Gite scolastiche di primaria e secondaria di primo grado: 7,50 €.',
        link: [
          { testo: 'Bus turistici: regole, sosta, discesa (YesMilano)', url: 'https://www.yesmilano.it/en/tourist-buses' },
          { testo: 'Area C: acquista il ticket', url: 'https://www.comune.milano.it/en/servizi/mobilita/area-c-acquista-il-ticket' },
        ],
        affidabilita: 'confermato',
      },
      {
        id: 'napoli',
        comuni: [{ nome: 'Napoli', prov: 'NA' }],
        stato: 'permesso',
        titolo: 'Ticket ZTL Bus turistici',
        sintesi: 'Nel centro storico, a Posillipo e nell\'area Toledo, Decumani e Carmine i bus turistici con più di 8 posti oltre al conducente devono acquistare un ticket. Il prezzo dipende da dimensioni, classe Euro e fascia oraria.',
        passi: [
          'Registra l\'azienda sulla piattaforma smartmobility di ANM, con i dati aziendali e la partita IVA.',
          'Censisci ogni bus caricando la carta di circolazione e attendi la convalida: conviene farlo almeno 72 ore prima.',
          'Acquista il ticket indicando targa, giorno e fascia oraria (ci sono anche carnet e abbonamenti) e paga su PartenoPay.',
          'Esponi il contrassegno sul parabrezza. Chi non lo acquista in anticipo paga 20 € in più.',
        ],
        discesa: 'La sosta nelle aree dedicate ai bus si paga con l\'app ANM Tap&Park.',
        link: [
          { testo: 'ZTL Bus turistici, Comune di Napoli', url: 'https://www.comune.napoli.it/articolo_tematico/trasporti-mobilita/bus-turistici/ztl-bus-turistici/' },
          { testo: 'Registrazione su smartmobility ANM', url: 'https://smartmobility.anm.it/ar/registrazione.php' },
        ],
        affidabilita: 'confermato',
      },
      {
        id: 'verona',
        comuni: [{ nome: 'Verona', prov: 'VR' }],
        stato: 'permesso',
        titolo: 'Pass ZTL Bus obbligatorio',
        sintesi: 'Per circolare nella ZTL Bus di Verona, più ampia della ZTL del centro storico, serve il Pass ZTL Bus, valido fino a mezzanotte del giorno di ingresso. Senza pass si paga la tariffa giornaliera ordinaria di 300 € oltre alla sanzione.',
        passi: [
          'Acquista il pass sul portale online di AMT3. Le tariffe ridotte e quelle online vanno acquistate entro le 23:59 del giorno prima.',
          'In alternativa paga ai parcometri all\'ingresso dell\'area urbana, a tariffa intera.',
          'Esponi il pass stampato, o la ricevuta, sul cruscotto in modo ben visibile.',
        ],
        discesa: 'Nella ZTL Bus la sosta è vietata, tranne al Bus Terminal vicino al parcheggio Centro e al parcheggio C dello Stadio.',
        costi: 'Alta stagione (aprile–ottobre e dicembre) 150 €, 105 € online. Bassa stagione 100 €, 70 € online. Gruppi in hotel della provincia, con voucher: 65 €.',
        link: [
          { testo: 'ZTL Bus turistici, AMT3 Verona', url: 'https://www.amt3.it/ztl-verona/ztl-bus-turistici/' },
          { testo: 'Tariffe e riduzioni', url: 'https://www.amt3.it/ztl-verona/tariffe-pass-ztl-bus/' },
          { testo: 'Parcheggi per bus turistici', url: 'https://www.amt3.it/parcheggi-verona/parcheggi-bus-turistici/' },
        ],
        affidabilita: 'confermato',
      },
      {
        id: 'siena',
        comuni: [{ nome: 'Siena', prov: 'SI' }],
        stato: 'permesso',
        titolo: 'Prenotazione e tassa di attracco',
        sintesi: 'Siena ha una ZTL per i bus turistici: si paga e si prenota il punto di salita e discesa ("attracco"), per esempio Porta San Marco o Piazza Amendola. Il check point è al parcheggio Il Fagiolone.',
        passi: [
          'Registrati sul portale del Comune per le prenotazioni online dei permessi bus.',
          'Prenota attracco e orario: con la prenotazione si va direttamente all\'attracco nell\'orario scelto.',
          'Senza prenotazione, o in ritardo, si passa dal check point del Fagiolone e si attende l\'autorizzazione.',
        ],
        nota: 'Durante il Palio e i grandi eventi alcuni attracchi chiudono o hanno fasce orarie ridotte: controlla il bollettino della viabilità del Comune.',
        link: [
          { testo: 'Registrazione per le prenotazioni dei permessi bus', url: 'https://sismic.comune.siena.it/bus/registration' },
          { testo: 'Notizie e bollettini della viabilità, Comune di Siena', url: 'https://www.comune.siena.it/novita' },
        ],
        affidabilita: 'parziale',
      },
      {
        id: 'pisa',
        comuni: [{ nome: 'Pisa', prov: 'PI' }],
        stato: 'permesso',
        titolo: 'Permesso bus turistici (Pisamo)',
        sintesi: 'I bus turistici fermano e sostano al parcheggio di via Pietrasantina, con un permesso giornaliero a pagamento. Per entrare nel centro (ZTL) e raggiungere l\'hotel serve un permesso diverso, con autorizzazione.',
        passi: [
          'Acquista online il permesso giornaliero TS sul portale bus di Pisamo, anche senza registrazione.',
          'Se il gruppo deve raggiungere un hotel nella ZTL, chiedi il permesso TTS: l\'autorizzazione va chiesta almeno 3 giorni lavorativi prima.',
          'Gli sconti, per esempio il 50% per chi dorme in hotel convenzionati, si chiedono online con lo stesso anticipo.',
          'Al check point di via Pietrasantina (8:30–19:30) si paga solo con carta.',
        ],
        costi: 'In base alla lunghezza del mezzo: controlla la tabella aggiornata di Pisamo.',
        link: [
          { testo: 'Bus turistici, informazioni Pisamo', url: 'https://bus.pisamo.it/en/information/' },
          { testo: 'Tariffe', url: 'https://bus.pisamo.it/en/rates/' },
        ],
        affidabilita: 'confermato',
      },
      {
        id: 'bologna',
        comuni: [{ nome: 'Bologna', prov: 'BO' }],
        stato: 'limitato',
        titolo: 'Centro storico vietato ai bus turistici',
        sintesi: 'Dentro i viali di circonvallazione i bus turistici non possono circolare dalle 7 alle 20, tutti i giorni, festivi compresi. Fanno eccezione quelli diretti agli alberghi.',
        passi: [
          'Per far scendere il gruppo senza entrare usa la fermata di Porta San Mamolo (al massimo 20 minuti) oppure l\'Autostazione di piazza XX Settembre, dove si può anche parcheggiare a pagamento.',
          'Per la fermata di piazza Malpighi, dentro la ZTL, serve un ticket di accesso giornaliero comprato online in anticipo (portale TPER). Va seguito il percorso fissato: Porta Sant\'Isaia, via Sant\'Isaia, piazza Malpighi, uscita da via Marconi.',
          'La fermata in piazza Nettuno non è mai consentita.',
        ],
        costi: 'Il ticket per piazza Malpighi costava 100 € al giorno nel 2018. Un\'ordinanza del 2025 lo conferma, ma l\'importo attuale va verificato.',
        contatti: 'Comune di Bologna, informazioni bus turistici: 051 219 3042',
        link: [
          { testo: 'Bus turistici, Comune di Bologna', url: 'https://www.comune.bologna.it/servizi-informazioni/bus-turistici' },
          { testo: 'Accesso bus turistici al centro storico (Bologna Welcome)', url: 'https://www.bolognawelcome.com/it/altro/altro/accesso-bus-turistici-al-centro-storico' },
        ],
        affidabilita: 'parziale',
      },
      {
        id: 'torino',
        comuni: [{ nome: 'Torino', prov: 'TO' }],
        stato: 'permesso',
        titolo: 'Autorizzazione GTT per entrare in centro',
        sintesi: 'I bus turistici possono entrare nella ZTL centrale solo con un\'autorizzazione preventiva, la deroga per transito occasionale, rilasciata da GTT.',
        passi: [
          'Chiedi a GTT la deroga per transito occasionale prima del viaggio.',
          'Per salita e discesa usa le fermate dedicate: piazza Castello davanti al Teatro Regio, piazza Vittorio Veneto, corso Vittorio Emanuele II a Porta Nuova, viale 1° Maggio.',
        ],
        nota: 'Le pagine ufficiali non indicano tempi e costi della deroga: chiedili a GTT.',
        link: [
          { testo: 'Bus turistici, Muoversi a Torino', url: 'https://www.muoversiatorino.it/en/tourist-buses/' },
          { testo: 'In bus turistico, Turismo Torino', url: 'https://turismotorino.org/en/visit/plan-your-trip/getting-around/by-tourist-buses' },
        ],
        affidabilita: 'parziale',
      },
      {
        id: 'lucca',
        comuni: [{ nome: 'Lucca', prov: 'LU' }],
        stato: 'permesso',
        titolo: 'Ticket check point bus turistici',
        sintesi: 'I bus turistici diretti a Lucca pagano un ticket di accesso. Dall\'11 novembre 2024 si acquista solo online, prima di entrare nella ZTL: al check point non si paga più.',
        passi: [
          'Acquista il ticket sul portale di LuccaPlus, sezione bus turistici.',
          'Per la tariffa ridotta invia la richiesta online almeno 3 giorni prima dell\'arrivo.',
          'Il ticket vale dall\'arrivo fino alle 10 del giorno dopo.',
        ],
        costi: 'Tariffe 2025: giornaliero 180 €, ridotto 126 €.',
        contatti: 'Ufficio check point bus, piazzale G. Palatucci: checkpointbus@luccaplus.it, 0583 492255 (sportello aperto in alta stagione, 9:30–16:30).',
        link: [
          { testo: 'Bus turistici, LuccaPlus', url: 'https://www.luccaplus.it/en/tourist-buses/' },
          { testo: 'Check point bus turistici, Turismo Lucca', url: 'https://www.turismo.lucca.it/en/infopoint/bus-turistici-check-point' },
        ],
        affidabilita: 'confermato',
      },
      {
        id: 'perugia',
        comuni: [{ nome: 'Perugia', prov: 'PG' }],
        stato: 'limitato',
        titolo: 'Area urbana vietata ai bus oltre 9 m',
        sintesi: 'Un\'ordinanza vieta l\'area urbana di Perugia ai bus più lunghi di 9 m. Per raggiungere il terminal di piazza Partigiani e far salire o scendere il gruppo serve un permesso giornaliero di transito.',
        passi: [
          'Possono chiederlo guide abilitate in Umbria, hotel e ristoranti dell\'area urbana, tour operator e vettori.',
          'Fai la richiesta online sul portale del Comune almeno 5 giorni lavorativi prima, con documento d\'identità, carta di circolazione e targa.',
          'Accettata la richiesta, paga l\'avviso PagoPA che arriva via email.',
          'Stampa il permesso ed esponilo sul cruscotto.',
        ],
        costi: '10 € al giorno dal 1° settembre 2025. Accesso e sosta al terminal di piazza Partigiani si pagano a parte a Busitalia.',
        link: [
          { testo: 'Permessi per bus turistici, Comune di Perugia', url: 'https://www.comune.perugia.it/servizio/permessi-bus-turistici/' },
          { testo: 'Vademecum bus turistici (PDF)', url: 'https://www.comune.perugia.it/wp-content/uploads/2025/10/VademecumBusTuristici.pdf' },
        ],
        affidabilita: 'confermato',
      },
      {
        id: 'bergamo',
        comuni: [{ nome: 'Bergamo', prov: 'BG' }],
        stato: 'limitato',
        titolo: 'Città Alta chiusa ai mezzi lunghi',
        sintesi: 'Secondo ATB, Città Alta è vietata ai veicoli più lunghi di 10,5 m e più alti di 3 m. Per i gruppi in pullman c\'è il servizio Bergamo Easy Access.',
        passi: [
          'Dal 1° novembre 2024 il parcheggio di via Rovelli non è più usato per i pullman: l\'area indicata dal Comune è in via Pietro Spino, aperta tutti i giorni tranne quelli di mercato.',
          'Sali a Città Alta con la funicolare o con il trasferimento in bus di ATB.',
          'Per una discesa veloce dei passeggeri c\'è la piazzola dei bus urbani in viale Vittorio Emanuele II 34.',
        ],
        costi: 'Tariffe della sosta e dei trasferimenti: verifica sul sito ATB. Per salire a Città Alta valgono limiti di 3,5 m di altezza e 10,5 m di lunghezza.',
        link: [{ testo: 'Servizi turistici, ATB Bergamo', url: 'https://atb.bergamo.it/en/other-services/tourist-services' }],
        affidabilita: 'parziale',
      },
      {
        id: 'costiera-amalfitana',
        comuni: ['Positano', 'Praiano', 'Furore', 'Conca dei Marini', 'Amalfi', 'Atrani', 'Ravello', 'Scala', 'Minori', 'Maiori', 'Tramonti', 'Cetara', 'Vietri sul Mare']
          .map((nome) => ({ nome, prov: 'SA' })),
        stato: 'verifica',
        titolo: 'Strada Amalfitana: ordinanze stagionali',
        sintesi: 'La statale 163 Amalfitana è larga circa 7 m, tortuosa e senza alternative. Dal 1° aprile al 30 settembre valgono ordinanze ANAS sulla circolazione, tra cui le targhe alterne in alcuni giorni e fasce orarie. I comuni regolano a pagamento sosta e fermate dei bus.',
        passi: [
          'Prima di inserire la costiera nel viaggio, controlla le ordinanze ANAS in vigore sulla SS163 e le regole per i bus del comune di destinazione.',
          'Chiedi al comune o all\'agenzia locale dove sono le aree di sosta per bus e se vanno prenotate.',
        ],
        link: [{ testo: 'Comune di Amalfi', url: 'https://www.comune.amalfi.sa.it/' }],
        affidabilita: 'parziale',
      },
    ],

    /*
     * Parcheggi, terminal e punti di salita e discesa ufficiali per i bus turistici, raccolti dai siti
     * dei comuni e delle aziende che li gestiscono il 25 ottobre 2026. L'app li mostra quando l'arrivo
     * è entro 15 km. Coordinate da OpenStreetMap; "lungo: true" se l'area occupa un tratto di strada.
     *   tipo: 'sosta' (parcheggio), 'terminal' (parcheggio con check point o servizi), 'discesa' (solo salita e discesa)
     */
    parcheggiVerificati: '2026-10-25',
    fontiParcheggi: {
      roma: { testo: 'Roma Servizi per la Mobilità, aree di sosta per bus turistici', url: 'https://romamobilita.it/servizi-al-pubblico/permessi-a/' },
      firenze: { testo: 'Servizi alla Strada, parcheggi e salite/discese', url: 'https://www.serviziallastrada.it/servizi-al-turista/autorizzazioni-circolazione-e-sosta-autobus/parcheggi-salitediscese' },
      venezia: { testo: 'AVM, ZTL bus e sosta', url: 'https://avm.avmspa.it/it/content/tariffe-ztl-bus-0' },
      milano: { testo: 'Comune di Milano, aree di sosta per bus turistici', url: 'https://www.comune.milano.it/en/servizi/mobilita/aree-di-sosta-per-bus-turistici' },
      napoli: { testo: 'ANM, aree di sosta per bus turistici', url: 'https://www.anm.it/index.php?option=com_content&task=view&id=4084&Itemid=323' },
      verona: { testo: 'AMT3, parcheggi per bus turistici', url: 'https://www.amt3.it/parcheggi-verona/parcheggi-bus-turistici/' },
      siena: { testo: 'Si.Ge.Ri.Co., parcheggio e attracchi dei bus turistici', url: 'https://sigericospa.it/en/tourist-bus-parking-area/' },
      pisa: { testo: 'Pisamo, parcheggio di via Pietrasantina', url: 'https://pisamo.it/2022/11/02/bus-turistici-informativa-rilascio-nulla-osta-ed-autorizzazioni-tpl-anno-2023-parcheggio-pietrasantina/' },
      bologna: { testo: 'Bologna Welcome, Autostazione e accoglienza bus turistici', url: 'https://www.bolognawelcome.com/it/altro/altro/autostazione---accoglienza-bus-turistici' },
      torino: { testo: 'Turismo Torino, con i bus turistici', url: 'https://turismotorino.org/en/visit/plan-your-trip/getting-around/by-tourist-buses' },
      lucca: { testo: 'Comune di Lucca, check point bus turistici', url: 'https://www.comune.lucca.it/punto_contatto/check-point-bus-turistici/' },
      perugia: { testo: 'Comune di Perugia, bus terminal', url: 'https://turismo.comune.perugia.it/pagine/bus-terminal' },
      bergamo: { testo: 'ATB Bergamo, servizi turistici', url: 'https://www.atb.bergamo.it/altri-servizi/servizi-turistici' },
      amalfi: { testo: 'Comune di Amalfi, BusPass', url: 'https://www.comune.amalfi.sa.it/buspass/news.asp?l=1' },
    },
    parcheggi: [
      { citta: 'roma', nome: 'Osteria del Curato (via Vincenzo Giudice)', tipo: 'sosta', lat: 41.843147, lon: 12.588834, nota: 'Sosta lunga, fino a 24 ore, nell\'area attrezzata vicino al nodo Anagnina.' },
      { citta: 'roma', nome: 'Ponte Mammolo (via delle Messi d\'Oro)', tipo: 'sosta', lat: 41.923352, lon: 12.557707, lungo: true, nota: 'Sosta lunga, fino a 24 ore, vicino alla metro B.' },
      { citta: 'roma', nome: 'Laurentina (via Francesco de Suppè)', tipo: 'sosta', lat: 41.825633, lon: 12.481986, nota: 'Sosta lunga, fino a 24 ore, vicino alla metro B.' },
      { citta: 'roma', nome: 'Lungotevere Testaccio', tipo: 'sosta', lat: 41.878324, lon: 12.47084, lungo: true, nota: 'Sosta oraria, fino a 3 ore.' },
      { citta: 'roma', nome: 'Via Caio Cestio', tipo: 'sosta', lat: 41.876282, lon: 12.478973, nota: 'Sosta oraria, fino a 3 ore.' },
      { citta: 'roma', nome: 'Piazzale dei Partigiani', tipo: 'discesa', lat: 41.873683, lon: 12.484525, nota: 'Sosta breve, fino a 15 minuti, per salita e discesa.' },
      { citta: 'roma', nome: 'Via Pinciana', tipo: 'discesa', lat: 41.910486, lon: 12.49009, lungo: true, nota: 'Sosta breve, fino a 15 minuti, per salita e discesa (Villa Borghese).' },

      { citta: 'firenze', nome: 'Piazzale Michelangelo', tipo: 'discesa', lat: 43.762828, lon: 11.264993, nota: 'Salita e discesa a qualsiasi ora, sosta massima 20 minuti. Accesso da viale Galileo e viale Michelangiolo.' },
      { citta: 'firenze', nome: 'Piazza Savonarola', tipo: 'discesa', lat: 43.781843, lon: 11.26707, nota: 'Solo discesa, dalle 8 alle 20, sosta massima 5 minuti: la salita è vietata.' },
      { citta: 'firenze', nome: 'Largo Vincenzo Giudice', tipo: 'discesa', lat: 43.779761, lon: 11.247878, nota: 'Salita e discesa a qualsiasi ora, sosta massima 5 minuti, lato caserma della Guardia di Finanza.' },
      { citta: 'firenze', nome: 'Piazza Vittorio Veneto', tipo: 'discesa', lat: 43.775641, lon: 11.235632, nota: 'Salita e discesa, con itinerari di accesso obbligatori indicati da SAS.' },
      { citta: 'firenze', nome: 'Piazzale Campioni del \'56', tipo: 'sosta', lat: 43.77955, lon: 11.28357, nota: 'Area di sosta per bus a Campo di Marte.' },
      { citta: 'firenze', nome: 'Viale XI Agosto (Guidoni)', tipo: 'sosta', lat: 43.804992, lon: 11.215587, lungo: true, nota: 'Area di sosta per bus vicino alla fermata Guidoni della tramvia T2.' },

      { citta: 'venezia', nome: 'Isola Nova del Tronchetto', tipo: 'sosta', lat: 45.443, lon: 12.30565, nota: 'Parcheggio per bus, collegato a Piazzale Roma dal People Mover. Consigliato in alta stagione.' },
      { citta: 'venezia', nome: 'Piazzale Roma', tipo: 'terminal', lat: 45.438007, lon: 12.318851, nota: 'Terminal dei bus, spesso congestionato in alta stagione.' },

      { citta: 'milano', nome: 'Foro Buonaparte (Castello)', tipo: 'discesa', lat: 45.47269, lon: 9.18125, nota: 'Stalli a rotazione rapida: solo il tempo di salita e discesa.' },
      { citta: 'milano', nome: 'Piazza della Repubblica', tipo: 'discesa', lat: 45.479717, lon: 9.198916, nota: 'Area ai margini della Cerchia dei Bastioni: controlla sull\'elenco del Comune se è a rotazione rapida o a sosta oraria.' },
      { citta: 'milano', nome: 'Bastioni di Porta Venezia', tipo: 'sosta', lat: 45.47546, lon: 9.20195, nota: 'Area ai margini della Cerchia dei Bastioni, a pagamento: controlla orari e posti sull\'elenco del Comune.' },

      { citta: 'napoli', nome: 'Via Nuova Marina', tipo: 'sosta', lat: 40.845228, lon: 14.260908, lungo: true, nota: 'Area di sosta per bus turistici (ordinanza del 2025): si paga online su smartmobility.anm.it.' },
      { citta: 'napoli', nome: 'Viale Anton Dohrn', tipo: 'sosta', lat: 40.83261, lon: 14.230821, lungo: true, nota: 'Area di sosta per bus turistici, vicino alla Villa Comunale: si paga online su smartmobility.anm.it.' },
      { citta: 'napoli', nome: 'Viale Virgilio (Posillipo)', tipo: 'sosta', lat: 40.801869, lon: 14.184044, lungo: true, nota: 'Area di sosta per bus turistici: si paga online su smartmobility.anm.it.' },

      { citta: 'verona', nome: 'Terminal bus del Parcheggio Centro (via Campo Marzo)', tipo: 'terminal', lat: 45.4337, lon: 11.0023, nota: 'Una delle due aree di sosta dentro la ZTL Bus, a pagamento. Serve il pass ZTL Bus.' },
      { citta: 'verona', nome: 'Parcheggio C dello Stadio (via dello Sport)', tipo: 'sosta', lat: 45.434562, lon: 10.965291, nota: 'Sosta compresa nel pass ZTL Bus; qui c\'è anche la cassa automatica del pass.' },

      { citta: 'siena', nome: 'Parcheggio Il Fagiolone', tipo: 'terminal', lat: 43.31569, lon: 11.31651, nota: 'Parcheggio dei bus e check point della ZTL Bus, a pagamento.' },
      { citta: 'siena', nome: 'Attracco di Piazza Amendola (Porta Camollia)', tipo: 'discesa', lat: 43.328184, lon: 11.322164, nota: 'Salita e discesa su prenotazione, massimo 15 minuti, 3 posti.' },

      { citta: 'pisa', nome: 'Parcheggio di via Pietrasantina', tipo: 'terminal', lat: 43.727243, lon: 10.38963, lungo: true, nota: 'Parcheggio dei bus turistici e check point della ZTL Bus, a circa 10 minuti a piedi dalla Torre.' },

      { citta: 'bologna', nome: 'Autostazione (piazza XX Settembre 6)', tipo: 'terminal', lat: 44.5043, lon: 11.3463, nota: 'Sosta a pagamento su prenotazione; salita e discesa fino a 15 minuti. Posti ridotti per lavori: verifica la disponibilità.' },
      { citta: 'bologna', nome: 'Porta San Mamolo', tipo: 'discesa', lat: 44.486962, lon: 11.338394, nota: 'Salita e discesa fino a 20 minuti.' },

      { citta: 'torino', nome: 'Lungo Dora Colletta', tipo: 'sosta', lat: 45.074042, lon: 7.714615, lungo: true, nota: 'Sosta gratuita.' },
      { citta: 'torino', nome: 'Via Ippolito Nievo', tipo: 'sosta', lat: 45.077901, lon: 7.710562, nota: 'Sosta gratuita.' },
      { citta: 'torino', nome: 'Piazza d\'Armi', tipo: 'sosta', lat: 45.043828, lon: 7.652774, nota: 'Sosta gratuita.' },
      { citta: 'torino', nome: 'Viale Primo Maggio (Giardini Reali)', tipo: 'sosta', lat: 45.072143, lon: 7.689974, nota: 'Sosta a pagamento; anche salita e discesa.' },
      { citta: 'torino', nome: 'Viale Boiardo (Torino Esposizioni)', tipo: 'sosta', lat: 45.048147, lon: 7.683465, nota: 'Sosta a pagamento.' },
      { citta: 'torino', nome: 'Piazza Castello (Teatro Regio)', tipo: 'discesa', lat: 45.070592, lon: 7.687956, nota: 'Fermata breve per salita e discesa davanti al Teatro Regio.' },

      { citta: 'lucca', nome: 'Parcheggio Palatucci (via delle Tagliate di Sant\'Anna)', tipo: 'terminal', lat: 43.8369, lon: 10.493684, nota: 'Terminal e check point dei bus turistici; qui il bus aspetta il gruppo.' },
      { citta: 'lucca', nome: 'Piazzale Boccherini', tipo: 'discesa', lat: 43.842166, lon: 10.495279, nota: 'Punto di discesa dei passeggeri.' },
      { citta: 'lucca', nome: 'Porta Elisa', tipo: 'discesa', lat: 43.843095, lon: 10.514089, nota: 'Punto di discesa dei passeggeri.' },

      { citta: 'perugia', nome: 'Pian di Massiano', tipo: 'terminal', lat: 43.10909, lon: 12.3615, nota: 'Parcheggio dei bus turistici, circa 30 posti a pagamento, e partenza del Minimetrò per il centro. Uscita del raccordo: Madonna Alta.' },

      { citta: 'bergamo', nome: 'Via Pietro Spino', tipo: 'sosta', lat: 45.679543, lon: 9.669623, nota: 'Area di sosta per bus turistici, tutti i giorni tranne quelli di mercato.' },
      { citta: 'bergamo', nome: 'Viale Vittorio Emanuele II 34', tipo: 'discesa', lat: 45.698961, lon: 9.664991, nota: 'Fermata dei bus urbani: solo il tempo di far scendere i passeggeri.' },

      { citta: 'amalfi', nome: 'Area Flavio Gioia (Amalfi)', tipo: 'discesa', lat: 40.633808, lon: 14.602779, nota: 'Carico e scarico su prenotazione obbligatoria (BusPass); vietato ai bus oltre 10,36 m.' },
    ],
  };
})(typeof self !== 'undefined' ? self : this);
