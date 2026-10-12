import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = require.resolve("@embedpdf/pdfium/pdfium.wasm");
const destinationDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/pdfium",
);
const destination = path.join(destinationDir, "pdfium.wasm");

await mkdir(destinationDir, { recursive: true });
await copyFile(source, destination);
console.log(`Copied PDFium WASM to ${path.relative(process.cwd(), destination)}`);
