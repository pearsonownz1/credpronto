import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SAMPLE_COVER_INPUT } from "../src/lib/orders/pdf/cover-sample";
import { renderPdfPagePng } from "../src/lib/orders/pdf/raster";
import { renderCertificationPdf } from "../src/lib/orders/pdf/render";

const pdf = await renderCertificationPdf(SAMPLE_COVER_INPUT);
const png = await renderPdfPagePng(pdf);
const out = path.join(process.cwd(), "public/samples/cover-cert-sample.png");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.byteLength} bytes)`);
