/**
 * What is ticked in the tree of folders and files.
 *
 * Only decisions are kept, not every path: a path that is in neither list has
 * what the nearest folder above it has, and nothing is ticked to begin with.
 * So a folder that is ticked takes in the notes that are added to it later.
 * The root folder is the empty path.
 */
export interface Ticks {
  /** Folders and files that are ticked */
  on: string[];
  /** Folders and files that are not ticked, inside a folder that is */
  off: string[];
}

export const NO_TICKS: Ticks = { on: [], off: [] };

/** The folder a path is in. The root folder has none. */
export function parentOf(path: string): string | null {
  if (path === "") {
    return null;
  }
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** True when `path` is `folder` or inside it */
export function isAtOrUnder(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(folder + "/");
}

/** Answers for many paths with the lists read once */
export function ticker(ticks: Ticks): (path: string) => boolean {
  const on = new Set(ticks.on);
  const off = new Set(ticks.off);
  return (path) => {
    let at: string | null = path;
    while (at !== null) {
      if (on.has(at)) {
        return true;
      }
      if (off.has(at)) {
        return false;
      }
      at = parentOf(at);
    }
    return false;
  };
}

/**
 * Ticks a folder or a file, or takes its tick away. What was decided for the
 * paths inside it is forgotten: the whole folder has the new value.
 */
export function setTick(ticks: Ticks, path: string, value: boolean): Ticks {
  const outside = (other: string): boolean => !isAtOrUnder(other, path);
  const next: Ticks = { on: ticks.on.filter(outside), off: ticks.off.filter(outside) };
  const parent = parentOf(path);
  const inherited = parent === null ? false : ticker(next)(parent);
  if (value !== inherited) {
    (value ? next.on : next.off).push(path);
  }
  next.on.sort();
  next.off.sort();
  return next;
}

/** What a folder shows: all of its files ticked, none, or some */
export type FolderState = "on" | "off" | "some";

export function folderState(files: readonly string[], isTicked: (path: string) => boolean, fallback: boolean): FolderState {
  if (files.length === 0) {
    return fallback ? "on" : "off";
  }
  let ticked = 0;
  for (const file of files) {
    if (isTicked(file)) {
      ticked++;
    }
  }
  return ticked === 0 ? "off" : ticked === files.length ? "on" : "some";
}
