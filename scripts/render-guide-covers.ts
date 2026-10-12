/**
 * Render 1200×630 guide covers to public/guides/covers/<slug>.png.
 *
 * Usage: node --experimental-strip-types scripts/render-guide-covers.ts
 *
 * The shared markup lives in scripts/guide-cover-template.html. This script
 * substitutes TITLE and SVG, copies public/brand/credpronto-logo.svg in place
 * of the template's credpronto-logo.svg, and loads Manrope before the shot.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";

const ROOT = process.cwd();
const TEMPLATE_PATH = path.join(ROOT, "scripts/guide-cover-template.html");
const LOGO_PATH = path.join(ROOT, "public/brand/credpronto-logo.svg");
const FONT_PATH = path.join(ROOT, "scripts/fonts/manrope-latin.woff2");
const OUT_DIR = path.join(ROOT, "public/guides/covers");

const GREY_LINES: ReadonlyArray<readonly [number, number]> = [
  [70, 156],
  [92, 126],
  [114, 96],
  [136, 156],
  [158, 126],
  [180, 96],
];

const SIG =
  '<path d="M22 225c18-20 30 8 46-6s20-14 34 2" stroke="#1F5EFF" stroke-width="3" fill="none"/><rect x="22" y="236" width="110" height="2" fill="#0B1220"/>';

const CHECK =
  '<circle r="30" fill="#1F5EFF"/><path d="M-13 1l9 9 17-19" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';

type Cover = { slug: string; title: string; svg: string };

function doc(fill = "#fff", lines = 6): string {
  const bars = GREY_LINES.slice(0, lines)
    .map(([y, width]) => `<rect x="22" y="${y}" width="${width}" height="8" rx="2" fill="#E3E8F2"/>`)
    .join("");
  return `<rect width="200" height="260" rx="4" fill="${fill}" stroke="#D5DCE8"/><rect x="22" y="28" width="90" height="12" rx="2" fill="#0B1220"/>${bars}`;
}

function g(transform: string, inner: string): string {
  return `<g transform="${transform}">${inner}</g>`;
}

function checkRow(y: number, width: number): string {
  return g(
    `translate(320,${y})`,
    `<rect width="26" height="26" rx="4" fill="#1F5EFF"/><path d="M6 13l5 5 9-10" stroke="#fff" stroke-width="3" fill="none"/><rect x="40" y="9" width="${width}" height="8" rx="2" fill="#C7D3EE"/>`,
  );
}

function numberRow(y: number, n: number, width: number): string {
  return g(
    `translate(300,${y})`,
    `<circle cx="13" cy="13" r="13" fill="#1F5EFF"/><text x="13" y="18" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">${n}</text><rect x="38" y="9" width="${width}" height="8" rx="2" fill="#C7D3EE"/>`,
  );
}

const COVERS: Cover[] = [
  {
    slug: "uscis-certified-translation",
    title: "Does USCIS require a certified translation?",
    svg: [
      g("translate(40,30) rotate(-6)", doc("#fff")),
      g("translate(150,20) rotate(4)", doc("#fff") + SIG),
      g("translate(330,250)", CHECK),
    ].join(""),
  },
  {
    slug: "certified-vs-notarized-translation",
    title: "Certified vs. notarized translation",
    svg: [
      g("translate(10,40) rotate(-4)", doc() + SIG),
      g("translate(210,40) rotate(4)", doc() + SIG),
      g("translate(170,280) scale(0.8)", CHECK),
      g(
        "translate(380,270)",
        '<circle r="34" fill="none" stroke="#0B1220" stroke-width="3" stroke-dasharray="4 3"/><circle r="24" fill="#0B1220"/><text y="5" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">NOTARY</text>',
      ),
    ].join(""),
  },
  {
    slug: "birth-certificate-translation-uscis",
    title: "Birth certificate translation for USCIS",
    svg: [
      g(
        "translate(30,30) rotate(-5)",
        doc("#FBF8EF") + '<circle cx="150" cy="215" r="22" fill="none" stroke="#C9A24A" stroke-width="3"/>',
      ),
      g("translate(170,30) rotate(4)", doc("#fff") + SIG),
      g("translate(350,260)", CHECK),
    ].join(""),
  },
  {
    slug: "prepare-a-document-for-translation",
    title: "How to prepare a document for translation",
    svg: [
      g(
        "translate(80,30)",
        doc("#fff", 4) +
          '<rect x="10" y="10" width="180" height="240" fill="none" stroke="#1F5EFF" stroke-width="3" stroke-dasharray="10 7"/>',
      ),
      checkRow(70, 90),
      checkRow(130, 75),
      checkRow(190, 60),
    ].join(""),
  },
  {
    slug: "preview-your-translation-before-you-pay",
    title: "Preview your translation before you pay",
    svg: [
      g("translate(20,40)", doc()),
      g(
        "translate(230,40)",
        doc() +
          '<text x="100" y="170" text-anchor="middle" transform="rotate(-28 100 150)" font-size="30" font-weight="800" fill="#1F5EFF" opacity=".25">PREVIEW</text>',
      ),
      g(
        "translate(205,170)",
        '<circle r="22" fill="#1F5EFF"/><path d="M-7 0h14M2-6l6 6-6 6" stroke="#fff" stroke-width="3" fill="none"/>',
      ),
    ].join(""),
  },
  {
    slug: "what-a-certified-translation-includes",
    title: "What a certified translation includes",
    svg: [
      g("translate(60,20)", doc("#fff", 5) + SIG),
      numberRow(60, 1, 110),
      numberRow(118, 2, 98),
      numberRow(176, 3, 86),
      numberRow(234, 4, 74),
    ].join(""),
  },
];

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A live guide is a content file that is not marked draft. */
function liveGuideFile(slug: string): string | null {
  const dir = path.join(ROOT, "content/guides");
  for (const ext of [".md", ".mdx"] as const) {
    const file = path.join(dir, `${slug}${ext}`);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (frontmatter && /^draft:\s*true\s*$/m.test(frontmatter[1])) {
      console.log(`Skipping ${slug}: content/guides/${slug}${ext} is a draft, not a live guide.`);
      return null;
    }
    return file;
  }
  console.log(`Skipping ${slug}: no content/guides/${slug}.md or content/guides/${slug}.mdx.`);
  return null;
}

