"""Scarica i due file del giorno dal MIMIT e li archivia.

- data/raw/AAAA/MM/prezzi-AAAA-MM-GG.csv.gz  (uno al giorno, è lo storico)
- data/raw/anagrafica.csv.gz                 (solo l'ultima, sovrascritta)

Idempotente: se l'estrazione di quel giorno c'è già, non fa nulla.
Uso: python scripts/scarica.py
"""
import sys
import urllib.request

from comune import (RAW, URL_ANAGRAFICA, URL_PREZZI, data_estrazione,
                    leggi_gz, percorso_prezzi, scrivi_gz)


def scarica(url: str, attesa: int = 120) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "prezzi-carburanti/0.1"})
    with urllib.request.urlopen(req, timeout=attesa) as r:
        return r.read().decode("utf-8", errors="replace")


def main():
    try:
        prezzi = scarica(URL_PREZZI, attesa=45)
    except Exception as e:
        # Da ottobre 2026 www.mimit.gov.it non risponde ai server di GitHub (e di Cloudflare).
        # Piano B: l'API di carburanti.mise.gov.it; piano C: l'archivio pubblico di riserva.
        print(f"::warning::MIMIT non raggiungibile ({e}): uso l'API di carburanti.mise.gov.it.")
        try:
            import scarica_api
            if scarica_api.main():
                return
        except Exception as e2:
            print(f"::warning::Anche l'API non va ({e2}): uso l'archivio di riserva.")
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
    file_ana = RAW / "anagrafica.csv.gz"
    if file_ana.exists() and leggi_gz(file_ana) == anagrafica:
        print("Anagrafica invariata.")
    else:
        scrivi_gz(file_ana, anagrafica)
        print("Anagrafica aggiornata.")


if __name__ == "__main__":
    main()
