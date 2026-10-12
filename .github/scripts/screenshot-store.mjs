// Screenshot per il Play Store: pumpy.it vero, come su un telefono Android a Modena.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "store/screenshot"; mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const b = await chromium.launch();
for (const tema of ["light", "dark"]) {
  const ctx = await b.newContext({
    viewport: { width: 360, height: 720 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA,
    colorScheme: tema, locale: "it-IT", timezoneId: "Europe/Rome",
    geolocation: { latitude: 44.6458, longitude: 10.9255, accuracy: 20 }, permissions: ["geolocation"],
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("benvenuto", "1"); } catch {} });
  const p = await ctx.newPage();
  const err = []; p.on("pageerror", (e) => err.push(String(e)));
  await p.goto("https://pumpy.it/", { waitUntil: "networkidle" });
  await p.waitForTimeout(6000);
  const foto = async (nome) => { await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/${tema}-${nome}.png` }); };
  await foto("1-verdetto");
  await p.evaluate(() => mettiPannello(false)); await foto("2-mappa");
  await p.evaluate(() => { const i = stato.migliore || stato.impianti.find((x) => x.prezzi[stato.carb]); seleziona(i); });
  await foto("3-distributore");
  await p.evaluate(() => chiudiDettaglioOra()); await p.waitForTimeout(800);
  await p.click("#menuBtn"); await foto("4-menu");
  console.log(tema, "errori:", err);
  await ctx.close();
}
await b.close();
