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

// ── Keeping PDFs small ────────────────────────────────────────────────────
// Photos arrive at upload size (1600 px, ~250 KB each), but print at most
// 345 × 259 px. Embedding them as-is made a 13-photo report several MB. Each
// raster photo is redrawn at 2× its printed box (about 190 dpi on paper, still
// sharp when zoomed), cropped the way object-fit: cover shows it, and
// re-encoded as JPEG. Chrome then embeds that small JPEG in the PDF as it is.
const PHOTO_SCALE = 2;
const PHOTO_QUALITY = 0.72;

async function compressPhotos(page) {
  return page.evaluate(
    async (scale, quality) => {
      const imgs = Array.from(document.querySelectorAll("img")).filter((img) =>
        /^data:image\/(jpeg|jpg|png|webp)/i.test(img.getAttribute("src") || "")
      );
      let before = 0;
      let after = 0;
      for (const img of imgs) {
        try {
          if (!img.complete) await img.decode();
          const box = img.getBoundingClientRect();
          const bw = Math.round(box.width * scale);
          const bh = Math.round(box.height * scale);
          const nw = img.naturalWidth;
          const nh = img.naturalHeight;
          if (!bw || !bh || !nw || !nh) continue;
          // Crop like object-fit: cover, then scale down (never up).
          const target = bw / bh;
          let sw = nw;
          let sh = nh;
          if (nw / nh > target) sw = Math.round(nh * target);
          else sh = Math.round(nw / target);
          const sx = Math.round((nw - sw) / 2);
          const sy = Math.round((nh - sh) / 2);
          const w = Math.min(bw, sw);
          const h = Math.min(bh, sh);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
          const src = img.getAttribute("src");
          const out = canvas.toDataURL("image/jpeg", quality);
          before += src.length;
          if (out.length < src.length) {
            img.setAttribute("src", out);
            after += out.length;
            if (!img.complete) await img.decode();
          } else after += src.length;
        } catch (e) {
          // Leave a photo that can't be redrawn as it was.
        }
      }
      return { photos: imgs.length, before, after };
    },
    PHOTO_SCALE,
    PHOTO_QUALITY
  );
}

/** HTML → PDF bytes, running the page engine (lib/layout.mjs) first. */
export async function renderPdf(html, launch = browser) {
  const b = await launch();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    // Photos are measured inside #source, before the page engine moves them.
    const photoBytes = await compressPhotos(page);
    const pages = await page.evaluate(() => window.__paginate());
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 60000,
      // No accessibility tree or outline: they only add size to a print report.
      tagged: false,
      outline: false,
    });
    return { pdf: Buffer.from(pdf), pages, photoBytes };
  } finally {
    await page.close().catch(() => {});
  }
}

