/**
 * The shape of what the plugin writes and the script of the site reads.
 *
 * A page opened from a file may not read other files as data, but it may load
 * them as scripts. So everything is a script that hands its content to
 * `window.__site`: `data/index.js` the list of what there is, `data/n/<id>.js`
 * one note, `data/s/<n>.js` a part of the text to search in.
 */

/** A value of a property of a note */
export type PropertyValue = string | number | boolean | null | PropertyValue[] | { [key: string]: PropertyValue };

/** A note in the list: enough for the tree and the links, without its text */
export interface NoteEntry {
  /** Path in the vault */
  p: string;
  /** Ids of the notes of the site it links to or embeds */
  l: string[];
}

/** A file that is not a note */
export interface FileEntry {
  /** Path in the vault */
  p: string;
  /** Where it is in the site, from index.html */
  a: string;
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
  /** The inline style of the body of Obsidian: the size of the text, the accent color */
  bodyStyle: string;
  /** Icons of Obsidian as SVG, by name */
  icons: Record<string, string>;
}

/** One note, as Obsidian drew it */
export interface NotePage {
  /** The note as XML (XHTML): it is read back exactly as Obsidian made it, which HTML is not */
  html: string;
  /** The properties, in the order of the note */
  props: [key: string, value: PropertyValue][];
  /** Headings, for the outline: level and text */
  h: [level: number, text: string][];
}

/** A part of the text to search in: the id of a note and its text */
export type SearchPart = [id: string, text: string][];

/** What the scripts of the data call */
export interface SiteGlobal {
  index(index: SiteIndex): void;
  note(id: string, page: NotePage): void;
  search(part: number, entries: SearchPart): void;
}

/** A link to a note inside the site, as the address after index.html */
export function noteAddress(id: string, heading?: string): string {
  return "#/" + id + (heading === undefined || heading === "" ? "" : "/" + encodeURIComponent(heading));
}

/** The names of the icons the site takes from Obsidian */
export const ICON_NAMES = [
  "right-triangle",
  "search",
  "sidebar-left",
  "sidebar-right",
  "sun",
  "moon",
  "list",
  "links-coming-in",
  "x",
  "copy",
  "check",
  "file",
  "link",
] as const;
