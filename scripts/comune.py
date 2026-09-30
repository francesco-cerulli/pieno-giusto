"""Funzioni condivise: percorsi, lettura dei CSV del MIMIT (separatore "|")."""
import csv
import gzip
import io
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"          # archivio giornaliero dei prezzi (csv.gz)
SITE_DATA = ROOT / "docs" / "data"   # JSON leggeri letti dalla mappa

URL_PREZZI = "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv"
URL_ANAGRAFICA = "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv"

RE_ESTRAZIONE = re.compile(r"Estrazione del (\d{4}-\d{2}-\d{2})")


def data_estrazione(testo: str) -> str:
    """Legge la data dalla prima riga, es. 'Estrazione del 2026-09-29'."""
    m = RE_ESTRAZIONE.search(testo.splitlines()[0] if testo else "")
    if not m:
        raise ValueError("Prima riga senza 'Estrazione del AAAA-MM-GG': formato cambiato?")
    return m.group(1)


def leggi_csv(testo: str):
    """Salta la riga 'Estrazione del...' e restituisce dizionari per ogni riga."""
    righe = testo.splitlines()[1:]
    lettore = csv.DictReader(io.StringIO("\n".join(righe)), delimiter="|",
                             quoting=csv.QUOTE_NONE)
    for r in lettore:
        yield {k.strip(): (v or "").strip() for k, v in r.items() if k}


def leggi_gz(percorso: Path) -> str:
    with gzip.open(percorso, "rt", encoding="utf-8", errors="replace") as f:
        return f.read()


def scrivi_gz(percorso: Path, testo: str):
    percorso.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(percorso, "wt", encoding="utf-8") as f:
        f.write(testo)


def percorso_prezzi(giorno: str) -> Path:
    a, m, _ = giorno.split("-")
    return RAW / a / m / f"prezzi-{giorno}.csv.gz"


def giorni_archiviati():
    """Tutte le date presenti in archivio, dalla più recente."""
    return sorted((p.name[7:17] for p in RAW.glob("*/*/prezzi-*.csv.gz")), reverse=True)
