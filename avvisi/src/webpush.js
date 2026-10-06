// Web Push senza librerie esterne: cifratura del messaggio (RFC 8291, aes128gcm)
// e firma VAPID (RFC 8292) con le WebCrypto del Worker.

const enc = new TextEncoder();

export function b64u(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function dab64u(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function unisci(...parti) {
  const n = parti.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parti) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt, ikm, info, lunghezza) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, lunghezza * 8);
  return new Uint8Array(bits);
}

// Chiavi VAPID: una coppia ECDSA P-256 generata una volta e conservata (JWK)
export async function nuoveChiaviVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privata = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pubblica = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { privata, pubblica };
}

async function firmaVapid(endpoint, chiavi, contatto) {
  const aud = new URL(endpoint).origin;
  const testa = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const corpo = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contatto })));
  const key = await crypto.subtle.importKey("jwk", chiavi.privata, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${testa}.${corpo}`));
  return `vapid t=${testa}.${corpo}.${b64u(firma)}, k=${chiavi.pubblica}`;
}

// Cifra il testo per un abbonamento (endpoint + chiavi p256dh/auth del telefono)
export async function cifra(abbonamento, testo) {
  const uaPub = dab64u(abbonamento.keys.p256dh);
  const auth = dab64u(abbonamento.keys.auth);
  const effimera = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", effimera.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const condivisa = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, effimera.privateKey, 256));
  const ikm = await hkdf(auth, condivisa, unisci(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const chiaro = unisci(enc.encode(testo), new Uint8Array([2]));   // 0x02 = ultimo blocco
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrato = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, chiaro));
  const rs = new Uint8Array([0, 0, 16, 0]);                        // 4096, big endian
  return unisci(salt, rs, new Uint8Array([asPub.length]), asPub, cifrato);
}

// Invia una notifica. Restituisce lo status HTTP del servizio push (404/410 = abbonamento scaduto)
export async function inviaPush(abbonamento, dati, chiavi, contatto) {
  const corpo = await cifra(abbonamento, JSON.stringify(dati));
  const r = await fetch(abbonamento.endpoint, {
    method: "POST",
    headers: {
      Authorization: await firmaVapid(abbonamento.endpoint, chiavi, contatto),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body: corpo,
  });
  return r.status;
}
