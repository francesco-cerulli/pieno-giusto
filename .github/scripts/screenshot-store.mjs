// Screenshot per il Play Store: pumpy.it vero, come su telefono e tablet Android a Modena.
// DISPOSITIVI=telefono,tablet7,tablet10 (predefinito: tutti)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "store/screenshot"; mkdirSync(OUT, { recursive: true });
const UA_TEL = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const UA_TAB = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const TUTTI = {
  telefono: { prefisso: "", viewport: { width: 360, height: 720 }, scala: 3, ua: UA_TEL },        // 1080x2160
  tablet7: { prefisso: "tablet7-", viewport: { width: 540, height: 960 }, scala: 2, ua: UA_TAB },  // 1080x1920
  tablet10: { prefisso: "tablet10-", viewport: { width: 1280, height: 720 }, scala: 2, ua: UA_TAB }, // 2560x1440
};
const scelti = (process.env.DISPOSITIVI || Object.keys(TUTTI).join(",")).split(",").map((s) => s.trim()).filter((s) => TUTTI[s]);
const b = await chromium.launch();
for (const nomeDisp of scelti) {
  const d = TUTTI[nomeDisp];
  for (const tema of ["light", "dark"]) {
    const ctx = await b.newContext({
      viewport: d.viewport, deviceScaleFactor: d.scala, isMobile: true, hasTouch: true, userAgent: d.ua,
      colorScheme: tema, locale: "it-IT", timezoneId: "Europe/Rome",
      geolocation: { latitude: 44.6458, longitude: 10.9255, accuracy: 20 }, permissions: ["geolocation"],
    });
    await ctx.addInitScript(() => { try { localStorage.setItem("benvenuto", "1"); } catch {} });
    const p = await ctx.newPage();
    const err = []; p.on("pageerror", (e) => err.push(String(e)));
    await p.goto("https://pumpy.it/", { waitUntil: "networkidle" });
    await p.waitForTimeout(6000);
    const foto = async (nome) => { await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/${d.prefisso}${tema}-${nome}.png` }); };
    await p.evaluate(() => { const v = document.getElementById("installaVoce"); if (v) v.hidden = true; });
    await foto("1-verdetto");
    await p.evaluate(() => mettiPannello(false)); await foto("2-mappa");
    await p.evaluate(() => { const i = stato.migliore || stato.impianti.find((x) => x.prezzi[stato.carb]); seleziona(i); });
    await foto("3-distributore");
    await p.evaluate(() => chiudiDettaglioOra()); await p.waitForTimeout(800);
    await p.click("#menuBtn"); await p.evaluate(() => { const v = document.getElementById("installaVoce"); if (v) v.hidden = true; }); await foto("4-menu");
    console.log(nomeDisp, tema, "errori:", err);
    await ctx.close();
  }
}
await b.close();
