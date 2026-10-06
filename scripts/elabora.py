"""Unisce anagrafica e prezzi e produce i JSON per la mappa.

Per ogni distributore e carburante calcola:
- il prezzo attuale (self per benzina/gasolio, servito per GPL/metano, come il MIMIT)
- l'ultima variazione: di quanto è cambiato rispetto al prezzo precedente e da quando

Output:
- docs/data/impianti.json  → distributori con prezzi e variazioni
- docs/data/medie.json     → medie nazionali e provinciali, andamento storico,
                             tendenza (su/giù/stabile) per provincia e quanto si è rivelata affidabile
- docs/data/celle/LAT_LON.json → gli stessi distributori divisi in celle da 0,5° (caricamento rapido)
- docs/data/storico/XX.json → per provincia, i cambi di prezzo di ogni distributore negli ultimi 30 giorni
Uso: python scripts/elabora.py
"""
import json
import math
import sys
from collections import defaultdict
from datetime import date, datetime

from comune import (RAW, SITE_DATA, giorni_archiviati, leggi_csv, leggi_gz,
                    percorso_prezzi)

CARBURANTI = {"Benzina": "benzina", "Gasolio": "gasolio", "GPL": "gpl", "Metano": "metano"}
PREFERISCI_SELF = {"benzina": True, "gasolio": True, "gpl": False, "metano": False}
PREZZO_MIN, PREZZO_MAX = 0.3, 4.5   # fuori da qui è un errore di battitura
MAX_GIORNI_MAPPA = 30               # prezzi più vecchi non si mostrano
MAX_GIORNI_MEDIA = 8                # come il MIMIT per le medie
GIORNI_STORICO = 15                 # quanti giorni guardare indietro per le variazioni
SOGLIA_SOSPETTO = 0.15              # 15% sotto la mediana provinciale = da verificare
MIN_IMPIANTI_MEDIANA = 10           # sotto questo numero uso la mediana nazionale
GIORNI_ANDAMENTO = 90               # lunghezza della serie delle medie nazionali
GIORNI_TENDENZA = 3                 # la tendenza guarda gli ultimi 3 giorni...
SOGLIA_TENDENZA = 0.005             # ...e conta solo se la media si è mossa di almeno mezzo centesimo
ORIZZONTE_DOPO = 5                  # quanti giorni dopo la tendenza si guarda per dire "quando" e "quanto"
GIORNI_SERIE_ZONA = 14              # giorni del grafico della zona nel pannello
GIORNI_PUNTO = 30                   # storico del singolo distributore mostrato nella scheda


def prezzi_del_giorno(giorno: str):
    """{(id, carburante): (prezzo, data_comunicazione)} scegliendo self/servito."""
    scelti = {}  # (id, carb) -> (priorità, dt, prezzo)
    for r in leggi_csv(leggi_gz(percorso_prezzi(giorno))):
        carb = CARBURANTI.get(r.get("descCarburante", ""))
        if not carb:
            continue
        try:
            prezzo = float(r["prezzo"])
            dt = datetime.strptime(r["dtComu"], "%d/%m/%Y %H:%M:%S")
        except (KeyError, ValueError):
            continue
        if not PREZZO_MIN <= prezzo <= PREZZO_MAX:
            continue
        self_ = r.get("isSelf") == "1"
        prio = 1 if self_ == PREFERISCI_SELF[carb] else 0
        chiave = (r["idImpianto"], carb)
        vecchio = scelti.get(chiave)
        if vecchio is None or (prio, dt) > (vecchio[0], vecchio[1]):
            scelti[chiave] = (prio, dt, prezzo)
    return {k: (v[2], v[1]) for k, v in scelti.items()}


