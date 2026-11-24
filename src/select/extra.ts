/**
 * Files that are put into a site at a path of their own, as a PDF that is to
 * be found at `Resume.pdf` at the top of the site. Nothing here touches the
 * vault, so it is tested with plain Node.js.
 */

/** A file of the vault, and the path it gets in the site */
export interface ExtraFile {
  /** The path in the site */
  to: string;
  /** The path in the vault */
  from: string;
}

/** What a file of the vault is to the choice of extra files */
export type KindOfPath = "file" | "note" | "none";

/**
 * A path as it may be written for a file in a site, or null when a site
 * cannot have a file there.
 *
 * It stays inside the site, has no part that a file system reads as
 * something else, and is not a place the site itself writes to.
 *
 * @param own the names a site has at its top, as `index.html` and `data`
 */
export function sitePath(written: string, own: readonly string[]): string | null {
  const path = written.trim().replace(/^(\.\/)+/, "");
  if (path === "" || path.length > 400 || /[\\:*?"<>|]/.test(path) || /\p{Cc}/u.test(path)) {
    return null;
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part !== part.trim() || part.endsWith(".") || part.toLowerCase() === ".git")) {
    return null;
  }
  // A file system that takes capital and small letters as the same would write over what is the site's
  const top = (parts[0] ?? "").toLowerCase();
  return own.some((name) => name.toLowerCase() === top) ? null : path;
}

/** The lines of the setting: `path in the site: path in the vault`, one a line */
function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The folders a path lies in, from the nearest one up: `a/b` and `a` for `a/b/c.pdf` */
function foldersOf(path: string): string[] {
  const folders: string[] = [];
  for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1)) {
    folders.push(path.slice(0, slash));
  }
  return folders;
}

/**
 * The extra files a setting names, and what is wrong with it.
 *
 * A file that is named here goes in whatever the ticks and the other rules
 * say: it is named one by one, by its whole path. A note is not taken: a
 * note goes into a site only as a note, by the ticks and the rules, and as
 * a file it would carry its properties and what it links to.
 *
 * @param kindOf what there is at a path of the vault
 * @param normal makes a path as it is written in a setting into the form the vault has
 * @param own the names a site has at its top
 */
export function planExtra(
  text: string,
  kindOf: (path: string) => KindOfPath,
  normal: (path: string) => string,
  own: readonly string[],
): { files: ExtraFile[]; invalid: string[] } {
  const files: ExtraFile[] = [];
  const invalid: string[] = [];
  /** The paths taken so far, by their small letters: a file system that takes capital and small letters as the same has one file for both */
  const taken = new Map<string, string>();
  /** The folders that the paths taken so far lie in, by their small letters, each with one of those paths */
  const folders = new Map<string, string>();
  for (const line of linesOf(text)) {
    const colon = line.indexOf(":");
    const written = colon < 0 ? "" : line.slice(colon + 1).trim();
    if (colon <= 0 || written === "") {
      invalid.push(`"${line}" does not name a file for the site: write it as path in the site: path in the vault.`);
      continue;
    }
    const to = sitePath(line.slice(0, colon), own);
    if (to === null) {
      invalid.push(`"${line.slice(0, colon).trim()}" cannot be the path of a file in the site.`);
      continue;
    }
    const from = normal(written);
    const kind = kindOf(from);
    if (kind === "none") {
      invalid.push(`"${written}" is not a file of the vault.`);
      continue;
    }
    if (kind === "note") {
      invalid.push(`"${written}" is a note: a note goes into the site by the ticks and the rules only.`);
      continue;
    }
    const key = to.toLowerCase();
    if (taken.has(key)) {
      invalid.push(`"${to}" is named twice.`);
      continue;
    }
    // A path cannot be a file and a folder: `a` together with `a/b` fails at the write, or gives an archive that cannot be unpacked
    const above = foldersOf(key)
      .map((folder) => taken.get(folder))
      .find((file) => file !== undefined);
    const inside = folders.get(key);
    if (above !== undefined) {
      invalid.push(`"${to}" lies inside "${above}", which is named as a file: a path cannot be a file and a folder.`);
      continue;
    }
    if (inside !== undefined) {
      invalid.push(`"${to}" is a folder of "${inside}", which is named as well: a path cannot be a file and a folder.`);
      continue;
    }
    taken.set(key, to);
    for (const folder of foldersOf(key)) {
      if (!folders.has(folder)) {
        folders.set(folder, to);
      }
    }
    files.push({ to, from });
  }
  return { files: files.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0)), invalid };
}

/** The setting after a file or folder of the vault got another name: the file that is named is followed */
export function renameExtra(text: string, moved: (path: string) => string, normal: (path: string) => string): string {
  if (text.trim() === "") {
    return text;
  }
  return text
    .split("\n")
    .map((line) => {
      const colon = line.indexOf(":");
      const written = colon < 0 ? "" : line.slice(colon + 1).trim();
      if (colon <= 0 || written === "") {
        return line;
      }
      const from = normal(written);
      const now = moved(from);
      return now === from ? line : `${line.slice(0, colon).trim()}: ${now}`;
    })
    .join("\n");
}
