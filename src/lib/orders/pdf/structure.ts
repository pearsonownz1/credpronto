import { blockAlign, blockColumn, type FieldRow, type RenderBlock } from "./layout";
import { joinedLetterParagraph } from "./source-mirror";

export type TextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
};

type Role = "heading" | "section" | "field" | "signature";

type Entry = {
  english: string;
  role: Role;
};

const ENTRIES: { key: string; entry: Entry }[] = [
  { key: "ESTADOS UNIDOS MEXICANOS", entry: { english: "United Mexican States", role: "heading" } },
  { key: "UNITED MEXICAN STATES", entry: { english: "United Mexican States", role: "heading" } },
  { key: "ACTA DE NACIMIENTO", entry: { english: "Birth certificate", role: "heading" } },
  { key: "BIRTH CERTIFICATE", entry: { english: "Birth certificate", role: "heading" } },
  { key: "DATOS DEL REGISTRO", entry: { english: "Registration data", role: "section" } },
  { key: "REGISTRATION DATA", entry: { english: "Registration data", role: "section" } },
  { key: "DATOS DE LA PERSONA REGISTRADA", entry: { english: "Registered person", role: "section" } },
  { key: "REGISTERED PERSON", entry: { english: "Registered person", role: "section" } },
  { key: "DATOS DE FILIACION DE LA PERSONA REGISTRADA", entry: { english: "Parentage", role: "section" } },
  { key: "PARENTAGE", entry: { english: "Parentage", role: "section" } },
  { key: "ANOTACIONES MARGINALES", entry: { english: "Marginal notes", role: "section" } },
  { key: "MARGINAL NOTES", entry: { english: "Marginal notes", role: "section" } },
  { key: "CLAVE UNICA DE REGISTRO DE POBLACION (CURP)", entry: { english: "CURP", role: "field" } },
  { key: "UNIQUE POPULATION REGISTRY CODE (CURP)", entry: { english: "CURP", role: "field" } },
  { key: "IDENTIFICADOR ELECTRONICO", entry: { english: "Electronic identifier", role: "field" } },
  { key: "ELECTRONIC IDENTIFIER", entry: { english: "Electronic identifier", role: "field" } },
  { key: "ENTIDAD DE REGISTRO", entry: { english: "Entity of registration", role: "field" } },
  { key: "ENTITY OF REGISTRATION", entry: { english: "Entity of registration", role: "field" } },
  { key: "MUNICIPIO DE REGISTRO", entry: { english: "Municipality of registration", role: "field" } },
  { key: "MUNICIPALITY OF REGISTRATION", entry: { english: "Municipality of registration", role: "field" } },
  { key: "OFICIALIA", entry: { english: "Registry office", role: "field" } },
  { key: "REGISTRY OFFICE", entry: { english: "Registry office", role: "field" } },
  { key: "FECHA DE REGISTRO", entry: { english: "Date of registration", role: "field" } },
  { key: "DATE OF REGISTRATION", entry: { english: "Date of registration", role: "field" } },
  { key: "LIBRO", entry: { english: "Book", role: "field" } },
  { key: "BOOK", entry: { english: "Book", role: "field" } },
  { key: "NUMERO DE ACTA", entry: { english: "Certificate number", role: "field" } },
  { key: "CERTIFICATE NUMBER", entry: { english: "Certificate number", role: "field" } },
  { key: "NOMBRE(S)", entry: { english: "First name(s)", role: "field" } },
  { key: "FIRST NAME(S)", entry: { english: "First name(s)", role: "field" } },
  { key: "GIVEN NAME(S)", entry: { english: "First name(s)", role: "field" } },
  { key: "PRIMER APELLIDO", entry: { english: "First surname", role: "field" } },
  { key: "FIRST SURNAME", entry: { english: "First surname", role: "field" } },
  { key: "SEGUNDO APELLIDO", entry: { english: "Second surname", role: "field" } },
  { key: "SECOND SURNAME", entry: { english: "Second surname", role: "field" } },
  { key: "SEXO", entry: { english: "Sex", role: "field" } },
  { key: "SEX", entry: { english: "Sex", role: "field" } },
  { key: "FECHA DE NACIMIENTO", entry: { english: "Date of birth", role: "field" } },
  { key: "DATE OF BIRTH", entry: { english: "Date of birth", role: "field" } },
  { key: "LUGAR DE NACIMIENTO", entry: { english: "Place of birth", role: "field" } },
  { key: "PLACE OF BIRTH", entry: { english: "Place of birth", role: "field" } },
  { key: "PROGENITORA", entry: { english: "Parent", role: "field" } },
  { key: "PROGENITOR", entry: { english: "Parent", role: "field" } },
  { key: "PARENT", entry: { english: "Parent", role: "field" } },
  { key: "NOMBRE", entry: { english: "Name", role: "field" } },
  { key: "NAME", entry: { english: "Name", role: "field" } },
  { key: "EDAD", entry: { english: "Age", role: "field" } },
  { key: "AGE", entry: { english: "Age", role: "field" } },
  { key: "NACIONALIDAD", entry: { english: "Nationality", role: "field" } },
  { key: "NATIONALITY", entry: { english: "Nationality", role: "field" } },
  { key: "CURP", entry: { english: "CURP", role: "field" } },
  { key: "CADENA ORIGINAL", entry: { english: "Original string", role: "field" } },
  { key: "ORIGINAL STRING", entry: { english: "Original string", role: "field" } },
  { key: "FIRMA ELECTRONICA AVANZADA", entry: { english: "Electronic signature", role: "signature" } },
  { key: "ADVANCED ELECTRONIC SIGNATURE", entry: { english: "Electronic signature", role: "signature" } },
  { key: "FIRMA ELECTRONICA", entry: { english: "Electronic signature", role: "signature" } },
  { key: "ELECTRONIC SIGNATURE", entry: { english: "Electronic signature", role: "signature" } },
  { key: "FIRMA", entry: { english: "Signature", role: "signature" } },
  { key: "SIGNATURE", entry: { english: "Signature", role: "signature" } },
  { key: "出生医学证明", entry: { english: "Medical certificate of birth", role: "heading" } },
  { key: "MEDICAL CERTIFICATE OF BIRTH", entry: { english: "Medical certificate of birth", role: "heading" } },
  { key: "编号", entry: { english: "No.", role: "field" } },
  { key: "NO", entry: { english: "No.", role: "field" } },
  { key: "新生儿姓名", entry: { english: "Neonate", role: "field" } },
  { key: "母亲姓名", entry: { english: "Mother", role: "field" } },
  { key: "父亲姓名", entry: { english: "Father", role: "field" } },
  { key: "性别", entry: { english: "Sex", role: "field" } },
  { key: "出生时间", entry: { english: "Time of birth", role: "field" } },
  { key: "出生地点", entry: { english: "Place of birth", role: "field" } },
  { key: "出生孕周", entry: { english: "Gestational age", role: "field" } },
  { key: "出生体重", entry: { english: "Birth weight", role: "field" } },
  { key: "身长", entry: { english: "Length", role: "field" } },
  { key: "医疗机构名称", entry: { english: "Medical institution", role: "field" } },
  { key: "国籍", entry: { english: "Nationality", role: "field" } },
  { key: "民族", entry: { english: "Ethnicity", role: "field" } },
  { key: "住址", entry: { english: "Address", role: "field" } },
  { key: "有效身份证件号码", entry: { english: "ID number", role: "field" } },
  { key: "姓名", entry: { english: "Name", role: "field" } },
];

