/**
 * Names for the files of the site. A note called `한글 노트.md` in a folder with
 * spaces would make an address that breaks somewhere, so every note and file
 * gets a short name made of its path: the same path gives the same name in
 * every build, and addresses stay good.
 */

/** A 53-bit hash of a string (cyrb53), as text in base 36 */
export function hashOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** One name for each path. Two paths with the same hash get different names. */
export function assignIds(paths: readonly string[]): Map<string, string> {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  for (const path of [...paths].sort()) {
    let id = hashOf(path);
    for (let n = 2; taken.has(id); n++) {
      id = hashOf(path) + "-" + String(n);
    }
    taken.add(id);
    ids.set(path, id);
  }
  return ids;
}

/**
 * The ending of a file name in lower case, without the dot. Empty when there
 * is none, and when it is not made of letters and digits, ten at most: an
 * ending goes into an address of the site as it is, and a sign as `?` or `#`
 * would cut the address there, as in `a.png?raw=true`.
 */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ending = dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ending) ? ending : "";
}
