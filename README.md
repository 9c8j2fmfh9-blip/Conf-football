# CONF Football 0.6 — gratuito

Candidata separata dalla versione di produzione. Nessuna chiave, carta, abbonamento o provider a pagamento è richiesto. Non usa OpenFootAPI né la sua quota esaurita.

## Funzioni

- GG, Over 2.5 e corner FT su schede responsive con cerchi percentuali.
- Elenco automatico delle prossime 3, 12 o 24 ore; ricerca per squadra/campionato e data italiana su tutti i calendari consultati, prima del limite di visualizzazione.
- Solo partite future con stato esplicitamente programmato; escluse live, terminate, rinviate e orari incerti.
- Indicazione del modello in cima alla scheda, distinta dalla frequenza storica. La dicitura «consigliata» richiede stima non arrotondata ≥70%; il modello resta sperimentale.
- Corner FT ricavati dal campo esplicito `wonCorners` dei riepiloghi delle gare terminate. Prime tre schede analizzate automaticamente; altre su richiesta, per contenere il traffico gratuito. I corner per tempo non vengono inventati.
- Preferiti locali sul dispositivo. Nessuna registrazione manuale vinta/persa.

## Fonti e copertura

Calendario e statistiche: endpoint JSON pubblici ESPN, senza autenticazione. 25 competizioni elencate in `free-data.js`, incluse Champions League, League One, League Two e FA Cup. Non è promessa la copertura di ogni campionato o mercato. Non esiste una garanzia di servizio o di continuità per questi endpoint; gli errori delle fonti sono visibili.

Le richieste concorrenti sono limitate a quattro; cache calendario 5 minuti, storico squadre 1 ora, riepiloghi FT 24 ore. Le richieste identiche simultanee sono riunite. Nessuna richiesta usa o aggira le credenziali/quota OpenFootAPI.

Lo storico delle previsioni è solo della stagione corrente dal 1° luglio e precedente all'istante di analisi, con le ultime 10 gare per squadra e almeno 6 per entrambe. Le gare a supplementari/rigori sono escluse, per non confonderle con i 90 minuti. Nelle competizioni europee il calendario squadra ESPN `all` include anche la forma domestica; il modello non corregge per la forza del campionato.

Benchmark del modello: OpenFootball 2025/26, acquisito direttamente dalla fonte GitHub pubblica, licenza CC0-1.0. La stagione precedente è usata **solo nel test**, non nelle previsioni correnti. URL e data di acquisizione sono nel file `openfootball-benchmark.json`. Non vengono più utilizzati i vecchi dataset di provenienza non riconfermata.

## Test e limiti predittivi

`npm test`: 18 test automatici, inclusi calendario di 45 gare prima del limite, ricerca oltre le card visibili, esclusione delle live e dei risultati futuri, deduplica, corner mancanti/zero, cache e interazioni DOM della UI.

`npm run backtest`: walk-forward cronologico su OpenFootball, baseline progressiva basata esclusivamente sulle date precedenti, Brier e calibrazione per lega/mercato; esportazione in `backtest-report.json`. Disponibile anche da interfaccia e `/api/conf-backtest`.

Esito: 2255 partite valutabili nella stagione 2025/26. Il modello NON supera stabilmente la baseline su tutte le leghe. Le rare selezioni ≥70% non hanno un campione sufficiente per dimostrare affidabilità. Il benchmark è su una fonte diversa dalle schede ESPN: non costituisce una validazione del flusso live. I corner sono frequenze, non probabilità calibrate, e non hanno un backtest predittivo. Nessuna promessa di vincita o redditività; quote e convenienza economica non sono valutate.

Verifica live locale 20/10/2026: 33 partite future analizzate su 25/25 competizioni consultate, dati GG/Over disponibili; Paris Saint-Germain–Barcelona con 8 gare corner per squadra, ricavate dalle statistiche reali del provider. Questi sono risultati puntuali, non un minimo di partite garantito.

## Avvio

Node 24. `npm ci --include=dev`, `npm test`, `npm run check`, `npm start`.
Variabile opzionale: `PORT` (default 3000). Nessun segreto richiesto.

Il server espone solo HTML e API, non codice server o dataset. I preferiti non si sincronizzano tra dispositivi in questa versione: sono salvati in `localStorage`.

## Separazione dalla produzione

Branch: `codex/conf-v04-validation`, PR #1. Il servizio originale collegato a `main` resta intatto. La candidata è destinata a un servizio Render separato con piano esplicitamente `free`, senza modifica delle variabili del servizio originale.


## Forma e contesto di classifica — 0.6

Ogni scheda include una sezione «Forma casa/trasferta e classifica» con:
- risultati e punti nelle ultime 5 gare;
- fino a 6 precedenti nel campo pertinente (casa/trasferta), gol fatti e subiti;
- posizione, punti e gare giocate nella classifica corrente della competizione;
- distanza in punti dalla squadra sul confine di una zona segnalata dalla fonte (salvezza/promozione/qualificazione), quando disponibile;
- giorni trascorsi tra l'ultima gara completata e la partita analizzata.

Le zone derivano dalle note della classifica ESPN, senza imporre a tutti i campionati lo stesso regolamento. I distacchi non certificano salvezza o qualificazione matematica: partite da recuperare, spareggi e penalizzazioni possono incidere. Classifiche assenti sono dichiarate tali. Non viene dedotta una motivazione psicologica dai punti e non vengono inventate indisponibilità, turnover o giornate residue quando non verificabili.

È stata verificata una variante prefissata del modello con pesi di recenza 0,9 e una componente casa/trasferta regolarizzata. Confronto temporale: 1.150 gare prima del 01/02/2026 e 1.105 da quella data in poi. La variante non migliora il Brier di GG o Over nei due periodi: non è stata attivata. La forma e la classifica arricchiscono la consultazione; le percentuali non sono state aumentate artificialmente. Dettaglio riproducibile in `npm run compare` e `model-comparison.json`, visibile anche nel test storico dell'interfaccia. La dicitura «giocata consigliata» è stata sostituita da «indicazione».
