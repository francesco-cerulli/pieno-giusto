// Pumpy · servizio avvisi
// - Riceve dall'app le iscrizioni (abbonamento push del telefono + pompe preferite + carburante).
// - Ogni ora controlla se sul sito sono arrivati i prezzi nuovi; quando arrivano, per ogni iscritto
//   guarda le sue pompe e manda al massimo UN avviso al giorno, solo se c'è qualcosa che conta:
//   il verdetto della zona cambia (es. il calo è finito) oppure una sua pompa cala di almeno 3 cent.
// - Avvisa anche chi non ha stelle: basta la zona (provincia + punto arrotondato a ~1 km).
// - Per le pompe seguite usa le stesse frasi dell'app: "non ha ancora abbassato" / "ha abbassato".
// - Se i prezzi del giorno tardano, fa partire l'aggiornamento su GitHub (serve il segreto GH_TOKEN).
// Conserva solo: l'abbonamento push (anonimo), le pompe seguite, la zona, l'ultimo verdetto visto.
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
function pulisciZona(z) {
  if (!z || !PROVINCE[z.prov]) return null;
  const lat = Math.round(Number(z.lat) * 100) / 100, lon = Math.round(Number(z.lon) * 100) / 100;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { prov: z.prov, lat, lon } : null;
}
function km(a, b) {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Stessa regola dell'app (verificata ogni giorno in medie.json → "pompe")
function frasePompa(v, prov, carb, medie) {
  const dir = medie.tendenze?.[prov]?.[carb]?.[3], media = medie.province?.[prov]?.[carb], ve = medie.pompe;
  if (!v || dir !== "giu" || !media || !ve) return null;
  const [p, d, dal] = v, gg = dal ? (Date.parse(medie.aggiornato) - Date.parse(dal)) / 864e5 : 99;
  const gia = d <= -0.002 && gg <= 3, sopra = p > media + 0.003;
  if (!gia && sopra && ve.non_ancora.percentuale >= 55) return "scendera";
  if (gia && !sopra && ve.gia.percentuale <= 20) return "fatto";
  return null;
}
// "venerdì", "domani": il giorno in cui di solito il calo (o l'aumento) si è quasi compiuto
function giornoAtteso(medie, prov, carb) {
  const t = medie.tendenze?.[prov]?.[carb], dt = t && medie.dopo_tendenza?.[t[3]];
  if (!dt) return null;
  const n = Math.max(1, Math.round(dt.giorno * Math.min(1, Math.abs(t[2]) / dt.d3_medio)));
  if (n === 1) return "domani";
  const g = new Date(); g.setUTCDate(g.getUTCDate() + n);
  return n > 6 ? `tra ${n} giorni` : g.toLocaleDateString("it-IT", { weekday: "long", timeZone: "Europe/Rome" });
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
      let svolta = null, calo = null, abbassata = null, attende = null;
      rec.statiPompe ||= {};
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
        // la pompa che aspettavi ha abbassato: è il momento
        const ora = frasePompa(v, f.prov, carb, medie), era = rec.statiPompe[f.id];
        if (era === "scendera" && delta < 0 && dal === giorno && (!abbassata || prezzo < abbassata.prezzo)) abbassata = { nome, prezzo, id: f.id };
        if (ora === "scendera" && !attende) attende = { nome, prezzo, id: f.id };
        rec.statiPompe[f.id] = ora;
      }
      // solo la zona (nessuna stella in quella provincia): verdetto della zona + il più economico vicino
      const z = rec.zona;
      if (z && !(rec.preferiti || []).some((f) => f.prov === z.prov)) {
        const dir = medie.tendenze?.[z.prov]?.[carb]?.[3], prima = rec.verdetti[z.prov];
        if (dir && prima && dir !== prima && !svolta) {
          let top = null;
          for (const r of (await cella(chiaveCella(z.lat, z.lon))).values()) {
            const v = r[9]?.[carb];
            if (v && !v[4] && km(z, { lat: r[6], lon: r[7] }) <= 5 && (!top || v[0] < top.prezzo)) top = { nome: r[2] || r[1], prezzo: v[0], id: r[0] };
          }
          svolta = { prov: z.prov, da: prima, a: dir, nome: top?.nome, prezzo: top?.prezzo, id: top?.id, zona: true };
        }
        if (dir) rec.verdetti[z.prov] = dir;
      }
      let dati = null;
      const zona = (p) => PROVINCE[p] || p;
      if (abbassata) {
        dati = { title: `${abbassata.nome} ha abbassato`, body: `Ora costa ${euro(abbassata.prezzo)} € al litro: difficile che scenda ancora. È un buon momento.`, url: `./?pompa=${abbassata.id}` };
      } else if (svolta) {
        const n = NOMI[carb] === "GPL" ? "GPL" : NOMI[carb].toLowerCase(), z2 = zona(svolta.prov), quando = giornoAtteso(medie, svolta.prov, carb);
        const p = svolta.nome ? ` ${svolta.zona ? "Il più economico vicino a te" : svolta.nome}: ${svolta.zona ? svolta.nome + " " : ""}${euro(svolta.prezzo)} €.` : "";
        dati = svolta.a === "giu"
            ? { title: `Aspetta a fare ${n}`, body: attende ? `A ${z2} i prezzi calano e la tua ${attende.nome} non ha ancora abbassato (${euro(attende.prezzo)} €).` : `A ${z2} i prezzi calano${quando ? `: ${quando} dovrebbe costare meno` : ""}.${p}` }
          : svolta.a === "su" ? { title: `Fai ${n} oggi`, body: `A ${z2} i prezzi salgono${quando ? `: da ${quando} costerà di più` : ""}.${p}` }
          : svolta.da === "giu" ? { title: "Il calo è finito: è il momento", body: `A ${z2} i prezzi si sono fermati.${p}` }
          : { title: `Prezzi fermi a ${z2}`, body: `Nessuna fretta.${p}` };
        dati.url = svolta.id ? `./?pompa=${svolta.id}` : "./";
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

// --- prezzi in ritardo? fa partire subito l'aggiornamento su GitHub (al massimo una volta all'ora) ---
export async function sollecita(env) {
  if (!env.GH_TOKEN || !env.REPO) return { sollecito: "non configurato" };
  const roma = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const oggi = `${roma.getFullYear()}-${String(roma.getMonth() + 1).padStart(2, "0")}-${String(roma.getDate()).padStart(2, "0")}`;
  if (roma.getHours() < 8 || roma.getHours() > 20) return { sollecito: "fuori orario" };
  const medie = await (await fetch(env.ORIGINE + env.PERCORSO + "data/medie.json", { cf: { cacheTtl: 0 } })).json();
  // il Ministero pubblica la mattina i prezzi del giorno prima: se ci sono quelli di ieri, siamo aggiornati
  const ieri = new Date(Date.UTC(roma.getFullYear(), roma.getMonth(), roma.getDate() - 1)).toISOString().slice(0, 10);
  if (medie.aggiornato >= ieri) return { sollecito: "già aggiornato" };
  const chiave = `sollecito:${oggi}:${roma.getHours()}`;
  if (await env.ISCRITTI.get(chiave)) return { sollecito: "già fatto quest'ora" };
  const r = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/aggiorna.yml/dispatches`, {
    method: "POST", body: JSON.stringify({ ref: "main" }),
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "pumpy-avvisi", "Content-Type": "application/json" },
  });
  await env.ISCRITTI.put(chiave, "1", { expirationTtl: 7200 });
  return { sollecito: r.status };
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
        const rec = { ...prima, abbonamento: b.abbonamento, preferiti: pulisciPreferiti(b.preferiti), zona: pulisciZona(b.zona),
          carb: NOMI[b.carb] ? b.carb : "benzina", creato: prima.creato || new Date().toISOString().slice(0, 10) };
        await env.ISCRITTI.put(id, JSON.stringify(rec));
        return json({ ok: true, preferiti: rec.preferiti.length, zona: !!rec.zona }, h);
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
    ctx.waitUntil(sollecita(env).catch((e) => ({ sollecito: String(e) })).then((r) => console.log(JSON.stringify(r))));
    ctx.waitUntil(controlla(env).then((r) => console.log(JSON.stringify(r))));
  },
};
