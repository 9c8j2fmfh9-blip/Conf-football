# CONF Football v0.2 — starter kit

Questo pacchetto contiene il prototipo web, più un piccolo server che può interrogare API-Football mantenendo la chiave API lato server.

## Cosa è pronto
- Interfaccia responsive per testare filtri CONF e mercati (i dati nell'interfaccia sono ancora dimostrativi).
- Server Express con proxy per calendario, campionati, statistiche di una partita e quote.
- Cache in memoria di 10 minuti per limitare le richieste API.
- Chiave API tenuta in `.env`, mai nel JavaScript del browser.

## Avvio locale
1. Installa Node.js LTS dal sito ufficiale.
2. Apri un terminale nella cartella `conf_football_v02`.
3. Esegui `npm install`.
4. Copia `.env.example` in un file chiamato `.env`.
5. Inserisci la tua chiave nel valore `API_FOOTBALL_KEY` dentro `.env`.
6. Esegui `npm start` e apri `http://localhost:3000`.
7. Per verificare il server, apri `http://localhost:3000/api/status`.

## Endpoint disponibili
- `GET /api/health`
- `GET /api/status`
- `GET /api/leagues`
- `GET /api/fixtures?date=2026-10-19`
- `GET /api/fixtures?league=39&season=2026`
- `GET /api/fixture-statistics?fixture=ID_PARTITA`
- `GET /api/odds?fixture=ID_PARTITA`

Gli ID e le stagioni sono esempi: prima di usare una richiesta, verifica quelli disponibili nel provider e le date/competizioni corrette.

## Regole sicurezza
- Non inviare la chiave API in chat, screenshot, repository o file HTML.
- Non pubblicare `.env`. Il file è escluso da `.gitignore`.
- Per una versione online, usare un backend/serverless con segreti configurati nelle impostazioni del servizio. GitHub Pages da solo non può eseguire `server.js` e non è adatto a custodire chiavi API.

## Nota importante sul CONF
Il numero CONF non è ancora calibrato e non rappresenta una probabilità reale. Prima di pubblicare pronostici automatici bisogna collegare i dati, costruire le stime per GG / Over 2.5 / Over 1.5 HT / corner e valutarle su partite storiche non usate per allenare il modello. I dati demo dell'interfaccia non vanno usati per scommettere.
