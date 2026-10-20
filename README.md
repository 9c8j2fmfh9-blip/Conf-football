# CONF Football — candidate 0.4

Versione isolata per revisione: non sostituisce il servizio Render esistente.

- Schede semplici con GG, Over 2.5, corner e percentuali storiche.
- Filtro 70% coerente con i mercati visibili, compresi i corner FT.
- Analisi di tutte le gare scoperte prima del limite di visualizzazione, con paginazione del calendario fino a 10 pagine per richiesta.
- Solo gare future: gli stati live, finiti, rinviati e cancellati sono esclusi.
- Risultati successivi alla data di analisi esclusi; corner totali deduplicati.
- Modello Poisson regolarizzato condiviso da previsione e backtest. Nessun modello esterno copiato.
- File server e dataset non esposti dal web server.

## Avvio e verifiche

Node 24; `npm install`, `npm test`, `npm run check`, `npm run backtest`, `npm start`.
Variabili server: `OPENFOOT_API_KEY`; opzionale `API_FOOTBALL_KEY` per corner per tempo.
Le chiavi devono restare nelle variabili ambiente del servizio, mai nel repository.

`GET /api/conf-backtest` restituisce Brier, baseline progressiva, calibrazione e conteggio delle stime ≥70%, separati per campionato e mercato. `backtest-report.json` conserva il risultato del controllo locale.

## Esito della verifica del 20 ottobre 2026

9 test superati, compreso un calendario simulato di 45 gare con paginazione, duplicati e una live. Questi test verificano il software, non l'accuratezza sportiva.

371 risultati locali, 151 partite valutabili cronologicamente (302 valutazioni di mercato). Il modello supera la baseline progressiva per GG/Over in League One e League Two, ma non in Championship. Nessuna previsione del campione arriva al 70%. Il campione non dimostra un sistema affidabile di giocate ≥70%.

La richiesta live al provider OpenFootAPI con token pubblico di anteprima restituisce dati; la richiesta senza autenticazione restituisce 401. Dopo il collegamento Render, il controllo /api/key-check del servizio corrente conferma: chiave personale configurata, risposta HTTP 429, quota mensile di 5.000 richieste esaurita. L'anteprima pubblica è disponibile ma parziale e non sostituisce l'accesso personale. Non è stata letta né copiata alcuna chiave privata.

La fonte dichiarata nei dataset locali `oladeeayo/open-matchday`, al percorso `data/ENG_3_league-one/results_2627.csv`, restituisce 404 al controllo: la provenienza dei dati locali non è stata riconfermata. I risultati del backtest sono quindi provvisori. Non usare queste frequenze come probabilità di vincita certificate.

Prima della messa in produzione occorre verificare calendario, storico e copertura tramite il provider autenticato del servizio attuale e ripetere il test su dati di provenienza confermata. I corner per tempo restano assenti quando il piano non li fornisce: non vengono ricostruiti dai totali FT.

La branch principale e la configurazione Render restano intatte.
