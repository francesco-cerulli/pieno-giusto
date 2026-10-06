// Pumpy · servizio avvisi
// - Riceve dall'app le iscrizioni (abbonamento push del telefono + pompe preferite + carburante).
// - Ogni ora controlla se sul sito sono arrivati i prezzi nuovi; quando arrivano, per ogni iscritto
//   guarda le sue pompe e manda al massimo UN avviso al giorno, solo se c'è qualcosa che conta:
//   il verdetto della zona cambia (es. il calo è finito) oppure una sua pompa cala di almeno 3 cent.
// Conserva solo: l'abbonamento push (anonimo), le pompe seguite, l'ultimo verdetto visto per zona.
import { inviaPush, nuoveChiaviVapid } from "./webpush.js";

const PROVINCE = {"AG": "Agrigento", "AL": "Alessandria", "AN": "Ancona", "AO": "Aosta", "AP": "Ascoli Piceno", "AQ": "L'Aquila", "AR": "Arezzo", "AT": "Asti", "AV": "Avellino", "BA": "Bari", "BG": "Bergamo", "BI": "Biella", "BL": "Belluno", "BN": "Benevento", "BO": "Bologna", "BR": "Brindisi", "BS": "Brescia", "BT": "Barletta-Andria-Trani", "BZ": "Bolzano", "CA": "Cagliari", "CB": "Campobasso", "CE": "Caserta", "CH": "Chieti", "CL": "Caltanissetta", "CN": "Cuneo", "CO": "Como", "CR": "Cremona", "CS": "Cosenza", "CT": "Catania", "CZ": "Catanzaro", "EN": "Enna", "FC": "Forlì-Cesena", "FE": "Ferrara", "FG": "Foggia", "FI": "Firenze", "FM": "Fermo", "FR": "Frosinone", "GE": "Genova", "GO": "Gorizia", "GR": "Grosseto", "IM": "Imperia", "IS": "Isernia", "KR": "Crotone", "LC": "Lecco", "LE": "Lecce", "LI": "Livorno", "LO": "Lodi", "LT": "Latina", "LU": "Lucca", "MB": "Monza e Brianza", "MC": "Macerata", "ME": "Messina", "MI": "Milano", "MN": "Mantova", "MO": "Modena", "MS": "Massa-Carrara", "MT": "Matera", "NA": "Napoli", "NO": "Novara", "NU": "Nuoro", "OR": "Oristano", "PA": "Palermo", "PC": "Piacenza", "PD": "Padova", "PE": "Pescara", "PG": "Perugia", "PI": "Pisa", "PN": "Pordenone", "PO": "Prato", "PR": "Parma", "PT": "Pistoia", "PU": "Pesaro e Urbino", "PV": "Pavia", "PZ": "Potenza", "RA": "Ravenna", "RC": "Reggio Calabria", "RE": "Reggio Emilia", "RG": "Ragusa", "RI": "Rieti", "RM": "Roma", "RN": "Rimini", "RO": "Rovigo", "SA": "Salerno", "SI": "Siena", "SO": "Sondrio", "SP": "La Spezia", "SR": "Siracusa", "SS": "Sassari", "SU": "Sud Sardegna", "SV": "Savona", "TA": "Taranto", "TE": "Teramo", "TN": "Trento", "TO": "Torino", "TP": "Trapani", "TR": "Terni", "TS": "Trieste", "TV": "Treviso", "UD": "Udine", "VA": "Varese", "VB": "Verbano-Cusio-Ossola", "VC": "Vercelli", "VE": "Venezia", "VI": "Vicenza", "VR": "Verona", "VT": "Viterbo", "VV": "Vibo Valentia"};
const NOMI = { benzina: "Benzina", gasolio: "Gasolio", gpl: "GPL", metano: "Metano" };
const PASSO_CELLA = 0.5;
const CALO_FORTE = 0.03;          // euro/litro in un giorno
const MAX_PREFERITI = 20;

const euro = (p) => p.toFixed(3).replace(".", ",");
const cent = (d) => (Math.abs(d) * 100).toFixed(1).replace(".", ",").replace(",0", "");
const chiaveCella = (lat, lon) => `${(Math.floor(lat / PASSO_CELLA) * PASSO_CELLA).toFixed(1)}_${(Math.floor(lon / PASSO_CELLA) * PASSO_CELLA).toFixed(1)}`;

