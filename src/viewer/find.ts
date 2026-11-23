/** Finding notes by name and by text. Nothing here touches the page, so it is tested with plain Node.js. */

const fold = (text: string): string => text.toLowerCase();

/**
 * How well a name fits what was typed: 0 for not at all, more for better.
 * The whole name is best, then a name that starts with it, a word that starts
 * with it, the letters next to each other anywhere, and last the letters in
 * order with others between them.
 */
export function nameScore(query: string, name: string): number {
  const q = fold(query.trim());
  const n = fold(name);
  if (q === "") {
    return 0;
  }
  if (n === q) {
    return 5;
  }
  if (n.startsWith(q)) {
    return 4;
  }
  const at = n.indexOf(q);
  if (at > 0) {
    return /[\s\-_/.]/.test(n.charAt(at - 1)) ? 3 : 2;
  }
  let from = 0;
  for (const char of q) {
    if (char === " ") {
      continue;
    }
    const found = n.indexOf(char, from);
    if (found === -1) {
      return 0;
    }
    from = found + 1;
  }
  return 1;
}

export interface LineHit {
  /** The line, cut to what fits a row, with the place of the match in it */
  text: string;
  start: number;
  end: number;
}

const ROW = 120;

/**
 * The lines of a text that hold what was typed, as it was typed. When no line
 * does and several words were typed, the lines that hold all of the words.
 */
export function findLines(query: string, text: string, limit: number): LineHit[] {
  const q = fold(query.trim());
  if (q === "") {
    return [];
  }
  const lines = text.split("\n");
  const hits: LineHit[] = [];
  const add = (line: string, at: number, length: number): void => {
    // A line starts after its indent. A line too long for a row starts a little before the match.
    const indent = line.length - line.trimStart().length;
    const from = line.length - indent > ROW ? Math.max(indent, Math.min(at - 30, line.length - ROW)) : indent;
    const isCut = from > indent;
    const shift = isCut ? 1 : 0;
    hits.push({
      text: (isCut ? "…" : "") + line.slice(from, from + ROW - shift),
      start: at - from + shift,
      end: at - from + length + shift,
    });
  };
  for (const line of lines) {
    const at = fold(line).indexOf(q);
    if (at !== -1) {
      add(line, at, q.length);
      if (hits.length === limit) {
        return hits;
      }
    }
  }
  if (hits.length > 0) {
    return hits;
  }
  const words = q.split(/\s+/).filter((word) => word !== "");
  if (words.length < 2) {
    return hits;
  }
  for (const line of lines) {
    const folded = fold(line);
    if (words.every((word) => folded.includes(word))) {
      const first = words[0] ?? "";
      add(line, folded.indexOf(first), first.length);
      if (hits.length === limit) {
        break;
      }
    }
  }
  return hits;
}
