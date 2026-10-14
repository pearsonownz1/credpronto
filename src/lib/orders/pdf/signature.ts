import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE_PATH = path.join(process.cwd(), "src/lib/orders/pdf/signature.png");

/** Drawn width of the owner signature. 180 CSS pixels on a letter page. */
export const OWNER_SIGNATURE_WIDTH_PT = (180 * 72) / 96;

export const SIGN_ROLE_TRANSLATOR = "Certified Translator";
export const SIGN_ROLE_EVALUATOR = "Credential Evaluator";

const INK_R = 0x1a;
const INK_G = 0x1f;
const INK_B = 0x36;

type Rgba = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

let tintedCache: Uint8Array | null = null;

export function loadOwnerSignature(): Uint8Array {
  return new Uint8Array(readFileSync(SIGNATURE_PATH));
}

/** Grayscale ink recolored to #1a1f36. Alpha stays the ink coverage. */
export function tintSignaturePng(png: Uint8Array): Uint8Array {
  const image = decodePng(png);
  const tinted = new Uint8Array(image.width * image.height * 4);
  for (let i = 0; i < image.pixels.length; i += 4) {
    const red = image.pixels[i] ?? 0;
    const green = image.pixels[i + 1] ?? 0;
    const blue = image.pixels[i + 2] ?? 0;
    const alpha = image.pixels[i + 3] ?? 0;
    const luminance = (red + green + blue) / (3 * 255);
    const coverage = Math.round((alpha / 255) * (1 - luminance) * 255);
    tinted[i] = INK_R;
    tinted[i + 1] = INK_G;
    tinted[i + 2] = INK_B;
    tinted[i + 3] = coverage;
  }
  return encodeRgbaPng(image.width, image.height, tinted);
}

export function loadTintedOwnerSignature(): Uint8Array {
  if (!tintedCache) tintedCache = tintSignaturePng(loadOwnerSignature());
  return tintedCache;
}

export function ownerSignatureSize(image: { width: number; height: number }): { width: number; height: number } {
  const width = Math.min(OWNER_SIGNATURE_WIDTH_PT, image.width);
  const height = width * (image.height / image.width);
  return { width, height };
}

/** Space from the top of the signature image through the role label. */
export function ownerSignatureBlockHeight(image: { width: number; height: number }): number {
  return ownerSignatureSize(image).height + 20;
}

export type SignOffLayout = {
  image: { x: number; y: number; width: number; height: number };
  lineY: number;
  leftLineEnd: number;
  rightX: number;
  rightLineEnd: number;
  roleY: number;
  dateY: number;
};

export function signOffLayout(args: {
  image: { width: number; height: number };
  top: number;
  left: number;
  contentWidth: number;
  pageRight: number;
}): SignOffLayout {
  const gap = 24;
  const leftWidth = args.contentWidth * 0.58;
  const fitted = ownerSignatureSize(args.image);
  const width = Math.min(fitted.width, leftWidth - 8);
  const height = width * (args.image.height / args.image.width);
  const lineY = args.top - height - 4;
  return {
    image: { x: args.left, y: lineY + 3, width, height },
    lineY,
    leftLineEnd: args.left + leftWidth,
    rightX: args.left + leftWidth + gap,
    rightLineEnd: args.pageRight,
    roleY: lineY - 12,
    dateY: lineY + 6,
  };
}

function decodePng(png: Uint8Array): Rgba {
  if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50) throw new Error("Signature is not a PNG");
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = readUint32(png, offset);
    const type = String.fromCharCode(png[offset + 4] ?? 0, png[offset + 5] ?? 0, png[offset + 6] ?? 0, png[offset + 7] ?? 0);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > png.length) throw new Error("Signature PNG is truncated");
    const data = png.subarray(start, end);
    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0) throw new Error("Signature PNG is not an 8-bit image");
  const channels = channelsFor(colorType);
  const inflated = inflateSync(concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  let cursor = 0;
  const previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor] ?? 0;
    cursor += 1;
    const row = inflated.subarray(cursor, cursor + stride);
    cursor += stride;
    const raw = unfilter(filter, row, previous, channels);
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dest = (y * width + x) * 4;
      const rgba = toRgba(raw, src, colorType);
      pixels[dest] = rgba[0];
      pixels[dest + 1] = rgba[1];
      pixels[dest + 2] = rgba[2];
      pixels[dest + 3] = rgba[3];
    }
    previous.set(raw);
  }
  return { width, height, pixels };
}

function channelsFor(colorType: number): number {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error("Signature PNG color type is unsupported");
}

function toRgba(row: Uint8Array, src: number, colorType: number): [number, number, number, number] {
  if (colorType === 0) {
    const gray = row[src] ?? 0;
    return [gray, gray, gray, 255];
  }
  if (colorType === 2) return [row[src] ?? 0, row[src + 1] ?? 0, row[src + 2] ?? 0, 255];
  if (colorType === 4) {
    const gray = row[src] ?? 0;
    return [gray, gray, gray, row[src + 1] ?? 0];
  }
  return [row[src] ?? 0, row[src + 1] ?? 0, row[src + 2] ?? 0, row[src + 3] ?? 0];
}

function unfilter(filter: number, row: Uint8Array, previous: Uint8Array, channels: number): Uint8Array {
  const raw = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= channels ? raw[i - channels] ?? 0 : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= channels ? previous[i - channels] ?? 0 : 0;
    const value = row[i] ?? 0;
    if (filter === 0) raw[i] = value;
    else if (filter === 1) raw[i] = (value + left) & 255;
    else if (filter === 2) raw[i] = (value + up) & 255;
    else if (filter === 3) raw[i] = (value + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) raw[i] = (value + paeth(left, up, upLeft)) & 255;
    else throw new Error("Signature PNG filter is unsupported");
  }
  return raw;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), row + 1);
  }
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = Uint8Array.from(type, (char) => char.charCodeAt(0));
  const body = concat([name, data]);
  const out = new Uint8Array(4 + body.length + 4);
  writeUint32(out, 0, data.length);
  out.set(body, 4);
  writeUint32(out, 4 + body.length, crc32(body));
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) << 24) |
    ((data[offset + 1] ?? 0) << 16) |
    ((data[offset + 2] ?? 0) << 8) |
    (data[offset + 3] ?? 0)
  ) >>> 0;
}

function writeUint32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 255;
  data[offset + 1] = (value >>> 16) & 255;
  data[offset + 2] = (value >>> 8) & 255;
  data[offset + 3] = value & 255;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
