# Pieno Giusto

Mappa di tutti i distributori d'Italia con i prezzi di benzina, gasolio, GPL e metano
e l'ultima variazione di ogni prezzo (▲ in aumento, ▼ in calo). Si aggiorna da sola ogni giorno.

> "Pieno Giusto" è un nome provvisorio: cambiatelo quando volete (titolo in `docs/index.html`).

## Come funziona

```
Ministero (MIMIT)  ──►  scripts/scarica.py  ──►  data/raw/  (storico, un file al giorno)
                                                     │
                                                     ▼
                       scripts/elabora.py   ──►  docs/data/*.json  ──►  docs/index.html (mappa)
```

- **scarica.py**: prende i due file del giorno dal Ministero e salva i prezzi in `data/raw/AAAA/MM/`.
  Se il sito del Ministero è giù, usa l'archivio pubblico di riserva.
- **elabora.py**: unisce distributori e prezzi, scarta gli errori evidenti e calcola per ogni prezzo
  di quanto è cambiato rispetto al valore precedente e da quando. Produce `impianti.json`, `medie.json`
  e `storico/XX.json` (per provincia: i cambi di prezzo di ogni distributore negli ultimi 30 giorni, per il grafico nella scheda).
- **importa_storico.py**: importa i giorni passati dall'archivio pubblico `LucaDDDD/benzina-data`.
  Serve solo all'inizio (lo zip contiene già gli ultimi 20 giorni).
- **.github/workflows/aggiorna.yml**: GitHub esegue i due script ogni mattina e salva il risultato.
- **docs/index.html**: la mappa (Leaflet + OpenStreetMap), un solo file.

Serve solo Python 3.10+, nessuna libreria da installare.

## Messa online (una volta sola, 10 minuti)

1. Su GitHub crea un repository nuovo, per esempio `pieno-giusto` (pubblico, per usare Pages gratis).
2. Estrai lo zip e carica tutto il contenuto nel repository:
   ```
   cd pieno-giusto
   git init && git add . && git commit -m "Prima versione"
   git branch -M main
   git remote add origin https://github.com/TUO-UTENTE/pieno-giusto.git
   git push -u origin main
   ```
3. **Settings → Pages**: Source "Deploy from a branch", branch `main`, cartella `/docs`. Salva.
   Dopo un paio di minuti il sito è su `https://TUO-UTENTE.github.io/pieno-giusto/`.
4. **Settings → Actions → General → Workflow permissions**: seleziona "Read and write permissions".
   Serve per permettere all'aggiornamento automatico di salvare i dati.
5. **Actions → Aggiorna prezzi carburanti → Run workflow**: lo lanci a mano una volta per verificare
   che funzioni. Da lì in poi parte da solo ogni ora dalle 8:10 alle 20:10 e salva solo quando ci sono dati nuovi.

## Provarlo sul computer

```
python scripts/elabora.py              # rigenera i JSON dallo storico
cd docs && python -m http.server 8000  # poi apri http://localhost:8000
```
(Aprire `index.html` con doppio clic non funziona: il browser blocca la lettura dei JSON.)

## Scelte sui dati

- Benzina e gasolio: prezzo **self**; GPL e metano: prezzo **servito** (come fa il Ministero per le medie).
- Prezzi più vecchi di 30 giorni non compaiono; per le medie si usano solo quelli degli ultimi 8 giorni,
  esclusi gli impianti autostradali.
- Valori sotto il 60% o sopra il 160% della mediana nazionale vengono scartati come errori di battitura.
- **Prezzi da verificare**: se un prezzo è più basso del 15% rispetto alla mediana della sua provincia
  (spesso è un listino vecchio che il gestore continua a ri-comunicare) o non viene aggiornato da più di 8 giorni,
  sulla mappa compare tratteggiato con "?", non entra nella classifica né nel prezzo minimo dei gruppi,
  e la scheda del distributore spiega il motivo.
- **Tendenza**: per ogni provincia e carburante si confronta la media di oggi con quella di 3 giorni fa.
  Se si è mossa di almeno mezzo centesimo la tendenza è "in aumento" o "in calo", altrimenti "stabile".
  Ogni giorno `elabora.py` verifica sullo storico quante volte la direzione degli ultimi 3 giorni
  si è confermata nei 3 successivi e pubblica la percentuale (all'avvio: 87% su 2.591 casi, 20 giorni di dati).
  Non è una previsione con modello: sbaglia quando i prezzi cambiano direzione.
- Sulla mappa il bordo verde indica il 25% dei distributori più economici d'Italia, quello rosso il 25% più caro.

## Prossimi passi

- [ ] Grafico dell'andamento dei prezzi (i dati sono già in `medie.json`)
- [ ] Pagina di iscrizione email per la versione premium
- [ ] Previsione dei prezzi (serve qualche settimana di storico in più)
- [ ] Quando lo storico supera ~500 MB, spostarlo in un database (es. Supabase)

## Licenza dei dati

Dati del Ministero delle Imprese e del Made in Italy — Osservatorio Prezzi Carburanti,
licenza IODL 2.0. Mappe © OpenStreetMap contributors.
