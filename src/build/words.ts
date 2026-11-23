import type { PropertyValue } from "../site-format.ts";

/**
 * What a text shows when the links in it are drawn: the words of a link,
 * without where it leads.
 *
 * The text of a note is drawn by Obsidian, and the build takes the targets
 * out of what was drawn. Two things reach the site without being drawn: the
 * properties of a note and its headings. A link in one of them would carry
 * the path of its target as it was written, also the path of a note that is
 * kept out of the site. So they are shown as their words.
 *
 * An address that opens Obsidian or a file of the device is taken out
 * wherever it stands, and so is a tag of HTML with an attribute that has a
 * value: the value can be an address. Everything else stays as it was
 * written, also what only looks like a link or a tag: `arr[i][j]`,
 * `Vec<T, A>`, an address of the web in angle brackets.
 */

/** A tag of HTML with an attribute that has a value, as `<a href="...">`: the value can be an address */
const TAG_WITH_VALUE = /<([A-Za-z][A-Za-z0-9-]*)\s[^<>\n]*=[^<>\n]*>/g;
/** An address that leads into Obsidian or to a file of the device */
const INNER_ADDRESS = /\b(?:obsidian|app|capacitor|file):\/\/[^\s)>\]"']*/gi;

/** The words of a link in double brackets: what is after the bar, or the name of the note without its folders */
function wikilinkWords(inner: string): string {
  // In a table the bar is written with a backslash before it
  const bar = inner.search(/\\?\|/);
  if (bar !== -1) {
    const words = inner.slice(inner.indexOf("|", bar) + 1).trim();
    if (words !== "") {
      return words;
    }
  }
  const target = bar === -1 ? inner : inner.slice(0, bar);
  const [path = "", ...sub] = target.split("#");
  const name = path.slice(path.lastIndexOf("/") + 1).trim();
  return [name, ...sub.map((part) => part.trim())].filter((part) => part !== "").join(" > ");
}

/** Every `[[...]]`, also one whose words hold a bracket, read from its start to the next `]]` */
function withoutWikilinks(text: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("[[", at);
    const close = open === -1 ? -1 : text.indexOf("]]", open + 2);
    if (open === -1 || close === -1) {
      return out + text.slice(at);
    }
    // Of two starts before one end, the later one is the link
    const start = text.lastIndexOf("[[", close - 1);
    const from = start > open ? start : open;
    const isEmbed = from > at && text.charAt(from - 1) === "!";
    out += text.slice(at, isEmbed ? from - 1 : from) + wikilinkWords(text.slice(from + 2, close));
    at = close + 2;
  }
}

/** True when the sign at this place has a backslash before it that takes its meaning away */
function isEscaped(text: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && text.charAt(i) === "\\"; i--) {
    slashes++;
  }
  return slashes % 2 === 1;
}

/** Where the `[` is that the `]` at `close` ends, with brackets inside the words counted, or -1 */
function openOf(text: string, close: number): number {
  let depth = 0;
  for (let i = close - 1; i >= 0; i--) {
    const sign = text.charAt(i);
    if (sign === "\n") {
      return -1;
    }
    if ((sign !== "[" && sign !== "]") || isEscaped(text, i)) {
      continue;
    }
    if (sign === "]") {
      depth++;
    } else if (depth === 0) {
      return i;
    } else {
      depth--;
    }
  }
  return -1;
}

/**
 * Where the target of a link ends that starts after `(` at `from`: the place
 * after its `)`, or -1. Brackets inside the target are counted, however deep;
 * a target in angle brackets and a title in quotes are passed over whole.
 */
function endOfTarget(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const sign = text.charAt(i);
    if (sign === "\n") {
      return -1;
    }
    if (sign === "\\") {
      i++;
    } else if (sign === "(") {
      depth++;
    } else if (sign === ")") {
      if (depth === 0) {
        return i + 1;
      }
      depth--;
    } else if (sign === "<" || ((sign === '"' || sign === "'") && /\s/.test(text.charAt(i - 1)))) {
      const end = text.indexOf(sign === "<" ? ">" : sign, i + 1);
      if (end !== -1 && !text.slice(i, end).includes("\n")) {
        i = end;
      }
    }
  }
  return -1;
}

/**
 * Every link in the way of Markdown, `[words](target)`, as its words. Read
 * sign by sign and not by one pattern: the words can hold brackets and a link
 * of their own, as a picture that is a link, and the target can hold brackets.
 */
function withoutMarkdownLinks(text: string): string {
  let shown = text;
  let at = 0;
  for (;;) {
    const middle = shown.indexOf("](", at);
    if (middle === -1) {
      return shown;
    }
    const open = isEscaped(shown, middle) ? -1 : openOf(shown, middle);
    const end = open === -1 ? -1 : endOfTarget(shown, middle + 2);
    if (open === -1 || end === -1) {
      at = middle + 2;
      continue;
    }
    const start = open > 0 && shown.charAt(open - 1) === "!" ? open - 1 : open;
    shown = shown.slice(0, start) + shown.slice(open + 1, middle) + shown.slice(end);
    // From the start of the words again: they may be the words of a link around this one
    at = start;
  }
}

export function shownWords(text: string): string {
  let shown = withoutMarkdownLinks(withoutWikilinks(text));
  // A tag that is taken out takes its end with it: `<a href="...">x</a>` is shown as `x`
  const taken = new Set<string>();
  shown = shown.replace(TAG_WITH_VALUE, (_tag, name: string) => {
    taken.add(name.toLowerCase());
    return "";
  });
  if (taken.size > 0) {
    shown = shown.replace(/<\/([A-Za-z][A-Za-z0-9-]*)\s*>/g, (tag, name: string) => (taken.has(name.toLowerCase()) ? "" : tag));
  }
  return shown.replace(INNER_ADDRESS, "");
}

/** The same for the value of a property, whatever it holds */
export function shownValue(value: PropertyValue): PropertyValue {
  if (typeof value === "string") {
    return shownWords(value);
  }
  if (Array.isArray(value)) {
    return value.map(shownValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shownValue(inner)]));
  }
  return value;
}
