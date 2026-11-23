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
  /** By the first word of a name: the names that start with it, and where that word starts in them */
  const byFirstWord = new Map<string, { path: string; name: string; lead: number }[]>();
  for (const path of keptOut) {
    const name = nameOf(path).toLowerCase();
    WORD.lastIndex = 0;
    const first = WORD.exec(name);
    if (name.length < SHORTEST || first === null) {
      continue;
    }
    const list = byFirstWord.get(first[0]);
    const entry = { path, name, lead: first.index };
    if (list === undefined) {
      byFirstWord.set(first[0], [entry]);
    } else {
      list.push(entry);
    }
  }
  /** The lengths the first words of the names have: a word of the text is looked up with its starts of these lengths */
  const lengths = [...new Set([...byFirstWord.keys()].map((word) => word.length))].sort((a, b) => a - b);
  const shown = new Map<string, Set<string>>();

  return {
    add(pagePath, pageText) {
      if (byFirstWord.size === 0) {
        return;
      }
      const text = pageText.toLowerCase();
      // A pattern of its own: this may run while another page is looked through
      const words = new RegExp(WORD.source, WORD.flags);
      for (let word = words.exec(text); word !== null; word = words.exec(text)) {
        for (const length of lengths) {
          if (length > word[0].length) {
            break;
          }
          for (const candidate of byFirstWord.get(length === word[0].length ? word[0] : word[0].slice(0, length)) ?? []) {
            const start = word.index - candidate.lead;
            const after = text.charAt(start + candidate.name.length);
            const goesOn = LETTER.test(after) && LATIN.test(candidate.name.charAt(candidate.name.length - 1));
            if (goesOn || !text.startsWith(candidate.name, start)) {
              continue;
            }
            let pagesOf = shown.get(candidate.path);
            if (pagesOf === undefined) {
              pagesOf = new Set();
              shown.set(candidate.path, pagesOf);
            }
            pagesOf.add(pagePath);
          }
        }
      }
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