function renderHtml(template: string, title: string, svg: string): string {
  const titleMarker = ">TITLE</div>";
  const svgMarker = ">SVG</svg>";
  if (!template.includes(titleMarker) || !template.includes(svgMarker)) {
    throw new Error("guide cover template is missing TITLE or SVG placeholders");
  }
  if (!template.includes('src="credpronto-logo.svg"')) {
    throw new Error("guide cover template is missing credpronto-logo.svg");
  }
  const body = template
    .replace(titleMarker, `>${escapeHtml(title)}</div>`)
    .replace(svgMarker, `>${svg}</svg>`);
  return `<!DOCTYPE html>${body.replace(
    "<html>",
    `<html><head><style>
@font-face {
  font-family: Manrope;
  font-style: normal;
  font-weight: 400 800;
  font-display: block;
  src: url("manrope-latin.woff2") format("woff2");
}
</style></head>`,
  )}`;
}

function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return chromium.launch();
  }
}

async function main(): Promise<void> {
  for (const file of [TEMPLATE_PATH, LOGO_PATH, FONT_PATH]) {
    if (!existsSync(file)) throw new Error(`Missing ${file}`);
  }
  const template = readFileSync(TEMPLATE_PATH, "utf8").trim();
  const work = mkdtempSync(path.join(tmpdir(), "guide-covers-"));
  copyFileSync(LOGO_PATH, path.join(work, "credpronto-logo.svg"));
  copyFileSync(FONT_PATH, path.join(work, "manrope-latin.woff2"));
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  let rendered = 0;

  try {
    for (const cover of COVERS) {
      const source = liveGuideFile(cover.slug);
      if (!source) continue;
      const htmlPath = path.join(work, `${cover.slug}.html`);
      writeFileSync(htmlPath, renderHtml(template, cover.title, cover.svg));
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const ready = await page.evaluate(() => {
        const img = document.querySelector("img");
        return {
          font: document.fonts.check("800 52px Manrope"),
          logo: Boolean(img && img.complete && img.naturalWidth > 0),
        };
      });
      if (!ready.font) throw new Error(`${cover.slug}: Manrope did not load`);
      if (!ready.logo) throw new Error(`${cover.slug}: credpronto logo did not load`);
      const out = path.join(OUT_DIR, `${cover.slug}.png`);
      const png = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: 1200, height: 630 },
      });
      const size = pngSize(png);
      if (size.width !== 1200 || size.height !== 630) {
        throw new Error(`${cover.slug}: expected 1200×630, got ${size.width}×${size.height}`);
      }
      writeFileSync(out, png);
      console.log(`Wrote ${path.relative(ROOT, out)} from ${path.relative(ROOT, source)}`);
      rendered += 1;
    }
  } finally {
    await browser.close();
  }

  if (rendered === 0) throw new Error("No guide covers were rendered");
  console.log(`Rendered ${rendered} cover${rendered === 1 ? "" : "s"}.`);
}

await main();
