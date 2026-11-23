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

/**
 * Follows a folder or file that was given another name or place. Without
 * this, a note that was left out of a ticked folder would be back in the
 * site after it was renamed: its path would no longer be in the list.
 */
export function renameTicks(ticks: Ticks, from: string, to: string): Ticks {
  const isMoved = (path: string): boolean => isAtOrUnder(path, from) && from !== "";
  const moved = (path: string): string => (path === from ? to : to + path.slice(from.length));
  // What was decided for the new path before belongs to something that is not there any more: what moves there decides
  const isStale = (path: string): boolean => !isMoved(path) && to !== "" && isAtOrUnder(path, to);
  const follow = (paths: string[]): string[] => [...new Set(paths.filter((path) => !isStale(path)).map((path) => (isMoved(path) ? moved(path) : path)))].sort();
  return { on: follow(ticks.on), off: follow(ticks.off) };
}

/**
 * The decisions that point at nothing: paths that are in a list and not in
 * the vault. A path that was left out and is gone was deleted, or it was
 * renamed while the plugin could not see it, as by a sync: then what it was
 * is back in the site.
 */
export function missingTicks(ticks: Ticks, exists: (path: string) => boolean): Ticks {
  const gone = (path: string): boolean => path !== "" && !exists(path);
  return { on: ticks.on.filter(gone), off: ticks.off.filter(gone) };
}
