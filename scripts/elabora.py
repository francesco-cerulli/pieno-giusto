"""Unisce anagrafica e prezzi e produce i JSON per la mappa.

Per ogni distributore e carburante calcola:
- il prezzo attuale (self per benzina/gasolio, servito per GPL/metano, come il MIMIT)
- l'ultima variazione: di quanto è cambiato rispetto al prezzo precedente e da quando

Output:
- docs/data/impianti.json  → distributori con prezzi e variazioni
- docs/data/medie.json     → medie nazionali e provinciali + andamento storico
Uso: python scripts/elabora.py
"""
import json
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
GIORNI_ANDAMENTO = 90               # lunghezza della serie delle medie nazionali


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
    per_provincia = defaultdict(lambda: defaultdict(list))
    for r in leggi_csv(leggi_gz(RAW / "anagrafica.csv.gz")):
        try:
            lat, lon = float(r["Latitudine"]), float(r["Longitudine"])
        except (KeyError, ValueError):
            continue
        if not (35 <= lat <= 48 and 6 <= lon <= 19):  # fuori dall'Italia = coordinate errate
            continue
        pid = r["idImpianto"]
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
            # [prezzo, variazione €, data variazione (o null), data comunicazione]
            prezzi[carb] = [prezzo, delta, dal, dt.strftime("%Y-%m-%d")]
            if eta <= MAX_GIORNI_MEDIA and r["Tipo Impianto"] != "Autostradale":
                per_provincia[r["Provincia"]][carb].append(prezzo)
        if not prezzi:
            continue
        nome = " ".join(r["Nome Impianto"].split()) or r["Bandiera"]
        impianti.append([int(pid), nome, r["Bandiera"], " ".join(r["Indirizzo"].split()),
                         r["Comune"].title(), r["Provincia"], round(lat, 5), round(lon, 5),
                         1 if r["Tipo Impianto"] == "Autostradale" else 0, prezzi])

    SITE_DATA.mkdir(parents=True, exist_ok=True)
    with open(SITE_DATA / "impianti.json", "w", encoding="utf-8") as f:
        json.dump({"aggiornato": oggi,
                   "campi": ["id", "nome", "bandiera", "indirizzo", "comune", "provincia",
                             "lat", "lon", "autostrada", "prezzi"],
                   "impianti": impianti}, f, ensure_ascii=False, separators=(",", ":"))

    # --- medie: provinciali di oggi + andamento nazionale ---
    def media(valori):
        return round(sum(valori) / len(valori), 3) if valori else None

    province = {p: {c: media(v) for c, v in carb.items()} for p, carb in per_provincia.items()}

    andamento = []
    for g in reversed(giorni[:GIORNI_ANDAMENTO]):
        gp = storico[giorni.index(g)] if giorni.index(g) < len(storico) else pulisci(prezzi_del_giorno(g))
        gd = date.fromisoformat(g)
        acc = defaultdict(list)
        for (_, carb), (prezzo, dt) in gp.items():
            if (gd - dt.date()).days <= MAX_GIORNI_MEDIA:
                acc[carb].append(prezzo)
        andamento.append({"giorno": g, **{c: media(v) for c, v in acc.items()}})

    with open(SITE_DATA / "medie.json", "w", encoding="utf-8") as f:
        json.dump({"aggiornato": oggi, "nazionale": andamento, "province": province},
                  f, ensure_ascii=False, separators=(",", ":"))

    cambiati = sum(1 for d, _ in variazioni.values() if d)
    print(f"Scritti {len(impianti)} distributori, {cambiati} prezzi con variazione registrata.")


if __name__ == "__main__":
    main()
