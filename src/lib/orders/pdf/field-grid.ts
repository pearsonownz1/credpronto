/** A label/value pair from a fields row, a kv block, or a box. */
export type LabeledPair = {
  label: string;
  value: string;
};

const REGISTRY_DATE = /^(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})$/;

/**
 * Registration numbers on a diploma strip: 022A-084542, 2020/217459, 14655910H5051.
 * Dates and prose stay ordinary labeled lines.
 */
export function isRegistryCode(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 32 || /\s/.test(text)) return false;
  if (REGISTRY_DATE.test(text)) return false;
  if (!/\d/.test(text)) return false;
  return /^[\p{L}\p{N}./:+-]+$/u.test(text);
}

/** `Label: value`, or just the value when the label is blank. Never a leading colon. */
export function labeledLine(label: string, value: string): string {
  const name = label.trim();
  const printed = value.trim();
  if (name && printed) return `${name}: ${printed}`;
  return name || printed;
}

function shortRegistryLabel(label: string): boolean {
  return label.trim().length <= 48;
}

/** Two to five short registration numbers that belong in one horizontal ruled strip. */
export function isHorizontalRegistryStrip(pairs: LabeledPair[]): boolean {
  if (pairs.length < 2 || pairs.length > 5) return false;
  return pairs.every((pair) => shortRegistryLabel(pair.label) && isRegistryCode(pair.value));
}

export type PairTable = {
  rows: string[][];
  header: boolean;
};

/**
 * A bordered grid for certificate fields.
 * Short registry strips become a horizontal table (labels over values, or one
 * row of "Label: Value" cells when a label is blank). Longer field lists become
 * a two-column label/value grid. A kv/box run that is not a registry strip
 * returns null so the caller can keep ordinary labeled lines.
 */
export function tableForPairs(pairs: LabeledPair[], source: "fields" | "run"): PairTable | null {
  const usable = pairs.filter((pair) => pair.label.trim() || pair.value.trim());
  if (usable.length === 0) return null;
  if (isHorizontalRegistryStrip(usable)) {
    if (usable.every((pair) => pair.label.trim())) {
      return {
        header: true,
        rows: [usable.map((pair) => pair.label.trim()), usable.map((pair) => pair.value.trim())],
      };
    }
    return {
      header: true,
      rows: [usable.map((pair) => labeledLine(pair.label, pair.value))],
    };
  }
  if (source === "fields" || (usable.length >= 2 && usable.every((pair) => shortRegistryLabel(pair.label) && isRegistryCode(pair.value)))) {
    return {
      header: false,
      rows: usable.map((pair) => [pair.label.trim(), pair.value.trim()]),
    };
  }
  return null;
}

/** Always a table, including a single kv/box a reviewer converts by hand. */
export function borderedTableBlock(pairs: LabeledPair[], source: "fields" | "run"): { type: "table"; rows: string[][]; header: boolean } | null {
  const usable = pairs.filter((pair) => pair.label.trim() || pair.value.trim());
  if (usable.length === 0) return null;
  const table = tableForPairs(usable, source) ?? {
    header: false,
    rows: usable.map((pair) => {
      const label = pair.label.trim();
      const value = pair.value.trim();
      if (label && value) return [label, value];
      return [label || value];
    }),
  };
  return { type: "table", rows: table.rows, header: table.header };
}