const VALUE_WORDS: Record<string, string> = {
  MUJER: "Female",
  HOMBRE: "Male",
  FEMENINO: "Female",
  MASCULINO: "Male",
  MEXICANA: "Mexican",
  MEXICANO: "Mexican",
  PADRE: "Father",
  MADRE: "Mother",
  女: "Female",
  男: "Male",
};

const MONTHS: Record<string, string> = {
  enero: "January",
  febrero: "February",
  marzo: "March",
  abril: "April",
  mayo: "May",
  junio: "June",
  julio: "July",
  agosto: "August",
  septiembre: "September",
  octubre: "October",
  noviembre: "November",
  diciembre: "December",
};

const KEYS_BY_LENGTH = [...ENTRIES].sort((a, b) => b.key.length - a.key.length);

const RADICALS: Record<string, string> = {
  "\u2ea0": "民",
  "\u2ed8": "青",
  "\u2ed3": "长",
};

/** Kangxi radicals in the text layer become the unified ideograph they stand for. */
export function normalizeText(text: string): string {
  const mapped = Array.from(text.normalize("NFKC"), (char) => RADICALS[char] ?? char).join("");
  const tokens = mapped.trim().split(/\s+/);
  const singles = tokens.filter((token) => Array.from(token).length === 1).length;
  const spaced =
    tokens.length >= 4 && singles / tokens.length >= 0.6
      ? tokens.map((token) => (Array.from(token).length <= 2 && /^[\p{L}]+$/u.test(token) ? Array.from(token).join(" ") : token)).join(" ")
      : mapped;
  return collapseLetterSpacing(spaced).replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "$1");
}

export function foldKey(text: string): string {
  return normalizeText(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}()]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lookup(text: string): Entry | null {
  const key = foldKey(text);
  const exact = ENTRIES.find((item) => item.key === key)?.entry;
  if (exact) return exact;
  const squashed = key.replace(/ /g, "");
  if (squashed.length < 80 && squashed.includes("MEDICALCERTIFICATEOFBIRTH")) {
    return { english: "Medical certificate of birth", role: "heading" };
  }
  return null;
}

/** English document type when the source line is a known title, such as a birth certificate. */
export function documentHeading(text: string): string | null {
  const direct = lookup(text);
  if (direct?.role === "heading") return direct.english;
  for (const line of text.split(/\n+/)) {
    const hit = lookup(line);
    if (hit?.role === "heading") return hit.english;
  }
  return null;
}