def pulisci(prezzi):
    """Scarta i valori lontanissimi dalla mediana del carburante (errori di battitura)."""
    per_carb = defaultdict(list)
    for (_, carb), (p, _) in prezzi.items():
        per_carb[carb].append(p)
    mediane = {c: sorted(v)[len(v) // 2] for c, v in per_carb.items()}
    return {k: v for k, v in prezzi.items()
            if 0.6 * mediane[k[1]] <= v[0] <= 1.6 * mediane[k[1]]}


def main():
    giorni = giorni_archiviati()
    if not giorni:
        sys.exit("Archivio vuoto: esegui prima scarica.py o importa_storico.py")
    oggi = giorni[0]
    oggi_d = date.fromisoformat(oggi)
    print(f"Ultima estrazione: {oggi} ({len(giorni)} giorni in archivio)")

    storico = [pulisci(prezzi_del_giorno(g)) for g in giorni[:GIORNI_STORICO]]
    attuali = storico[0]

    # --- variazioni: risalgo i giorni finché il prezzo era diverso ---
    variazioni = {}
    for chiave, (prezzo, _) in attuali.items():
        dal = oggi
        for g, giorno_prezzi in zip(giorni[1:], storico[1:]):
            prima = giorno_prezzi.get(chiave)
            if prima is None:
                break
            if abs(prima[0] - prezzo) > 0.0005:
                variazioni[chiave] = (round(prezzo - prima[0], 3), dal)
                break
            dal = g

    # --- anagrafica + prezzi ---
    impianti = []
    prov_di = {}   # id impianto -> provincia (solo impianti stradali)
    per_provincia = defaultdict(lambda: defaultdict(list))
    for r in leggi_csv(leggi_gz(RAW / "anagrafica.csv.gz")):
        try:
            lat, lon = float(r["Latitudine"]), float(r["Longitudine"])
        except (KeyError, ValueError):
            continue
        if not (35 <= lat <= 48 and 6 <= lon <= 19):  # fuori dall'Italia = coordinate errate
            continue
        pid = r["idImpianto"]
        if r["Tipo Impianto"] != "Autostradale":
            prov_di[pid] = r["Provincia"]
        prezzi = {}
        for carb in CARBURANTI.values():
            v = attuali.get((pid, carb))
            if not v:
                continue
            prezzo, dt = v
            eta = (oggi_d - dt.date()).days
            if eta > MAX_GIORNI_MAPPA:
                continue
            delta, dal = variazioni.get((pid, carb), (0, None))
            # [prezzo, variazione €, data variazione (o null), data comunicazione, sospetto 0/1]
            prezzi[carb] = [prezzo, delta, dal, dt.strftime("%Y-%m-%d")]
            if eta <= MAX_GIORNI_MEDIA and r["Tipo Impianto"] != "Autostradale":
                per_provincia[r["Provincia"]][carb].append(prezzo)
        if not prezzi:
            continue
        nome = " ".join(r["Nome Impianto"].split()) or r["Bandiera"]
        impianti.append([int(pid), nome, r["Bandiera"], " ".join(r["Indirizzo"].split()),
                         r["Comune"].title(), r["Provincia"], round(lat, 5), round(lon, 5),
                         1 if r["Tipo Impianto"] == "Autostradale" else 0, prezzi])

    # --- prezzi sospetti: molto sotto la mediana della provincia ---
    # Spesso sono listini vecchi che il gestore continua a ri-comunicare.
    # Restano visibili nella scheda, ma non entrano in classifiche e minimi.
    mediane = {}
    for prov, carb_valori in per_provincia.items():
        for carb, valori in carb_valori.items():
            if len(valori) >= MIN_IMPIANTI_MEDIANA:
                mediane[(prov, carb)] = sorted(valori)[len(valori) // 2]
    nazionali = {c: sorted(v)[len(v) // 2] for c, v in
                 ((c, [p for pc in per_provincia.values() for p in pc.get(c, [])])
                  for c in CARBURANTI.values()) if v}
    sospetti = 0
    for imp in impianti:
        for carb, dati in imp[9].items():
            rif = mediane.get((imp[5], carb), nazionali.get(carb))
            flag = 1 if rif and dati[0] < rif * (1 - SOGLIA_SOSPETTO) else 0
            dati.append(flag)
            sospetti += flag
    print(f"Prezzi segnati come da verificare: {sospetti}")

    SITE_DATA.mkdir(parents=True, exist_ok=True)
    with open(SITE_DATA / "impianti.json", "w", encoding="utf-8") as f:
        json.dump({"aggiornato": oggi,
                   "campi": ["id", "nome", "bandiera", "indirizzo", "comune", "provincia",
                             "lat", "lon", "autostrada", "prezzi"],
                   "impianti": impianti}, f, ensure_ascii=False, separators=(",", ":"))

    scrivi_celle(impianti, oggi)

    # --- medie: provinciali di oggi + andamento nazionale ---
    def media(valori):
        return round(sum(valori) / len(valori), 3) if valori else None

    province = {p: {c: media(v) for c, v in carb.items()} for p, carb in per_provincia.items()}

    andamento = []
    per_giorno = {}             # giorno -> prezzi, per lo storico dei singoli distributori
    serie = defaultdict(dict)   # (provincia o "IT", carburante) -> {giorno: media}
    for g in reversed(giorni[:GIORNI_ANDAMENTO]):
        gp = storico[giorni.index(g)] if giorni.index(g) < len(storico) else pulisci(prezzi_del_giorno(g))
        if g in giorni[:GIORNI_PUNTO]:
            per_giorno[g] = gp
        gd = date.fromisoformat(g)
        acc = defaultdict(list)
        acc_prov = defaultdict(list)
        for (pid, carb), (prezzo, dt) in gp.items():
            if (gd - dt.date()).days <= MAX_GIORNI_MEDIA:
                acc[carb].append(prezzo)
                if pid in prov_di:
                    acc_prov[(prov_di[pid], carb)].append(prezzo)
        andamento.append({"giorno": g, **{c: media(v) for c, v in acc.items()}})
        for c, v in acc.items():
            serie[("IT", c)][g] = sum(v) / len(v)
        for k, v in acc_prov.items():
            if len(v) >= MIN_IMPIANTI_MEDIANA:
                serie[k][g] = sum(v) / len(v)

    # --- tendenza: dove si sono mosse le medie negli ultimi giorni ---
    cronologia = list(reversed(giorni[:GIORNI_ANDAMENTO]))   # dal più vecchio

    def direzione(delta):
        return "su" if delta >= SOGLIA_TENDENZA else "giu" if delta <= -SOGLIA_TENDENZA else "stabile"

    tendenze = defaultdict(dict)
    if len(cronologia) > GIORNI_TENDENZA:
        g0, g_ieri = cronologia[-1 - GIORNI_TENDENZA], cronologia[-2]
        for (zona, carb), s_z in serie.items():
            if oggi in s_z and g0 in s_z:
                d3 = s_z[oggi] - s_z[g0]
                d1 = s_z[oggi] - s_z[g_ieri] if g_ieri in s_z else 0
                tendenze[zona][carb] = [round(s_z[oggi], 3), round(d1, 4), round(d3, 4), direzione(d3)]

    # --- affidabilità: nel passato, la direzione degli ultimi 3 giorni
    #     si è confermata nei 3 giorni successivi? ---
    giusti = casi = 0
    L = H = GIORNI_TENDENZA
    for s_z in serie.values():
        for i in range(L, len(cronologia) - H):
            a, b, c = cronologia[i - L], cronologia[i], cronologia[i + H]
            if a in s_z and b in s_z and c in s_z:
                prima, dopo = s_z[b] - s_z[a], s_z[c] - s_z[b]
                if abs(prima) >= SOGLIA_TENDENZA and abs(dopo) >= 0.001:
                    casi += 1
                    giusti += (prima > 0) == (dopo > 0)
    affidabilita = {"percentuale": round(100 * giusti / casi) if casi else None,
                    "casi": casi, "giorni": len(cronologia), "orizzonte": H}
    print(f"Tendenza: confermata {giusti}/{casi} volte ({affidabilita['percentuale']}%)")

    # --- dopo la tendenza: cosa è successo di solito nei giorni successivi? ---
    # Per ogni zona e giorno in cui la tendenza era "giu" o "su", la variazione media della media di zona
    # dopo 1..5 giorni. Da qui: quando conviene (il giorno in cui si raggiunge quasi tutto il calo) e quanto.
    dopo = {"giu": [[] for _ in range(ORIZZONTE_DOPO)], "su": [[] for _ in range(ORIZZONTE_DOPO)]}
    casi_dopo = {"giu": 0, "su": 0}
    forza = {"giu": [], "su": []}   # quanto si era mosso nei 3 giorni prima: serve a scalare l'attesa sul caso di oggi
    for s_z in serie.values():
        for i in range(GIORNI_TENDENZA, len(cronologia) - ORIZZONTE_DOPO):
            g = [cronologia[i + h] for h in range(-GIORNI_TENDENZA, ORIZZONTE_DOPO + 1)]
            if any(x not in s_z for x in g):
                continue
            d3 = s_z[cronologia[i]] - s_z[cronologia[i - GIORNI_TENDENZA]]
            verso = "giu" if d3 <= -SOGLIA_TENDENZA else "su" if d3 >= SOGLIA_TENDENZA else None
            if not verso:
                continue
            casi_dopo[verso] += 1
            forza[verso].append(abs(d3))
            for h in range(1, ORIZZONTE_DOPO + 1):
                dopo[verso][h - 1].append(s_z[cronologia[i + h]] - s_z[cronologia[i]])
    dopo_tendenza = {}
    for verso, liste in dopo.items():
        if casi_dopo[verso] < 30:
            continue
        medie_h = [sum(l) / len(l) for l in liste]
        estremo = min(medie_h) if verso == "giu" else max(medie_h)
        # il "giorno migliore": il primo in cui si è già visto l'80% della variazione massima
        giorno = next(h + 1 for h, v in enumerate(medie_h) if abs(v) >= .8 * abs(estremo))
        dopo_tendenza[verso] = {"variazione": [round(v, 4) for v in medie_h], "giorno": giorno,
                                "attesa": round(abs(medie_h[giorno - 1]), 4), "casi": casi_dopo[verso],
                                "d3_medio": round(sum(forza[verso]) / len(forza[verso]), 4)}
    print(f"Dopo la tendenza: {dopo_tendenza}")

    # --- andamento recente per zona (Italia e province): serve al grafico "come si muovono i prezzi qui" ---
    ultimi = cronologia[-GIORNI_SERIE_ZONA:]
    serie_zone = defaultdict(dict)
    for (zona, carb), s_z in serie.items():
        valori = [round(s_z[g], 3) if g in s_z else None for g in ultimi]
        if sum(v is not None for v in valori) >= 5:
            serie_zone[zona][carb] = valori

    with open(SITE_DATA / "medie.json", "w", encoding="utf-8") as f:
        json.dump({"aggiornato": oggi, "nazionale": andamento, "province": province,
                   "tendenze": tendenze, "affidabilita": affidabilita,
                   "giorni_serie": ultimi, "serie_zone": serie_zone,
                   "dopo_tendenza": dopo_tendenza, "giorni_dati": len(cronologia)},
                  f, ensure_ascii=False, separators=(",", ":"))

    scrivi_storico(impianti, per_giorno)

    cambiati = sum(1 for d, _ in variazioni.values() if d)
    print(f"Scritti {len(impianti)} distributori, {cambiati} prezzi con variazione registrata.")


PASSO_CELLA = 0.5   # gradi: celle di circa 55 x 40 km


def chiave_cella(lat, lon):
    return f"{math.floor(lat / PASSO_CELLA) * PASSO_CELLA:.1f}_{math.floor(lon / PASSO_CELLA) * PASSO_CELLA:.1f}"


def scrivi_celle(impianti, oggi):
    """Gli stessi distributori di impianti.json, divisi in celle geografiche: all'apertura l'app
    scarica solo le celle intorno a te (pochi KB) e mostra subito i prezzi vicini."""
    cartella = SITE_DATA / "celle"
    cartella.mkdir(parents=True, exist_ok=True)
    celle = defaultdict(list)
    for imp in impianti:
        celle[chiave_cella(imp[6], imp[7])].append(imp)
    for vecchio in cartella.glob("*.json"):
        if vecchio.stem not in celle:
            vecchio.unlink()
    for chiave, righe in celle.items():
        with open(cartella / f"{chiave}.json", "w", encoding="utf-8") as f:
            json.dump({"aggiornato": oggi, "impianti": righe}, f, ensure_ascii=False, separators=(",", ":"))
    with open(SITE_DATA / "celle.json", "w", encoding="utf-8") as f:
        json.dump({"aggiornato": oggi, "passo": PASSO_CELLA, "celle": sorted(celle)}, f, separators=(",", ":"))
    print(f"Celle: {len(celle)}")


def scrivi_storico(impianti, per_giorno):
    """Un file per provincia: per ogni distributore e carburante, solo i giorni in cui il prezzo
    cambia (giorno = indice dal primo giorno della finestra, prezzo in millesimi di euro).
    Così il file resta piccolo e la scheda può disegnare il grafico a gradini."""
    giorni = sorted(per_giorno)
    if not giorni:
        return
    cartella = SITE_DATA / "storico"
    cartella.mkdir(parents=True, exist_ok=True)
    per_prov = defaultdict(dict)
    for imp in impianti:
        pid, prov = str(imp[0]), imp[5]
        punti_imp = {}
        for carb in imp[9]:
            punti, ultimo = [], None
            for k, g in enumerate(giorni):
                v = per_giorno[g].get((pid, carb))
                if v is None:
                    continue
                milli = round(v[0] * 1000)
                if milli != ultimo:
                    punti.append([k, milli])
                    ultimo = milli
            if punti:
                punti_imp[carb] = punti
        if punti_imp:
            per_prov[prov or "XX"][pid] = punti_imp
    for vecchio in cartella.glob("*.json"):
        if vecchio.stem not in per_prov:
            vecchio.unlink()
    for prov, dati in per_prov.items():
        with open(cartella / f"{prov}.json", "w", encoding="utf-8") as f:
            json.dump({"inizio": giorni[0], "giorni": len(giorni), "impianti": dati},
                      f, ensure_ascii=False, separators=(",", ":"))
    print(f"Storico: {len(per_prov)} province, {len(giorni)} giorni")


if __name__ == "__main__":
    main()
