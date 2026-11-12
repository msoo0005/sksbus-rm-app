// Assets and Chrome for the PDF renderer. Kept free of AWS imports so the
// templates can be rendered locally with any Chrome (see setup notes).

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

// ── Assets: logo and the TeX Gyre Heros fonts, embedded in every PDF ──────
function assetPath(name) {
  return join(here, "..", "assets", name);
}

let _assets = null;
export function loadAssets() {
  if (_assets) return _assets;
  // Spec name uses underscores; accept the spaced name the file was saved with too.
  const logoFile = ["SKSCHASSIS_LOGO_BLACK_AND_WHITE.svg", "SKSCHASSIS LOGO BLACK AND WHITE.svg"]
    .map(assetPath)
    .find((p) => existsSync(p));
  const logoHtml = logoFile
    ? `<img class="hdr-logo" alt="SKS Chassis" src="data:image/svg+xml;base64,${readFileSync(logoFile).toString("base64")}">`
    : `<span class="hdr-logo-text">SKS CHASSIS</span>`;

  const face = (file, weight) => {
    const p = assetPath(file);
    if (!existsSync(p)) return "";
    return `@font-face { font-family: "TeX Gyre Heros"; font-weight: ${weight}; font-style: normal;
      src: url(data:font/otf;base64,${readFileSync(p).toString("base64")}) format("opentype"); }`;
  };
  const fontCss = face("texgyreheros-regular.otf", 400) + face("texgyreheros-bold.otf", 700);
  _assets = { logoHtml, fontCss };
  return _assets;
}

// ── Chrome ────────────────────────────────────────────────────────────────
let _browser = null;
async function browser() {
  if (_browser && _browser.connected !== false) return _browser;
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = (await import("puppeteer-core")).default;
  _browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 1 },
    executablePath: process.env.CHROME_PATH || (await chromium.executablePath()),
    // @sparticuz/chromium ships chrome-headless-shell, which needs "shell"
    // mode; a local Chrome (CHROME_PATH, for testing) uses the normal one.
    headless: process.env.CHROME_PATH ? true : (chromium.headless ?? "shell"),
  });
  return _browser;
}

/** HTML → PDF bytes, running the page engine (lib/layout.mjs) first. */
export async function renderPdf(html, launch = browser) {
  const b = await launch();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const pages = await page.evaluate(() => window.__paginate());
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: 60000 });
    return { pdf: Buffer.from(pdf), pages };
  } finally {
    await page.close().catch(() => {});
  }
}

