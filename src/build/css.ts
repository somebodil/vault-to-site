/**
 * A style sheet read as the text it was written in.
 *
 * A browser can give the rules of a sheet back as text, but not always the
 * text that was written: Chromium gives `border-top: var(--thickness) solid`
 * back as `border-top-width: ; border-top-style: ;`, declarations without a
 * value, and a browser that reads that drops them. So the sheets are taken
 * as they were written, and only cut into rules far enough to leave a rule
 * out or to take another sheet in.
 */

/** A rule as it was written: what stands before its block and the text inside the block, or a statement that ends with `;` */
export interface CssRule {
  prelude: string;
  /** Null for a statement, as `@import "x";` */
  block: string | null;
}

const QUOTE = new Set(['"', "'"]);

/** The place after the string that starts at `at` */
function afterString(text: string, at: number): number {
  const quote = text.charAt(at);
  for (let i = at + 1; i < text.length; i++) {
    const sign = text.charAt(i);
    if (sign === "\\") {
      i++;
    } else if (sign === quote || sign === "\n") {
      return i + 1;
    }
  }
  return text.length;
}

/** The place after the comment that starts at `at` */
function afterComment(text: string, at: number): number {
  const end = text.indexOf("*/", at + 2);
  return end === -1 ? text.length : end + 2;
}

/**
 * The place after `url(...)` that starts at `at`, when the address in it is
 * written without quotes, else -1. Such an address can hold `;`, `{` and `/*`,
 * as one that carries a picture in itself does.
 */
function afterBareUrl(text: string, at: number): number {
  if (text.charCodeAt(at + 3) !== 40 || text.slice(at, at + 4).toLowerCase() !== "url(") {
    return -1;
  }
  let start = at + 4;
  while (start < text.length && /\s/.test(text.charAt(start))) {
    start++;
  }
  if (QUOTE.has(text.charAt(start))) {
    return -1;
  }
  const end = text.indexOf(")", start);
  return end === -1 ? text.length : end + 1;
}

/**
 * Goes through a text from `from` and calls `at` for every sign that stands
 * in the open: not in a string, a comment or an address without quotes, and
 * not after a backslash.
 * `at` answers where to go on, or -1 to end. Comments are given to `skipped`.
 */
function walk(text: string, from: number, at: (sign: string, i: number) => number, skipped?: (start: number, end: number) => void): void {
  let i = from;
  while (i < text.length) {
    const sign = text.charAt(i);
    if (sign === "/" && text.charAt(i + 1) === "*") {
      const end = afterComment(text, i);
      skipped?.(i, end);
      i = end;
    } else if (sign === "\\") {
      // The sign after a backslash is only itself: `\'` in a selector starts no string, and `\{` no block
      i += 2;
    } else if (QUOTE.has(sign)) {
      i = afterString(text, i);
    } else if ((sign === "u" || sign === "U") && afterBareUrl(text, i) !== -1) {
      i = afterBareUrl(text, i);
    } else {
      const next = at(sign, i);
      if (next === -1) {
        return;
      }
      i = next;
    }
  }
}

/** A text without its comments. A comment in a string or in an address is none. */
export function withoutComments(text: string): string {
  if (!text.includes("/*")) {
    return text;
  }
  let out = "";
  let kept = 0;
  walk(
    text,
    0,
    (_sign, i) => i + 1,
    (start, end) => {
      out += text.slice(kept, start) + " ";
      kept = end;
    },
  );
  return out + text.slice(kept);
}

/** Cuts the text of a sheet, or of the block of a rule that holds rules, into its rules */
export function splitRules(text: string): CssRule[] {
  const rules: CssRule[] = [];
  let start = 0;
  let depth = 0;
  let open = 0;
  walk(text, 0, (sign, i) => {
    if (sign === "{") {
      if (depth === 0) {
        open = i;
      }
      depth++;
    } else if (sign === "}") {
      if (depth === 0) {
        // An end without a start: what stood before it is no rule
        start = i + 1;
      } else if (--depth === 0) {
        rules.push({ prelude: withoutComments(text.slice(start, open)).trim(), block: withoutComments(text.slice(open + 1, i)) });
        start = i + 1;
      }
    } else if (sign === ";" && depth === 0) {
      const statement = withoutComments(text.slice(start, i)).trim();
      if (statement !== "") {
        rules.push({ prelude: statement, block: null });
      }
      start = i + 1;
    }
    return i + 1;
  });
  if (depth > 0) {
    // A block that is not closed ends with the sheet, as a browser reads it
    rules.push({ prelude: withoutComments(text.slice(start, open)).trim(), block: withoutComments(text.slice(open + 1)) });
  }
  return rules;
}

/** Another sheet that a sheet takes in: `@import url("x") screen;` */
export interface CssImport {
  address: string;
  /** What follows the address: the kind of screen it is for, a layer, a condition */
  rest: string;
}

/** A sheet in pieces: text, and at the places where they stood, the sheets it takes in */
export type CssPiece = string | CssImport;

export interface CssChoice {
  /** True for a rule that is left out, by what stands before its block (its selector) and by the block */
  drops(selector: string, block: string): boolean;
}

/** Rules whose block holds rules again */
const HOLDS_RULES = /^@(media|supports|layer|container|document|scope|starting-style)\b/i;
/** An address in quotes may follow `@import` with no space, as a sheet that was made small has it: `@import"x.css"` */
const IMPORT = /^@import(?:\s+url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|\s*"([^"]*)"|\s*'([^']*)')\s*([\s\S]*)$/i;

/**
 * The text of a sheet for the site: every rule as it was written, without
 * the rules that `choice` leaves out, and with the sheets it takes in set
 * apart, for the caller to fetch or to move to the start.
 */
export function rewriteCss(text: string, choice: CssChoice): CssPiece[] {
  const pieces: CssPiece[] = [];
  let css = "";
  for (const rule of splitRules(text)) {
    const { prelude, block } = rule;
    if (/^@charset\b/i.test(prelude)) {
      // Says how the file is stored. The site stores its own.
      continue;
    }
    if (block === null) {
      const taken = IMPORT.exec(prelude);
      if (taken === null) {
        css += prelude + ";\n";
        continue;
      }
      if (css !== "") {
        pieces.push(css);
        css = "";
      }
      pieces.push({ address: (taken[1] ?? taken[2] ?? taken[3] ?? taken[4] ?? taken[5] ?? "").trim(), rest: (taken[6] ?? "").trim() });
    } else if (HOLDS_RULES.test(prelude)) {
      // What stands before the block can pick an element as a selector does: `@scope ([aria-label="Diary"])`
      if (choice.drops(prelude, "")) {
        continue;
      }
      const inner = rewriteCss(block, choice)
        .filter((piece): piece is string => typeof piece === "string")
        .join("");
      if (inner.trim() !== "") {
        css += `${prelude}{\n${inner}}\n`;
      }
    } else if (prelude.startsWith("@") || !choice.drops(prelude, block)) {
      css += `${prelude}{${block}}\n`;
    }
  }
  if (css !== "") {
    pieces.push(css);
  }
  return pieces;
}

/** How many rules a sheet has at its top, as a browser counts them: without the statements it does not keep as rules */
export function topRuleCount(text: string): number {
  return splitRules(text).filter((rule) => !/^@charset\b/i.test(rule.prelude)).length;
}
