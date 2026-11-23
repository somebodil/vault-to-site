/**
 * Finds where the site shows the name of a note that a rule keeps out.
 *
 * The build empties embeds and links that point out of the site, but it
 * cannot know what else puts a name on a page: the words of a link, a
 * sentence that mentions the note, or the output of another plugin, such as a
 * query that lists notes. So after the notes are drawn, their words are
 * looked through for those names, and the build says what it found. It does
 * not change the pages: whether a name may show is for the person to say.
 */

/** A note that is kept out, and the notes of the site that show its name */
export interface Mention {
  /** Path of the note that is kept out */
  path: string;
  /** Paths of the notes of the site that show its name */
  shownIn: string[];
}

const WORD = /[\p{L}\p{N}]+/gu;
/** A shorter name is a common word more often than a name */
const SHORTEST = 3;

/**
 * A name and a text as they are compared: in lower case, with letters in one
 * form (a name of a file may be stored with its letters taken apart), and
 * with one space wherever there is room between words.
 */
function fold(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/[^\S\n]+/g, " ");
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

/** A letter or digit of the Latin script: where a name ends with one, a longer word is another word */
const LATIN = /[0-9a-z\u00c0-\u024f]/i;
const LETTER = /[\p{L}\p{N}]/u;

/** Looks through the pages for names, one page at a time, so that the words of all pages need not be kept */
export interface MentionFinder {
  /** Looks through the words of one page */
  add(path: string, text: string): void;
  /** What was found so far */
  found(): Mention[];
  /** True when the name of one of the notes stands in a text. Nothing is kept of it. */
  names(text: string): boolean;
}

/**
 * Looks through every text once, whatever the number of names: a word of the
 * text is looked up among the first words of the names, and only the names
 * that start with it are compared.
 *
 * A name starts where a word starts. In the Latin script it also ends where
 * a word ends, so that `plan` is not found in `planet`. In scripts that add
 * endings to a word without a space, as Korean does, it may go on.
 */
export function mentionFinder(keptOut: readonly string[]): MentionFinder {
  /**
   * By the first word of a name: the names that start with it. Names of the
   * same length with their first word at the same place, as a year of daily
   * notes, are found with one lookup, not with one comparison each.
   */
  const byFirstWord = new Map<string, { shapes: { lead: number; length: number }[]; paths: Map<string, string[]> }>();
  for (const path of keptOut) {
    const name = fold(nameOf(path));
    WORD.lastIndex = 0;
    const first = WORD.exec(name);
    if (name.length < SHORTEST || first === null) {
      continue;
    }
    let entry = byFirstWord.get(first[0]);
    if (entry === undefined) {
      entry = { shapes: [], paths: new Map() };
      byFirstWord.set(first[0], entry);
    }
    if (!entry.shapes.some((shape) => shape.lead === first.index && shape.length === name.length)) {
      entry.shapes.push({ lead: first.index, length: name.length });
    }
    entry.paths.set(name, [...(entry.paths.get(name) ?? []), path]);
  }
  /** The lengths the first words of the names have: a word of the text is looked up with its starts of these lengths */
  const lengths = [...new Set([...byFirstWord.keys()].map((word) => word.length))].sort((a, b) => a - b);
  const shown = new Map<string, Set<string>>();

  /** Goes through a text and gives the notes whose name stands in it to `hit`. `hit` ends the walk by answering true. */
  const scan = (pageText: string, hit: (paths: readonly string[]) => boolean): void => {
    if (byFirstWord.size === 0) {
      return;
    }
    const text = fold(pageText);
    // A pattern of its own: this may run while another page is looked through
    const words = new RegExp(WORD.source, WORD.flags);
    for (let word = words.exec(text); word !== null; word = words.exec(text)) {
      for (const length of lengths) {
        if (length > word[0].length) {
          break;
        }
        const entry = byFirstWord.get(length === word[0].length ? word[0] : word[0].slice(0, length));
        for (const shape of entry?.shapes ?? []) {
          const start = word.index - shape.lead;
          const name = start < 0 ? "" : text.slice(start, start + shape.length);
          const paths = entry?.paths.get(name);
          if (paths === undefined) {
            continue;
          }
          const goesOn = LETTER.test(text.charAt(start + shape.length)) && LATIN.test(name.charAt(name.length - 1));
          if (!goesOn && hit(paths)) {
            return;
          }
        }
      }
    }
  };

  return {
    add(pagePath, pageText) {
      scan(pageText, (paths) => {
        for (const path of paths) {
          let pagesOf = shown.get(path);
          if (pagesOf === undefined) {
            pagesOf = new Set();
            shown.set(path, pagesOf);
          }
          pagesOf.add(pagePath);
        }
        return false;
      });
    },
    names(text) {
      let isNamed = false;
      scan(text, () => (isNamed = true));
      return isNamed;
    },
    found() {
      return [...shown]
        .map(([path, pagesOf]) => ({ path, shownIn: [...pagesOf].sort() }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
  };
}

/** The same for pages that are all there */
export function findMentions(pages: readonly { path: string; text: string }[], keptOut: readonly string[]): Mention[] {
  const finder = mentionFinder(keptOut);
  for (const page of pages) {
    finder.add(page.path, page.text);
  }
  return finder.found();
}
