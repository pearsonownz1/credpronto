export type ListItem = {
  lead: string | null;
  text: string;
};

export type FaqBlock = {
  question: string;
  answer: string;
};

export type MdBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "faq"; items: FaqBlock[] };

export type MdSection = {
  heading: string;
  blocks: MdBlock[];
};

function parseListItem(raw: string): ListItem {
  const match = raw.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
  if (!match) return { lead: null, text: raw.trim() };
  return {
    lead: match[1].replace(/[.:]$/, "").trim(),
    text: match[2].trim(),
  };
}

function isTableSeparator(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseFaq(body: string): FaqBlock[] {
  const items: FaqBlock[] = [];
  let question: string | null = null;
  let answer: string[] = [];

  function flush() {
    if (!question) return;
    const text = answer.join("\n").trim();
    if (text) items.push({ question, answer: text });
  }

  for (const line of body.split("\n")) {
    const match = line.match(/^\*\*(.+)\*\*$/);
    if (match) {
      flush();
      question = match[1];
      answer = [];
      continue;
    }
    if (question && line.trim()) answer.push(line.trim());
  }
  flush();
  return items;
}

function parseBlocks(body: string): MdBlock[] {
  const lines = body.split("\n");
  const blocks: MdBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const rows = tableLines.filter((entry) => !isTableSeparator(entry)).map(parseTableRow);
      blocks.push({ kind: "table", rows });
      continue;
    }

    const unordered = /^[-*]\s+/.test(line);
    const ordered = /^\d+\.\s+/.test(line);
    if (unordered || ordered) {
      const items: ListItem[] = [];
      const marker = unordered ? /^[-*]\s+/ : /^\d+\.\s+/;
      while (index < lines.length && marker.test(lines[index])) {
        items.push(parseListItem(lines[index].replace(marker, "")));
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trim().startsWith("|") &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

export function marketingSections(markdown: string): MdSection[] {
  return markdown
    .split(/^## /m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const breakAt = chunk.indexOf("\n");
      const heading = (breakAt === -1 ? chunk : chunk.slice(0, breakAt)).trim();
      const body = breakAt === -1 ? "" : chunk.slice(breakAt + 1).trim();
      if (heading === "Frequently asked questions") {
        return { heading, blocks: [{ kind: "faq", items: parseFaq(body) }] };
      }
      return { heading, blocks: parseBlocks(body) };
    });
}

export function sectionByHeading(sections: readonly MdSection[], heading: string): MdSection {
  const found = sections.find((section) => section.heading === heading);
  if (!found) throw new Error(`missing marketing section: ${heading}`);
  return found;
}

export function paragraphsOf(section: MdSection): string[] {
  return section.blocks.flatMap((block) => (block.kind === "paragraph" ? [block.text] : []));
}

export function listOf(section: MdSection, ordered: boolean): ListItem[] {
  const block = section.blocks.find(
    (item): item is Extract<MdBlock, { kind: "list" }> => item.kind === "list" && item.ordered === ordered,
  );
  return block?.items ?? [];
}

export function faqOf(section: MdSection): FaqBlock[] {
  const block = section.blocks.find((item): item is Extract<MdBlock, { kind: "faq" }> => item.kind === "faq");
  return block?.items ?? [];
}

export function leadParagraph(text: string): { lead: string; rest: string } | null {
  const match = text.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
  if (!match) return null;
  return { lead: match[1].replace(/\.$/, "").trim(), rest: match[2].trim() };
}