function titleWord(text: string): string {
  const word = text.trim().split(/\s+/)[0] ?? text;
  if (!word) return text.trim();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseLabel(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/(^|[\s/(])(\p{L})/gu, (_match, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

export function collapseLetterSpacing(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 4) return trimmed.replace(/[ \t]+/g, " ");
  const singles = tokens.filter((token) => Array.from(token).length === 1);
  if (singles.length / tokens.length < 0.75) return trimmed.replace(/[ \t]+/g, " ");

  let out = "";
  for (const part of trimmed.match(/\S+|\s+/g) ?? []) {
    if (/^\s+$/.test(part)) {
      if (part.length >= 2 && out && !out.endsWith(" ")) out += " ";
      continue;
    }
    if (Array.from(part).length === 1) {
      out += part;
    } else {
      if (out && !out.endsWith(" ")) out += " ";
      out += part;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

export function isElectronicSignatureToken(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 40) return false;
  return /^[A-Za-z0-9+/=._-]+$/.test(compact);
}

export function sealCaptionFromText(text: string): string {
  const flat = collapseLetterSpacing(text).replace(/\s+/g, " ");
  const match =
    flat.match(/registro civil del estado de\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/i) ||
    flat.match(/civil registry of(?: the state of)?\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/i);
  if (match?.[1]) return `Civil Registry of ${titleWord(match[1])}`;
  if (/registro civil|civil registry/i.test(flat)) return "Civil Registry";
  return "Official seal";
}

function isFictionalWatermark(text: string): boolean {
  return /FICTIONAL TEST DOCUMENT/i.test(text);
}

function isSealMaterial(text: string): boolean {
  const folded = foldKey(text);
  if (["ESCUDO", "GENERICO", "SAMPLE", "(SAMPLE)", "SELLO", "STAMP", "COAT OF ARMS"].includes(folded)) {
    return true;
  }
  const collapsed = foldKey(collapseLetterSpacing(text));
  if (collapsed === "CIVIL REGISTRY" || collapsed === "REGISTRO CIVIL") return true;
  const tight = collapsed.replace(/ /g, "");
  if (/OFICIALIA/.test(tight) && (tight.includes("SAMPLE") || /\d/.test(tight))) return true;
  if (Array.from(text.trim()).length === 1 && /[★☆✶*]/.test(text)) return true;
  return false;
}

function isAllCapsLabel(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 70) return false;
  if (/\p{Ll}/u.test(trimmed)) return false;
  if (!/\p{Lu}/u.test(trimmed)) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const digits = trimmed.match(/\d/g)?.length ?? 0;
  if (digits > trimmed.length / 2) return false;
  return true;
}

function isProse(text: string): boolean {
  const trimmed = text.trim();
  if (/[.!?]$/.test(trimmed) && trimmed.length > 20) return true;
  const lower = trimmed.match(/\p{Ll}/gu)?.length ?? 0;
  return lower >= 8 && trimmed.length > 40;
}

function translateValue(value: string): string {
  const trimmed = normalizeText(value.trim());
  return VALUE_WORDS[foldKey(trimmed)] ?? trimmed;
}

function translateSpanishDate(text: string): string {
  return text.replace(/a\s+(\d{1,2})\s+de\s+([A-Za-záéíóúñ]+)\s+de\s+(\d{4})/i, (full, day: string, month: string, year: string) => {
    const name = MONTHS[month.toLowerCase()];
    if (!name) return full;
    return `${name} ${Number(day)}, ${year}`;
  });
}

function translateProse(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (/^sin anotaciones marginales\.?$/i.test(flat)) return "No marginal notes.";
  if (/el suscrito,\s+oficial del registro civil,\s+certifica/i.test(flat)) {
    return "The undersigned Civil Registry officer certifies that this is a true copy of the record on file at this office, issued at the request of the interested party for all legal purposes.";
  }
  const subtitle = flat.match(/^registro civil del estado de\s+(.+?)\s*·\s*copia certificada$/i);
  if (subtitle?.[1]) return `Civil Registry of the State of ${titleWord(subtitle[1])} · Certified copy`;
  const officer = flat.match(/^oficial del registro civil\s*·\s*(.+)$/i);
  if (officer?.[1]) return `Civil Registry officer · ${translateSpanishDate(officer[1])}`;
  const verify = flat.match(/^verifique en:\s*(.+)$/i);
  if (verify?.[1]) return `Verify at: ${verify[1]}`;
  const bracket = flat.match(/^\[(Seal|Signature|Electronic signature):\s*(.*)\]$/i);
  if (bracket) return flat;
  return flat;
}

function coalesce(blocks: RenderBlock[]): RenderBlock[] {
  const out: RenderBlock[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (block.type === "fields" && prev?.type === "fields") {
      prev.rows = [...prev.rows, ...block.rows];
      continue;
    }
    if (
      block.type === "signature" &&
      prev?.type === "signature" &&
      prev.electronic === block.electronic &&
      !prev.lines?.length &&
      !block.lines?.length &&
      !prev.column &&
      !block.column
    ) {
      continue;
    }
    if (block.type === "seal" && prev?.type === "seal" && prev.text === block.text && prev.column === block.column) {
      continue;
    }
    if (block.type === "paragraph" && prev?.type === "paragraph" && prev.text === block.text) {
      continue;
    }
    if (block.type === "heading" && prev?.type === "heading" && prev.text === block.text) {
      continue;
    }
    out.push(block.type === "fields" ? { type: "fields", rows: [...block.rows] } : block);
  }
  return out;
}

function refineSeal(blocks: RenderBlock[]): RenderBlock[] {
  const entity = blocks
    .flatMap((block) => (block.type === "fields" ? block.rows : []))
    .find((row) => /entity of registration/i.test(row.label));
  if (!entity?.value.trim()) return blocks;
  const place = titleWord(entity.value);
  return blocks.map((block) => {
    if (block.type !== "seal") return block;
    if (/\sof\s/i.test(block.text)) return block;
    return { ...block, text: `Civil Registry of ${place}` };
  });
}

function foldWithMap(text: string): { folded: string; map: number[] } {
  const folded: string[] = [];
  const map: number[] = [];
  let utf16 = 0;
  for (const char of Array.from(text)) {
    const base = char.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
    if (/[A-Z0-9()]/.test(base)) {
      for (const piece of base) {
        folded.push(piece);
        map.push(utf16);
      }
    } else if (folded.length && folded[folded.length - 1] !== " ") {
      folded.push(" ");
      map.push(utf16);
    }
    utf16 += char.length;
  }
  return { folded: folded.join(""), map };
}

function splitRunOn(line: string): RenderBlock[] | null {
  const { folded, map } = foldWithMap(line);
  type Hit = { start: number; end: number; entry: Entry };
  const hits: Hit[] = [];
  for (const { key, entry } of KEYS_BY_LENGTH) {
    let from = 0;
    while (from < folded.length) {
      const at = folded.indexOf(key, from);
      if (at < 0) break;
      const before = at === 0 || /[^A-Z0-9]/.test(folded[at - 1] ?? "");
      const afterAt = at + key.length;
      const after = afterAt >= folded.length || /[^A-Z0-9]/.test(folded[afterAt] ?? "");
      if (before && after) hits.push({ start: at, end: afterAt, entry });
      from = at + Math.max(1, key.length);
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const taken: Hit[] = [];
  for (const hit of hits) {
    if (taken.some((other) => hit.start < other.end && hit.end > other.start)) continue;
    taken.push(hit);
  }
  taken.sort((a, b) => a.start - b.start);
  if (taken.filter((hit) => hit.entry.role === "field").length < 2) return null;

  const slice = (start: number, end: number) => line.slice(map[start] ?? line.length, end >= folded.length ? line.length : (map[end] ?? line.length)).trim();
  const blocks: RenderBlock[] = [];
  const rows: FieldRow[] = [];
  const flush = () => {
    if (!rows.length) return;
    blocks.push({ type: "fields", rows: [...rows] });
    rows.length = 0;
  };
  if (taken[0] && taken[0].start > 0) {
    const prefix = slice(0, taken[0].start);
    if (prefix) blocks.push({ type: "paragraph", text: translateProse(prefix) });
  }
  for (let index = 0; index < taken.length; index += 1) {
    const hit = taken[index];
    const next = taken[index + 1];
    const value = slice(hit.end, next ? next.start : folded.length);
    if (hit.entry.role === "heading" || hit.entry.role === "section") {
      flush();
      blocks.push({
        type: "heading",
        text: hit.entry.english,
        level: hit.entry.role === "heading" ? 1 : 2,
      });
      if (value && isProse(value)) blocks.push({ type: "paragraph", text: translateProse(value) });
      continue;
    }
    if (hit.entry.role === "signature") {
      flush();
      if (!isElectronicSignatureToken(value)) {
        blocks.push({ type: "signature", electronic: /electron/i.test(hit.entry.english) });
      } else {
        blocks.push({ type: "signature", electronic: true });
      }
      continue;
    }
    rows.push({ label: hit.entry.english, value: translateValue(value) });
  }
  flush();
  return blocks;
}

function preprocessLines(text: string): string[] {
  const raw = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 4) out.push(run.join(""));
    else for (const glyph of run) out.push(glyph);
    run = [];
  };
  for (const line of raw) {
    if (Array.from(line).length === 1) {
      run.push(line);
      continue;
    }
    flush();
    out.push(collapseLetterSpacing(line));
  }
  flush();
  return out;
}

/** Line-preserving or run-on translation text → blocks in original order. */
export function structurePage(text: string): RenderBlock[] {
  const lines = preprocessLines(text);
  const caption = sealCaptionFromText(text);
  const blocks: RenderBlock[] = [];
  let rows: FieldRow[] = [];
  let sealInserted = false;
  const flush = () => {
    if (!rows.length) return;
    blocks.push({ type: "fields", rows: [...rows] });
    rows = [];
  };
  const insertSeal = () => {
    if (sealInserted) return;
    sealInserted = true;
    flush();
    blocks.push({ type: "seal", text: caption });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isFictionalWatermark(line)) continue;
    if (isSealMaterial(line)) {
      insertSeal();
      continue;
    }
    const sealNote = line.match(/^\[Seal:\s*(.+)\]$/i);
    if (sealNote?.[1]) {
      flush();
      blocks.push({ type: "seal", text: cleanSealText(sealNote[1]) });
      sealInserted = true;
      continue;
    }
    const signatureNote = line.match(/^\[(Electronic signature|Signature)\]$/i);
    if (signatureNote) {
      flush();
      blocks.push({ type: "signature", electronic: /electronic/i.test(signatureNote[1] ?? "") });
      continue;
    }
    if (isElectronicSignatureToken(line)) {
      flush();
      blocks.push({ type: "signature", electronic: true });
      continue;
    }
    const entry = lookup(line);
    if (entry?.role === "signature") {
      flush();
      const electronic = /electron/i.test(entry.english) || /electron/i.test(foldKey(line));
      while (index + 1 < lines.length && isElectronicSignatureToken(lines[index + 1] ?? "")) index += 1;
      blocks.push({ type: "signature", electronic });
      continue;
    }
    if (entry?.role === "heading" || entry?.role === "section") {
      flush();
      blocks.push({ type: "heading", text: entry.english, level: entry.role === "heading" ? 1 : 2 });
      continue;
    }
    const colon = line.match(/^([^:]{2,80}):\s+(\S.*)$/);
    if (colon) {
      const colonEntry = lookup(colon[1] ?? "");
      if (colonEntry?.role === "field" || isAllCapsLabel(colon[1] ?? "")) {
        rows.push({
          label: colonEntry?.english ?? titleCaseLabel(colon[1] ?? ""),
          value: translateValue(colon[2] ?? ""),
        });
        continue;
      }
    }
    if (entry?.role === "field") {
      const values: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? "";
        if (!next || lookup(next) || isSealMaterial(next) || isElectronicSignatureToken(next) || isProse(next)) break;
        values.push(next);
        index += 1;
      }
      rows.push({ label: entry.english, value: translateValue(values.join(" ")) });
      continue;
    }
    const split = splitRunOn(line);
    if (split) {
      flush();
      blocks.push(...split);
      continue;
    }
    flush();
    const prose = [line];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? "";
      if (!next || lookup(next) || isSealMaterial(next) || isElectronicSignatureToken(next) || isAllCapsLabel(next)) break;
      prose.push(next);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: translateProse(prose.join(" ")) });
  }
  flush();
  return refineSeal(coalesce(blocks));
}

