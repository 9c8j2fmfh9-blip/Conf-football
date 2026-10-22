# CONF Football

Applicazione mobile e desktop per consultare le partite future, le stime dei mercati gol, lo storico disponibile e le quote verificate. Sito: https://conf-football.onrender.com/

## Funzioni operative

- Calendario Diretta con finestre 3h, 12h, 24h e ricerca per squadra, competizione o data.
- Una scheda per partita, ordinamento per percentuale oppure data e ora, filtro di selezione al 60% e preferiti locali.
- Analisi di GG, Over 2.5, risultato e mercati aggiuntivi quando esistono dati sufficienti; i mercati mancanti restano dichiarati non disponibili.
- Quote Sisal dal foglio ufficiale e quote bookmaker di riferimento da ESPN. Ogni quota è abbinata al mercato, alle squadre e all'orario; le fonti hanno un limite di validità.
- Bozze sperimentali con obiettivi quota 10 e 100, solo partite future della giornata corrente con calcio d’inizio entro le 21:30 comprese in Europe/Rome, massimo 16 partite e un solo bookmaker per bozza. Nessuna quota viene inventata per raggiungere l'obiettivo. Quando non ci sono combinazioni supportate, l'app lo dichiara.
- Alternative gol + corner totali separate, senza inventare quote MyCombo o probabilità congiunte.
- Aggiornamento della pagina ogni minuto mentre è visibile e alla riapertura da smartphone.

## Avvio e controlli

Richiede Node.js 24. Eseguire `npm ci`, poi `npm start`. Il provider predefinito non richiede chiavi. Configurare `CONF_PROVIDER=openfoot` e `OPENFOOT_API_KEY` soltanto se si usa il provider opzionale. Le chiavi restano nelle variabili del servizio, mai nel repository.

`npm test` esegue le regressioni. `node scripts/smoke-app.js` avvia il server e verifica la pagina, il selettore e gli audit storici. GitHub Actions esegue anche i confronti cronologici dei modelli e della calibrazione.

## Verifica prospettica automatica

Il workflow `.github/workflows/conf-archive.yml` è pianificato ogni ora al minuto 17; GitHub può ritardarne l'esecuzione. Il ramo `conf-forecast-archive` conserva le previsioni immutabili e il report aggiornato. La raccolta non dipende dall'apertura della chat o dell'app.

Le previsioni devono precedere il calcio d'inizio di almeno cinque minuti. Il confronto usa la prima stima disponibile per partita e versione, identificativi esatti del calendario, squadre e orario coerenti e soli risultati nei tempi regolamentari confermati. Le partite senza esito o identificativo verificabile rimangono in attesa. I risultati già acquisiti sono conservati anche dopo l'uscita dalla finestra di sette giorni del feed.

La raccolta e la valutazione sono distinte: un problema nella nuova raccolta non impedisce di aggiornare gli esiti già archiviati, ma il workflow segnala comunque l'errore. L'app mostra data dell'ultima verifica, registrazioni, esiti confermati, attese e ritardi.

Endpoint principali:

- `/api/health`: versione e commit pubblicato.
- `/api/conf`: calendario e analisi per `hours`, `date` e `q`.
- `/api/proposal-odds`: quote per le singole proposte.
- `/api/daily-multiples`: bozze sperimentali e alternative.
- `/api/forecast-validation`: riepilogo del confronto su nuove partite.
- `/api/conf-validation`, `/api/conf-calibration`, `/api/conf-backtest`: audit retrospettivi e confronti di calibrazione.

## Limiti verificabili

L'operatività dell'app e l'affidabilità statistica sono due verifiche diverse. Le stime Poisson e le frequenze storiche non sono probabilità di vincita certificate. `validated` e `productionBettingApproved` restano `false`; le bozze non moltiplicano percentuali per dichiarare una probabilità della multipla. Il confronto retrospettivo non dimostra un rendimento futuro. Mancano ancora un campione prospettico ampio e una verifica economica con quote effettivamente disponibili al momento della previsione.

Il calendario può essere più ampio degli storici. Alcune categorie, xG e mercati corner non hanno dati utilizzabili. I preferiti sono locali al browser; la sincronizzazione opzionale dello storico richiede la configurazione Supabase già supportata. Nessuna puntata viene eseguita dall'app.

## Ricerca sugli avversari e integrità del confronto

`node scripts/audit-opponents.js` confronta sei candidati Poisson con rating di attacco/difesa e forza degli avversari con il modello attuale, mantenendo separati i periodi di scelta e confronto. `opponent-model-report.json` conserva il risultato riproducibile e l’impronta del dataset: nessun candidato ha superato la scelta sul periodo intermedio, quindi il modello live resta invariato. Il confronto si ripete nella CI.

La raccolta usa un identificativo derivato dai sorgenti del calcolo, indipendente dai soli aggiornamenti di interfaccia. Il commit del deploy resta archiviato separatamente. Gli esiti prospettici confrontano modello e frequenza storica registrata prima della partita sulle stesse osservazioni; senza baseline disponibile il confronto rimane nullo, non ricostruito dopo il risultato.
