/**
 * The shape of what the plugin writes and the script of the site reads.
 *
 * A page opened from a file may not read other files as data. What it may do
 * there is load a script that the page itself names, and show another file in
 * a frame. So `data/index.js`, the list of what there is, is a script that
 * index.html loads and that hands the list to `window.__site`. A note,
 * `data/n/<id>.html`, and a part of the text to search in, `data/s/<n>.html`,
 * are each a document of the data (`dataDocument`), loaded in a frame when it
 * is needed: `loadData` in viewer/dom.ts says how.
 */

/** A value of a property of a note */
export type PropertyValue = string | number | boolean | null | PropertyValue[] | { [key: string]: PropertyValue };

/**
 * A property of a note: its name, its value as the words it shows, the kind
 * Obsidian shows it as (`text`, `multitext`, `number`, `checkbox`, `date`,
 * `datetime`, `tags`, `aliases`), and for a value that is a link to a note of
 * the site, or a list with such links, the address in the site that each
 * item leads to.
 */
export type PropertyEntry = [key: string, value: PropertyValue, type?: string, to?: (string | null)[]];

/** A note in the list: enough for the tree and the links, without its text */
export interface NoteEntry {
  /** Path in the vault */
  p: string;
  /** Ids of the notes of the site it links to or embeds */
  l: string[];
}

/** A file that is not a note */
export interface FileEntry {
  /** Where the list of files shows it: its path in the vault, or for a file at a path of its own, that path */
  p: string;
  /** Where it is in the site, from index.html, as a path: `fileAddress` makes it an address */
  a: string;
}

/**
 * The address of a file of the site, from index.html: its path, with each
 * part of it made fit for an address. A file at a path of its own may have
 * a name with a space, a `#` or a `%` in it, which an address would read as
 * something else.
 */
export function fileAddress(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export interface SiteIndex {
  /** Name of the vault */
  name: string;
  notes: Record<string, NoteEntry>;
  files: Record<string, FileEntry>;
  /** How many parts the text to search in has */
  searchParts: number;
  /** The look Obsidian had when the site was built */
  theme: "dark" | "light";
  /** True when Obsidian shows the name of a note above its text */
  inlineTitle: boolean;
  /** The classes the reading view of Obsidian had by its settings, as the one for a line of readable length */
  viewClass: string;
  /** The inline style of the body of Obsidian: the size of the text, the accent color */
  bodyStyle: string;
  /**
   * The class Obsidian has for the system the site was built on: `mod-macos`,
   * `mod-windows` or `mod-linux`. Its style sheets set some sizes and colors by
   * it, as the roundness of buttons.
   */
  system: string;
  /** Icons of Obsidian as SVG, by name */
  icons: Record<string, string>;
}

/** One note, as Obsidian drew it */
export interface NotePage {
  /** The note as XML (XHTML): it is read back exactly as Obsidian made it, which HTML is not */
  html: string;
  /** The properties, in the order of the note */
  props: PropertyEntry[];
  /** Headings, for the outline: level and text */
  h: [level: number, text: string][];
}

/** A part of the text to search in: the id of a note and its text */
export type SearchPart = [id: string, text: string][];

/** What the script of the list of what there is, `data/index.js`, calls */
export interface SiteGlobal {
  index(index: SiteIndex): void;
}

/**
 * A document of the data: a small page that holds `data` as JSON, and hands
 * it to the page of the site with the script `app/frame.js`. It lies two
 * folders down from the top of the site, in `data/n` or in `data/s`. A search
 * engine is asked to leave it out: it is a part of a page, not one to show.
 */
export function dataDocument(data: NotePage | SearchPart): string {
  // Every `<` written as an escape, which JSON reads as the same sign: nothing in it can end the element it is in, as `</script>` would
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<script type="application/json">${json}</script>
<script src="../../app/frame.js"></script>
`;
}

/** A link to a note inside the site, as the address after index.html */
export function noteAddress(id: string, heading?: string): string {
  return "#/" + id + (heading === undefined || heading === "" ? "" : "/" + encodeURIComponent(heading));
}

/** Reads an address that `noteAddress` wrote: the id of the note and the heading, which is empty for the note as a whole */
export function readNoteAddress(address: string): { id: string; heading: string } {
  const decoded = (text: string): string => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  const [, id = "", ...rest] = address.split("/");
  return { id: decoded(id), heading: decoded(rest.join("/")) };
}

/** The names of the icons the site takes from Obsidian */
export const ICON_NAMES = [
  "right-triangle",
  "maximize-2",
  "search",
  "sidebar-left",
  "sidebar-right",
  "sun",
  "moon",
  "x",
  "git-fork",
] as const;
