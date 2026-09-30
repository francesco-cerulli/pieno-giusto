"""Importa lo storico già raccolto dall'archivio pubblico LucaDDDD/benzina-data.

Da eseguire UNA volta, all'inizio, per non partire da zero.
Uso: python scripts/importa_storico.py 60      (ultimi 60 giorni)
Attribuzione: dati MIMIT — Osservatorio Prezzi Carburanti (IODL 2.0).
"""
import gzip
import json
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

from comune import RAW, percorso_prezzi, scrivi_gz

BASE = "https://raw.githubusercontent.com/LucaDDDD/benzina-data/main/data"


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def main():
    main_giorni(int(sys.argv[1]) if len(sys.argv) > 1 else 60)


def main_giorni(giorni: int):
    ultima = json.loads(get(f"{BASE}/last_update.json"))["ultima_estrazione"]
    fine = date.fromisoformat(ultima)
    importati = 0
    for i in range(giorni):
        g = (fine - timedelta(days=i)).isoformat()
        a, m, _ = g.split("-")
        nome = g.replace("-", "")
        if i == 0:  # anagrafica: basta la più recente
            ana = get(f"{BASE}/{a}/{m}/anagrafica_impianti_attivi-{nome}.csv.gz")
            scrivi_gz(RAW / "anagrafica.csv.gz",
                      gzip.decompress(ana).decode("utf-8", errors="replace"))
        dest = percorso_prezzi(g)
        if dest.exists():
            continue
        try:
            dati = get(f"{BASE}/{a}/{m}/prezzo_alle_8-{nome}.csv.gz")
        except urllib.error.HTTPError:
            print(f"{g}: non presente nell'archivio, salto.")
            continue
        scrivi_gz(dest, gzip.decompress(dati).decode("utf-8", errors="replace"))
        importati += 1
        print(f"{g}: importato.")
    print(f"Fatto: {importati} giorni importati.")


if __name__ == "__main__":
    main()