function overlapsX(label: TextItem, value: TextItem): boolean {
  const overlap = Math.min(label.x + label.width, value.x + value.width) - Math.max(label.x, value.x);
  return overlap > 2 || Math.abs(value.x - label.x) < 22;
}

function sameBand(a: TextItem, b: TextItem): boolean {
  return Math.abs(a.y - b.y) <= Math.max(3, Math.min(a.size, b.size) * 0.45);
}

function isStructuralText(text: string): boolean {
  const role = lookup(text)?.role;
  return role === "field" || role === "section" || role === "heading" || role === "signature";
}

function findValue(label: TextItem, items: TextItem[]): TextItem | null {
  const right = items
    .filter((item) => {
      if (item === label || isStructuralText(item.text) || isSealMaterial(item.text)) return false;
      if (!sameBand(label, item)) return false;
      const gap = item.x - (label.x + label.width);
      return gap >= -4 && gap < 220;
    })
    .sort((a, b) => a.x - b.x)[0];
  if (right) return right;

  let best: TextItem | null = null;
  for (const item of items) {
    if (item === label || isStructuralText(item.text) || isSealMaterial(item.text)) continue;
    const dy = label.y - item.y;
    if (dy < 4 || dy > 18) continue;
    if (!overlapsX(label, item)) continue;
    if (!best || item.y > best.y) best = item;
  }
  return best;
}