function cors(req, env) {
  const o = req.headers.get("Origin") || "";
  const ok = o === env.ORIGINE || o.startsWith("http://localhost");
  return { "Access-Control-Allow-Origin": ok ? o : env.ORIGINE, "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
}
const json = (dati, h, status = 200) => new Response(JSON.stringify(dati), { status, headers: { ...h, "Content-Type": "application/json" } });

async function chiaviVapid(env) {
  let c = await env.ISCRITTI.get("vapid", "json");
  if (!c) { c = await nuoveChiaviVapid(); await env.ISCRITTI.put("vapid", JSON.stringify(c)); }
  return c;
}
async function idAbbonamento(endpoint) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return "ab:" + [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function abbonamentoValido(a) {
  try { return a && new URL(a.endpoint).protocol === "https:" && a.keys?.p256dh && a.keys?.auth; } catch { return false; }
}
function pulisciPreferiti(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, MAX_PREFERITI).map((f) => ({
    id: Number(f.id), lat: Number(f.lat), lon: Number(f.lon), prov: String(f.prov || "").slice(0, 3), nome: String(f.nome || "").slice(0, 60),
  })).filter((f) => Number.isFinite(f.id) && Number.isFinite(f.lat) && Number.isFinite(f.lon));
}

async function invia(env, rec, dati) {
  const stato = await inviaPush(rec.abbonamento, dati, await chiaviVapid(env), env.ORIGINE + env.PERCORSO);
  return stato;
}

// --- controllo orario: quando ci sono prezzi nuovi, avvisa chi deve ---
export async function controlla(env) {
  const base = env.ORIGINE + env.PERCORSO;
  const medie = await (await fetch(base + "data/medie.json", { cf: { cacheTtl: 0 } })).json();
  const giorno = medie.aggiornato;
  if ((await env.ISCRITTI.get("elaborato")) === giorno) return { saltato: true, giorno };
  const celle = new Map();
  const cella = async (k) => {
    if (!celle.has(k)) celle.set(k, fetch(base + `data/celle/${k}.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const m = new Map(); for (const r of d?.impianti || []) m.set(r[0], r); return m;
    }).catch(() => new Map()));
    return celle.get(k);
  };
  let inviati = 0, iscritti = 0, cursore;
  do {
    const pag = await env.ISCRITTI.list({ prefix: "ab:", cursor: cursore });
    cursore = pag.list_complete ? null : pag.cursor;
    for (const { name } of pag.keys) {
      const rec = await env.ISCRITTI.get(name, "json");
      if (!rec) continue;
      iscritti++;
      const carb = NOMI[rec.carb] ? rec.carb : "benzina";
      rec.verdetti ||= {};
      let svolta = null, calo = null;
      for (const f of rec.preferiti || []) {
        const r = (await cella(chiaveCella(f.lat, f.lon))).get(f.id);
        const v = r?.[9]?.[carb];
        if (!v) continue;
        const [prezzo, delta, dal] = v;
        const nome = f.nome || r[2] || r[1];
        const dir = medie.tendenze?.[f.prov]?.[carb]?.[3];
        const prima = rec.verdetti[f.prov];
        if (dir && prima && dir !== prima && (!svolta || prezzo < svolta.prezzo)) svolta = { prov: f.prov, da: prima, a: dir, nome, prezzo, id: f.id };
        if (dir) rec.verdetti[f.prov] = dir;
        if (delta <= -CALO_FORTE && dal === giorno && (!calo || delta < calo.delta)) calo = { nome, prezzo, delta, id: f.id };
      }
      let dati = null;
      const zona = (p) => PROVINCE[p] || p;
      if (svolta) {
        const n = NOMI[carb], z = zona(svolta.prov), p = `${svolta.nome}: ${euro(svolta.prezzo)} €`;
        dati = svolta.a === "giu" ? { title: `${n} in calo a ${z}`, body: `Se puoi, aspetta qualche giorno. ${p}.` }
          : svolta.a === "su" ? { title: `${n} in aumento a ${z}`, body: `Meglio fare il pieno oggi. ${p}.` }
          : svolta.da === "giu" ? { title: "Il calo è finito: è il momento", body: `${p}. Fai il pieno quando vuoi.` }
          : { title: `Prezzi fermi a ${z}`, body: `Nessuna fretta. ${p}.` };
        dati.url = `./?pompa=${svolta.id}`;
      } else if (calo) {
        dati = { title: `${calo.nome}: −${cent(calo.delta)} cent`, body: `La tua pompa ora costa ${euro(calo.prezzo)} € al litro.`, url: `./?pompa=${calo.id}` };
      }
      if (dati && rec.ultimoInvio !== giorno) {
        try {
          const st = await invia(env, rec, { ...dati, tag: "pumpy-" + giorno });
          if (st === 404 || st === 410) { await env.ISCRITTI.delete(name); continue; }
          if (st < 300) { inviati++; rec.ultimoInvio = giorno; }
        } catch (e) { console.log("invio fallito", name, String(e)); }   // un telefono che non risponde non blocca gli altri
      }
      await env.ISCRITTI.put(name, JSON.stringify(rec));
    }
  } while (cursore);
  await env.ISCRITTI.put("elaborato", giorno);
  return { giorno, iscritti, inviati };
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    const url = new URL(req.url);
    try {
      if (url.pathname === "/chiave") return json({ chiave: (await chiaviVapid(env)).pubblica }, h);
      if (req.method === "POST" && url.pathname === "/iscrivi") {
        const b = await req.json();
        if (!abbonamentoValido(b.abbonamento)) return json({ errore: "abbonamento non valido" }, h, 400);
        const id = await idAbbonamento(b.abbonamento.endpoint);
        const prima = (await env.ISCRITTI.get(id, "json")) || {};
        const rec = { ...prima, abbonamento: b.abbonamento, preferiti: pulisciPreferiti(b.preferiti),
          carb: NOMI[b.carb] ? b.carb : "benzina", creato: prima.creato || new Date().toISOString().slice(0, 10) };
        await env.ISCRITTI.put(id, JSON.stringify(rec));
        return json({ ok: true, preferiti: rec.preferiti.length }, h);
      }
      if (req.method === "POST" && url.pathname === "/disiscrivi") {
        const b = await req.json();
        if (b.endpoint) await env.ISCRITTI.delete(await idAbbonamento(b.endpoint));
        return json({ ok: true }, h);
      }
      if (req.method === "POST" && url.pathname === "/prova") {
        const b = await req.json();
        const rec = b.endpoint && (await env.ISCRITTI.get(await idAbbonamento(b.endpoint), "json"));
        if (!rec) return json({ errore: "non iscritto" }, h, 404);
        const st = await invia(env, rec, { title: "Avvisi attivi", body: "Ti scriveremo solo quando conviene: al massimo una volta al giorno.", url: "./", tag: "pumpy-prova" });
        return json({ ok: st < 300, stato: st }, h);
      }
      return json({ servizio: "Pumpy avvisi", ok: true }, h);
    } catch (e) {
      return json({ errore: String(e.message || e) }, h, 500);
    }
  },
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(controlla(env).then((r) => console.log(JSON.stringify(r))));
  },
};
