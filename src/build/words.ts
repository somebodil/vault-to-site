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
 * What cannot be read as a link for sure is not left as it is either: an
 * address that opens Obsidian or a file of the device is taken out wherever
 * it stands, and so is a tag of HTML that holds more than its name: an
 * attribute can hold an address.
 */

/** A link in the way of Markdown: `[words](target)`, with a target in angle brackets or with brackets of its own, and a title after it */
const MARKDOWN_LINK =
  /!?\[((?:\\.|[^[\]\\])*)\]\(\s*(?:<[^>\n]*>|(?:\\.|[^()\s\\]|\((?:\\.|[^()\\])*\))*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;
/** A link by a name that is given elsewhere: `[words][name]` */
const REFERENCE_LINK = /!?\[((?:\\.|[^[\]\\])*)\]\[[^[\]\n]*\]/g;
/** What stands in angle brackets as a tag of HTML does */
const HTML_TAG = /<\/?[A-Za-z][^>\n]*>/g;
/** A tag with a name and nothing else, as `<b>` or `</script>`: it holds no address, and it is shown as the text it is */
const BARE_TAG = /^<\/?[A-Za-z][A-Za-z0-9-]*\s*\/?>$/;
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

export function shownWords(text: string): string {
  let shown = withoutWikilinks(text);
  // A link can hold another, as a picture that is a link: each pass takes away the innermost
  for (let pass = 0; pass < 8; pass++) {
    const next = shown.replace(MARKDOWN_LINK, "$1").replace(REFERENCE_LINK, "$1");
    if (next === shown) {
      break;
    }
    shown = next;
  }
  // A tag that is taken out takes its end with it: `<a href="...">x</a>` is shown as `x`
  const taken = new Set<string>();
  const nameOf = (tag: string): string => (/[A-Za-z][A-Za-z0-9-]*/.exec(tag)?.[0] ?? "").toLowerCase();
  shown = shown.replace(HTML_TAG, (tag) => {
    if (BARE_TAG.test(tag)) {
      return tag;
    }
    taken.add(nameOf(tag));
    return "";
  });
  if (taken.size > 0) {
    shown = shown.replace(HTML_TAG, (tag) => (tag.startsWith("</") && taken.has(nameOf(tag)) ? "" : tag));
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
