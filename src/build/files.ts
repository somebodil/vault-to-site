/**
 * Where the files of a site go, and how the list on the left of the site
 * shows them. Nothing here touches the vault, so it is tested with plain
 * Node.js.
 */
import type { ExtraFile } from "../select/extra.ts";
import { fileAddress, type FileEntry } from "../site-format.ts";
import { assignIds, extensionOf } from "./ids.ts";

/**
 * What a file at a path of its own is named by, for its id: no path of the
 * vault starts with a slash, so this is never the name of a note or of a
 * file that a note uses, also when the path in the site is the same.
 */
const OWN_PATH = "/";

export interface SiteFiles {
  /** The id of each note and of each file the notes use, by its path in the vault */
  ids: Map<string, string>;
  /** The address of each file the notes use, by its path in the vault: where a link or an embed of a note leads */
  addresses: Map<string, string>;
  /** The files the notes use that are copied into `assets`: the path in the vault and the path in the site */
  copies: [from: string, to: string][];
  /** The files of the list on the left of the site, by id */
  entries: Record<string, FileEntry>;
}

/**
 * Lays out the files of a site.
 *
 * A file the notes use goes into `assets`, under its id, and the list shows
 * it at its path in the vault. A file at a path of its own lies at that path,
 * and the list shows it there. When the notes use such a file as well, it is
 * in the site once, at its own path: the notes lead there, and it is not
 * copied a second time. Named at two paths of its own, it is at both, and
 * the notes lead to the first.
 *
 * @param notes the paths of the notes of the site
 * @param files the paths of the files the notes use
 * @param extra the files at a path of their own, in the order of their paths in the site
 */
export function layOutFiles(notes: readonly string[], files: readonly string[], extra: readonly ExtraFile[]): SiteFiles {
  const used = new Set(files);
  const ownPath = new Map<string, string>();
  for (const file of extra) {
    if (used.has(file.from) && !ownPath.has(file.from)) {
      ownPath.set(file.from, file.to);
    }
  }
  const alone = extra.filter((file) => ownPath.get(file.from) !== file.to);
  const ids = assignIds([...notes, ...files, ...alone.map((file) => OWN_PATH + file.to)]);
  const idOf = (key: string): string => ids.get(key) ?? "";

  const addresses = new Map<string, string>();
  const copies: [string, string][] = [];
  const entries: Record<string, FileEntry> = {};
  for (const path of files) {
    const own = ownPath.get(path);
    if (own === undefined) {
      const extension = extensionOf(path);
      const asset = "assets/" + idOf(path) + (extension === "" ? "" : "." + extension);
      addresses.set(path, asset);
      copies.push([path, asset]);
      entries[idOf(path)] = { p: path, a: asset };
    } else {
      addresses.set(path, fileAddress(own));
      entries[idOf(path)] = { p: own, a: own };
    }
  }
  for (const file of alone) {
    entries[idOf(OWN_PATH + file.to)] = { p: file.to, a: file.to };
    ids.delete(OWN_PATH + file.to);
  }
  return { ids, addresses, copies, entries };
}
