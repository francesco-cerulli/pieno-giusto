"""Piano B: ricostruisce il file dei prezzi del giorno dall'API pubblica di carburanti.mise.gov.it
(quella del sito Osservaprezzi del Ministero), quando www.mimit.gov.it non risponde ai server di GitHub.

Una richiesta per regione (20 in tutto) restituisce tutti i distributori con i prezzi attuali.
Il risultato ha lo stesso formato di prezzo_alle_8.csv, così il resto non cambia.
Gli ID dei distributori sono gli stessi dell'anagrafica MIMIT.
Uso: python scripts/scarica_api.py
"""
import json
import sys
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from comune import percorso_prezzi

API = "https://carburanti.mise.gov.it/ospzApi"
ROMA = ZoneInfo("Europe/Rome")


def chiama(percorso: str, corpo=None):
    dati = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(API + percorso, data=dati, headers={
        "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0 (pumpy.it)"})
    for tentativo in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:
            if tentativo == 2:
                raise
            print(f"{percorso}: {e}, riprovo...")
            time.sleep(10)


def data_comu(testo: str, ripiego: datetime) -> str:
    try:
        dt = datetime.fromisoformat(testo).astimezone(ROMA)
    except (TypeError, ValueError):
        dt = ripiego
    return dt.strftime("%d/%m/%Y %H:%M:%S")


def scarica_tutto() -> tuple[str, int]:
    adesso = datetime.now(ROMA)
    regioni = [r["id"] for r in chiama("/registry/region")["results"]]
    righe, impianti = [], set()
    for reg in regioni:
        risultati = chiama("/search/area", {"region": int(reg)}).get("results") or []
        for imp in risultati:
            if imp["id"] in impianti:
                continue
            impianti.add(imp["id"])
            quando = data_comu(imp.get("insertDate"), adesso)
            for f in imp.get("fuels") or []:
                if f.get("price") is None or not f.get("name"):
                    continue
                righe.append(f'{imp["id"]}|{f["name"]}|{f["price"]}|{1 if f.get("isSelf") else 0}|{quando}')
        print(f"Regione {reg}: {len(risultati)} distributori.")
    testo = (f"Estrazione del {adesso.date().isoformat()}\n"
             "idImpianto|descCarburante|prezzo|isSelf|dtComu\n" + "\n".join(righe) + "\n")
    return testo, len(impianti)


def main() -> bool:
    """True se ha archiviato (o c'era già) il file di oggi."""
    oggi = datetime.now(ROMA).date().isoformat()
    dest = percorso_prezzi(oggi)
    if dest.exists():
        print(f"Estrazione del {oggi} già archiviata, niente da fare.")
        return True
    testo, n = scarica_tutto()
    righe = testo.count("\n")
    if n < 15_000 or righe < 50_000:  # in Italia sono ~22.000 distributori e ~90.000 prezzi
        print(f"::warning::API Ministero incompleta ({n} distributori, {righe} righe): non archivio.")
        return False
    from comune import scrivi_gz
    scrivi_gz(dest, testo)
    print(f"Archiviati i prezzi del {oggi} dall'API del Ministero ({n} distributori, {righe} righe).")
    return True


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