function clusterLines(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const item of sorted) {
    let best: TextItem[] | null = null;
    let bestDy = Number.POSITIVE_INFINITY;
    for (const group of lines) {
      const ref = group[0];
      if (!ref) continue;
      const dy = Math.abs(ref.y - item.y);
      const limit = Math.max(3, Math.min(ref.size, item.size) * 0.45);
      if (dy <= limit && dy < bestDy) {
        best = group;
        bestDy = dy;
      }
    }
    if (best) best.push(item);
    else lines.push([item]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

function joinLineRuns(line: TextItem[]): TextItem[] {
  const runs: TextItem[] = [];
  const y = line[0]?.y ?? 0;
  for (const item of line) {
    const prev = runs[runs.length - 1];
    const gap = prev ? item.x - (prev.x + prev.width) : 0;
    const limit = prev ? Math.max(8, Math.max(prev.size, item.size) * 0.55) : 0;
    const closed = prev ? /[:：]$/.test(prev.text) || lookup(prev.text)?.role === "field" || lookup(prev.text)?.role === "heading" : false;
    if (prev && !closed && gap >= -2 && gap <= limit) {
      prev.text = normalizeText(`${prev.text}${item.text}`);
      prev.width = item.x + item.width - prev.x;
      prev.size = Math.max(prev.size, item.size);
      prev.y = y;
      continue;
    }
    runs.push({ ...item, y, text: normalizeText(item.text) });
  }
  return runs;
}

function splitColonRun(item: TextItem): TextItem[] {
  const match = item.text.match(/^(.{1,40}?)[：:]\s*(\S.*)$/);
  if (!match) return [item];
  const label = match[1] ?? "";
  if (lookup(label)?.role !== "field") return [item];
  const value = match[2] ?? "";
  const share = label.length / Math.max(item.text.length, 1);
  const labelWidth = Math.max(8, item.width * share);
  return [
    { ...item, text: normalizeText(label), width: labelWidth },
    { ...item, text: value, x: item.x + labelWidth, width: Math.max(4, item.width - labelWidth) },
  ];
}

function preparePositioned(items: TextItem[]): TextItem[] {
  const cleaned = items.flatMap((item) => {
    const text = item.text.trim();
    if (!text || isFictionalWatermark(text)) return [];
    return [{ ...item, text }];
  });
  return clusterLines(cleaned).flatMap(joinLineRuns).flatMap(splitColonRun);
}

function joinProse(items: TextItem[]): Array<{ y: number; x: number; text: string }> {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextItem[][] = [];
  for (const item of sorted) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    const standalone = (text: string) => /oficial del registro|verifique en:|el suscrito|sin anotaciones|copia certificada/i.test(text);
    if (
      last &&
      !standalone(last.text) &&
      !standalone(item.text) &&
      Math.abs(last.x - item.x) < 10 &&
      last.y - item.y > 0 &&
      last.y - item.y < 12
    ) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups.map((group) => ({
    y: group[0]?.y ?? 0,
    x: group[0]?.x ?? 0,
    text: translateProse(group.map((item) => item.text.trim()).join(" ")),
  }));
}

/**
 * Positioned text (top of the page is a larger y). Seals are notes at the
 * stamp's vertical position. A label pairs with the value on its row, or with
 * the value directly below when the form stacks them.
 */
export function structurePositioned(items: TextItem[]): RenderBlock[] {
  const prepared = preparePositioned(items);
  const singles = prepared.filter((item) => Array.from(item.text.trim()).length === 1);
  const ring = (item: TextItem) => {
    if (Array.from(item.text.trim()).length !== 1) return false;
    const near = singles.filter((other) => Math.hypot(other.x - item.x, other.y - item.y) < 90);
    return near.length >= 6;
  };

  const kept: TextItem[] = [];
  const sealYs: number[] = [];
  for (const item of prepared) {
    if (ring(item) || isSealMaterial(item.text)) {
      sealYs.push(item.y);
      continue;
    }
    kept.push(item);
  }

  const caption = sealCaptionFromText(prepared.map((item) => item.text).join("\n"));
  const consumed = new Set<TextItem>();
  const pieces: Array<{ top: number; x: number; block: RenderBlock }> = [];
  const seenHeadings = new Set<string>();

  for (const item of kept) {
    const entry = lookup(item.text);
    if (entry?.role !== "heading" && entry?.role !== "section") continue;
    if (entry.role === "heading" && seenHeadings.has(entry.english)) {
      consumed.add(item);
      continue;
    }
    if (entry.role === "heading") seenHeadings.add(entry.english);
    consumed.add(item);
    pieces.push({
      top: item.y + item.size,
      x: item.x,
      block: { type: "heading", text: entry.english, level: entry.role === "heading" ? 1 : 2 },
    });
  }

  for (const item of kept) {
    if (consumed.has(item)) continue;
    const entry = lookup(item.text);
    if (entry?.role !== "signature" && !isElectronicSignatureToken(item.text)) continue;
    consumed.add(item);
    if (entry?.role === "signature") {
      for (const other of kept) {
        if (consumed.has(other)) continue;
        const dy = item.y - other.y;
        if (dy > 0 && dy < 40 && isElectronicSignatureToken(other.text)) consumed.add(other);
      }
    }
    const electronic = entry ? /electron/i.test(entry.english) || isElectronicSignatureToken(item.text) : true;
    pieces.push({ top: item.y + item.size, x: item.x, block: { type: "signature", electronic } });
  }

  const fieldItems = kept
    .filter((item) => !consumed.has(item))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of fieldItems) {
    if (consumed.has(item)) continue;
    const entry = lookup(item.text);
    if (entry?.role !== "field" && !isAllCapsLabel(item.text)) continue;
    const value = findValue(item, kept.filter((other) => !consumed.has(other)));
    if (!value && entry?.role !== "field") continue;
    if (!entry && value && (isProse(value.text) || value.text.trim().split(/\s+/).length > 6)) continue;
    if (!entry && item.text.trim().split(/\s+/).length > 4) continue;
    consumed.add(item);
    if (value) consumed.add(value);
    if (value && isElectronicSignatureToken(value.text)) {
      pieces.push({ top: item.y + item.size, x: item.x, block: { type: "signature", electronic: true } });
      continue;
    }
    pieces.push({
      top: item.y + item.size,
      x: item.x,
      block: {
        type: "fields",
        rows: [{ label: entry?.english ?? titleCaseLabel(item.text), value: value ? translateValue(value.text) : "" }],
      },
    });
  }

  for (const prose of joinProse(kept.filter((item) => !consumed.has(item)))) {
    if (!prose.text) continue;
    const split = splitRunOn(prose.text);
    if (split) {
      for (const block of split) pieces.push({ top: prose.y, x: prose.x, block });
    } else {
      pieces.push({ top: prose.y, x: prose.x, block: { type: "paragraph", text: prose.text } });
    }
  }

  if (sealYs.length) {
    const clusters: number[][] = [];
    for (const y of [...sealYs].sort((a, b) => b - a)) {
      const cluster = clusters.find((group) => Math.abs((group[0] ?? y) - y) < 80);
      if (cluster) cluster.push(y);
      else clusters.push([y]);
    }
    for (const cluster of clusters) {
      const y = Math.max(...cluster);
      pieces.push({ top: y, x: -1, block: { type: "seal", text: caption } });
    }
  }

  pieces.sort((a, b) => b.top - a.top || a.x - b.x);
  return refineSeal(coalesce(pieces.map((piece) => piece.block)));
}

export type ModelBlock = {
  type?: string;
  text?: string;
  level?: number;
  electronic?: boolean;
  rows?: Array<{ label?: string; value?: string } | string[]>;
  lines?: string[];
  align?: string;
  column?: string;
  bold?: boolean;
  underline?: boolean;
  caps?: boolean;
  label?: string;
  value?: string;
  items?: string[];
  ordered?: boolean;
  cells?: string[][];
  header?: boolean;
  caption?: string;
};

function cleanSealText(text: string): string {
  const stripped = text.replace(/^\[Seal:\s*/i, "").replace(/\]$/, "").trim();
  const caption = sealCaptionFromText(stripped);
  if (caption !== "Official seal") return caption;
  if (isSealMaterial(stripped)) return caption;
  return collapseLetterSpacing(stripped);
}

function styledParagraph(block: ModelBlock): RenderBlock | null {
  const text = block.text ?? "";
  const align = blockAlign(block.align);
  const styled = Boolean(align || block.bold || block.underline || block.caps || text.includes("**") || text.includes("__"));
  if (!styled) return null;
  return { type: "paragraph", text, align, bold: block.bold, underline: block.underline, caps: block.caps };
}

function layoutBlock(block: ModelBlock): RenderBlock[] | null {
  const type = block.type ?? "";
  const column = blockColumn(block.column);
  if (type === "logo" && block.text?.trim()) return [{ type: "logo", text: block.text.trim() }];
  if (type === "photo") return [{ type: "photo", caption: block.caption?.trim() || block.text?.trim() || "Holder's photo" }];
  if (type === "box") {
    return [{ type: "box", label: (block.label ?? "").trim(), value: (block.value ?? block.text ?? "").trim(), column }];
  }
  if (type === "kv") {
    return [{ type: "kv", label: (block.label ?? "").trim(), value: (block.value ?? "").trim(), bold: block.bold }];
  }
  if (type === "address" && block.lines?.length) {
    return [{ type: "address", lines: block.lines.map((line) => line.trim()).filter(Boolean), align: blockAlign(block.align), bold: block.bold }];
  }
  if (type === "list" && block.items?.length) {
    return [{
      type: "list",
      ordered: block.ordered !== false,
      label: block.label?.trim() || block.text?.trim() || undefined,
      items: block.items.map((item) => item.trim()).filter(Boolean),
    }];
  }
  if (type === "table" && (block.cells?.length || block.rows?.length)) {
    const rows = block.cells?.length
      ? block.cells.map((row) => row.map((cell) => cell.trim()))
      : (block.rows ?? []).map((row) =>
          Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : [row.label ?? "", row.value ?? ""],
        );
    return [{ type: "table", rows, header: block.header ?? false }];
  }
  if (type === "stamp") return [{ type: "stamp", text: (block.text ?? "").trim(), column }];
  if (type === "handwritten") return [{ type: "handwritten", text: (block.text ?? "").trim() }];
  if (type === "illegible") return [{ type: "illegible" }];
  if (type === "signature" && (column || block.lines?.length)) {
    const fromLines = (block.lines ?? []).map((line) => line.trim()).filter(Boolean);
    const text = (block.text ?? "").trim();
    const lines = fromLines.length > 0 ? fromLines : text && !/^(signature|firma)$/i.test(text) ? [text] : [];
    return [{
      type: "signature",
      electronic: block.electronic === true,
      column,
      ...(lines.length > 0 ? { lines } : {}),
    }];
  }
  if (type === "seal" && column) return [{ type: "seal", text: cleanSealText(block.text ?? ""), column }];
  return null;
}

function fromModelBlock(block: ModelBlock): RenderBlock[] {
  const laid = layoutBlock(block);
  if (laid) return laid;
  const type = block.type ?? "paragraph";
  if (type === "fields" && block.rows?.length) {
    const rows = block.rows
      .map((row) => (Array.isArray(row) ? { label: row[0], value: row.slice(1).join(" ") } : row))
      .map((row) => ({
        label: lookup(row.label ?? "")?.english ?? (row.label ?? "").trim(),
        value: translateValue(row.value ?? ""),
      }))
      .filter((row) => row.label || row.value);
    return rows.length ? [{ type: "fields", rows }] : [];
  }
  if (type === "seal") return [{ type: "seal", text: cleanSealText(block.text ?? "") }];
  if (type === "signature") {
    const electronic = block.electronic !== false && (block.electronic === true || /electron/i.test(block.text ?? "") || block.electronic === undefined);
    const handwritten = block.electronic === false || (!block.electronic && /^(signature|firma)$/i.test((block.text ?? "").trim()));
    return [{ type: "signature", electronic: handwritten ? false : electronic }];
  }
  if (type === "lines" && block.lines?.length) return structurePage(block.lines.join("\n"));
  if (type === "heading") {
    const entry = lookup(block.text ?? "");
    return [{
      type: "heading",
      text: entry?.english ?? translateProse(block.text ?? ""),
      level: block.level === 2 || entry?.role === "section" ? 2 : 1,
      align: blockAlign(block.align),
      bold: block.bold,
      caps: block.caps,
    }];
  }
  if (type === "paragraph") {
    const styled = styledParagraph(block);
    if (styled?.type === "paragraph" && !joinedLetterParagraph(styled.text)) return [styled];
    if (joinedLetterParagraph(block.text ?? "")) {
      const text = (block.text ?? "").replace(/\s+/g, " ").trim();
      return [{ type: "paragraph", text, align: blockAlign(block.align), bold: block.bold, underline: block.underline, caps: block.caps }];
    }
    if (styled) return [styled];
  }
  if (type === "note" && block.text?.trim()) return [{ type: "note", text: block.text.trim() }];
  if (block.text?.trim()) return structurePage(block.text);
  return [];
}

export function blocksFromModel(input: {
  blocks?: ModelBlock[];
  lines?: string[];
  paragraphs?: string[];
}): RenderBlock[] {
  if (input.blocks?.length) {
    return refineSeal(coalesce(input.blocks.flatMap(fromModelBlock)));
  }
  if (input.lines?.length) return structurePage(input.lines.join("\n"));
  if (input.paragraphs?.length) return structurePage(input.paragraphs.join("\n"));
  return [{ type: "paragraph", text: " " }];
}

/**
 * A line-broken birth certificate is a form. When the model returns only the
 * certification sentence, the labeled reading still has the names and numbers.
 * A translation that already includes those values is left alone.
 */
export function formBlocksWhenCollapsed(sourceText: string, modelBlocks: RenderBlock[]): RenderBlock[] | null {
  const structured = structurePage(sourceText);
  const values = structured
    .flatMap((block) => (block.type === "fields" ? block.rows.map((row) => row.value.trim()) : []))
    .filter((value) => value.length >= 3 && /[\p{L}\p{N}]/u.test(value));
  if (values.length < 4) return null;
  const model = blocksToParagraphs(modelBlocks).join("\n").toLocaleLowerCase("en");
  const kept = values.filter((value) => model.includes(value.toLocaleLowerCase("en")));
  if (kept.length * 2 >= values.length) return null;
  return structured;
}

export function blocksToParagraphs(blocks: RenderBlock[]): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading" || block.type === "paragraph" || block.type === "note" || block.type === "logo" || block.type === "stamp" || block.type === "handwritten") {
      const text = block.text.replace(/\*\*/g, "").replace(/__/g, "").trim();
      if (text) lines.push(block.type === "logo" ? `[Logo: ${text}]` : block.type === "stamp" ? (text ? `[Stamp: ${text}]` : "[Stamp]") : block.type === "handwritten" ? (text ? `[Handwritten: ${text}]` : "[Handwritten]") : text);
    } else if (block.type === "fields") {
      for (const row of block.rows) lines.push(`${row.label}: ${row.value}`);
    } else if (block.type === "kv" || block.type === "box") {
      lines.push(`${block.label}: ${block.value}`);
    } else if (block.type === "address") {
      lines.push(...block.lines);
    } else if (block.type === "list") {
      if (block.label) lines.push(block.label);
      block.items.forEach((item, index) => lines.push(`${index + 1}) ${item.replace(/\*\*/g, "")}`));
    } else if (block.type === "table") {
      for (const row of block.rows) lines.push(row.join(" "));
    } else if (block.type === "seal") {
      lines.push(block.text.trim() ? `[Seal: ${block.text}]` : "[Seal]");
    } else if (block.type === "signature") {
      lines.push(block.electronic ? "[Electronic signature]" : "[Signature]");
      for (const line of block.lines ?? []) lines.push(line.replace(/\*\*/g, ""));
    } else if (block.type === "photo") {
      lines.push(`[${block.caption?.trim() || "Holder's photo"}]`);
    } else if (block.type === "illegible") {
      lines.push("[Illegible]");
    }
  }
  return lines.length ? lines : [" "];
}

export function finalizeBlocks(blocks: RenderBlock[]): RenderBlock[] {
  return blocksFromModel({ blocks: blocks as ModelBlock[] });
}
