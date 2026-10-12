import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
const destination = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/pdfjs");

await mkdir(destination, { recursive: true });
await cp(path.join(root, "build/pdf.worker.min.mjs"), path.join(destination, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(path.join(root, dir), path.join(destination, dir), { recursive: true });
}
console.log("Copied pdf.js worker and assets to public/pdfjs");
