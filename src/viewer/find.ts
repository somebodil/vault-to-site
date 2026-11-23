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

/** The text of a note, ready to be searched many times */
export interface Haystack {
  id: string;
  /** The text as it is shown */
  text: string;
  /** The same text in lower case, letter for letter */
  folded: string;
}

/**
 * Lower case is made once for a note, not at every key. In a few scripts a
 * letter changes its length in lower case; then the lower case is shown too,
 * so that a place in one is the same place in the other.
 */
export function haystack(id: string, text: string): Haystack {
  const folded = fold(text);
  return { id, text: folded.length === text.length ? text : folded, folded };
}

export interface LineHit {
  /** The line, cut to what fits a row, with the place of the match in it */
  text: string;
  start: number;
  end: number;
}

const ROW = 120;

function cut(line: string, at: number, length: number): LineHit {
  // A line starts after its indent. A line too long for a row starts a little before the match.
  const indent = line.length - line.trimStart().length;
  const from = line.length - indent > ROW ? Math.max(indent, Math.min(at - 30, line.length - ROW)) : indent;
  const isCut = from > indent;
  const shift = isCut ? 1 : 0;
  return {
    text: (isCut ? "…" : "") + line.slice(from, from + ROW - shift),
    start: at - from + shift,
    end: at - from + length + shift,
  };
}

/**
 * The lines of a text that hold what was typed, as it was typed. When no line
 * does and several words were typed, the lines that hold all of the words.
 * A line is given once, and the text is not taken apart into lines to find them.
 */
export function findLines(query: string, hay: Haystack, limit: number): LineHit[] {
  const q = fold(query.trim());
  if (q === "") {
    return [];
  }
  const { text, folded } = hay;
  const hits: LineHit[] = [];
  /** Walks the lines that hold `needle`, until `take` has enough */
  const scan = (needle: string, take: (start: number, end: number, at: number) => void): void => {
    let from = 0;
    while (hits.length < limit) {
      const at = folded.indexOf(needle, from);
      if (at === -1) {
        return;
      }
      const start = folded.lastIndexOf("\n", at) + 1;
      const next = folded.indexOf("\n", at);
      const end = next === -1 ? folded.length : next;
      take(start, end, at);
      from = end + 1;
    }
  };

  scan(q, (start, end, at) => {
    hits.push(cut(text.slice(start, end), at - start, q.length));
  });
  if (hits.length > 0) {
    return hits;
  }
  const words = q.split(/\s+/).filter((word) => word !== "");
  const first = words[0];
  if (first === undefined || words.length < 2) {
    return hits;
  }
  scan(first, (start, end, at) => {
    const line = folded.slice(start, end);
    if (words.every((word) => line.includes(word))) {
      hits.push(cut(text.slice(start, end), at - start, first.length));
    }
  });
  return hits;
}
