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
 */
const WIKILINK = /!?\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;
const MARKDOWN_LINK = /!?\[([^[\]]*)\]\((?:<[^>]*>|[^()\s]*(?:\([^()]*\)[^()\s]*)*)(?:\s+"[^"]*")?\)/g;

export function shownWords(text: string): string {
  return text
    .replace(WIKILINK, (_whole, target: string, alias: string | undefined) => {
      const words = alias?.trim();
      if (words !== undefined && words !== "") {
        return words;
      }
      // Without other words, a link shows its target. The folders above it are left out: the name is enough to read it.
      const [path = "", ...sub] = target.split("#");
      const name = path.slice(path.lastIndexOf("/") + 1).trim();
      return [name, ...sub.map((part) => part.trim())].filter((part) => part !== "").join(" > ");
    })
    .replace(MARKDOWN_LINK, (_whole, words: string) => words);
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
