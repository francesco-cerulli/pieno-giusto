"""Scarica i due file del giorno dal MIMIT e li archivia.

- data/raw/AAAA/MM/prezzi-AAAA-MM-GG.csv.gz  (uno al giorno, è lo storico)
- data/raw/anagrafica.csv.gz                 (solo l'ultima, sovrascritta)

Idempotente: se l'estrazione di quel giorno c'è già, non fa nulla.
Uso: python scripts/scarica.py
"""
import sys
import urllib.request

from comune import (RAW, URL_ANAGRAFICA, URL_PREZZI, data_estrazione,
                    percorso_prezzi, scrivi_gz)


def scarica(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "prezzi-carburanti/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8", errors="replace")


def main():
    try:
        prezzi = scarica(URL_PREZZI)
    except Exception as e:  # sito del Ministero giù: uso l'archivio pubblico di riserva
        print(f"MIMIT non raggiungibile ({e}), uso l'archivio di riserva.")
        import importa_storico
        importa_storico.main_giorni(3)
        return
    giorno = data_estrazione(prezzi)
    righe = prezzi.count("\n")
    if righe < 50_000:  # di solito sono ~90.000: un file più corto è troncato
        sys.exit(f"File prezzi sospetto ({righe} righe): non lo archivio.")

    dest = percorso_prezzi(giorno)
    if dest.exists():
        print(f"Estrazione del {giorno} già archiviata, niente da fare.")
    else:
        scrivi_gz(dest, prezzi)
        print(f"Archiviati i prezzi del {giorno} ({righe} righe).")

    anagrafica = scarica(URL_ANAGRAFICA)
    data_estrazione(anagrafica)  # controllo formato
    scrivi_gz(RAW / "anagrafica.csv.gz", anagrafica)
    print("Anagrafica aggiornata.")


if __name__ == "__main__":
    main()
