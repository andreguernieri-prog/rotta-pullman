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
          'Parcheggia nell\'area per pullman di via Rovelli (Bergamo Easy Access, gestita da ATB), vicino alla funicolare.',
          'Sali a Città Alta con la funicolare o con il trasferimento in bus di ATB.',
          'Per una discesa veloce dei passeggeri c\'è la piazzola dei bus urbani in viale Vittorio Emanuele II 34.',
        ],
        costi: 'Sosta in via Rovelli: circa 40 € fino a 4 ore, 70 € oltre.',
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
  };
})(typeof self !== 'undefined' ? self : this);
