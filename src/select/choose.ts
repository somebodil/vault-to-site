import type { ExcludeRules } from "./exclude.ts";
import { matchingRule, type PropertyRule } from "./properties.ts";
import { ticker, type Ticks } from "./ticks.ts";

/** What the choice needs to know of a file of the vault */
export interface VaultFile {
  path: string;
  /** A Markdown note. Everything else is a file that notes use. */
  isNote: boolean;
  /** The properties of a note */
  properties?: Record<string, unknown>;
  /**
   * A file that Obsidian draws from what is in it, as a canvas or a base. The
   * site cannot draw it, and as a plain file it would carry the paths and the
   * text it holds, also those of notes that are kept out. It stays out.
   */
  undrawn?: boolean;
  /** Why the properties of a note are not known, when they are not: such a note cannot be checked against the rules */
  unread?: string;
  /** The files a note links to or embeds, as paths of files that exist */
  uses?: readonly string[];
}

export interface ChoiceRules {
  ticks: Ticks;
  exclude: ExcludeRules;
  properties: readonly PropertyRule[];
}

/** What goes into the site, and what was kept out of it and why */
export interface Choice {
  /** The notes of the site */
  notes: string[];
  /** The other files of the site: those that its notes use */
  files: string[];
  /** Ticked notes that a property keeps out */
  byProperty: { path: string; rule: PropertyRule }[];
  /** Ticked notes, and files a note of the site uses, that a pattern keeps out */
  byPattern: string[];
  /** Ticked notes whose properties are not known, and why. They stay out: a rule may be meant for them. */
  unread: { path: string; why: string }[];
  /** Links and embeds from a note of the site to something that is not in it */
  cut: { from: string; to: string }[];
  /** Every note of the vault that a rule is meant for, ticked or not: the notes whose names should not show */
  guarded: string[];
}

/**
 * Decides what the site holds.
 *
 * Ticks are for notes. A pattern or a property always wins over a tick, and
 * a note whose properties are not known stays out as well: it cannot be said
 * that no rule is meant for it.
 *
 * A file that is not a note is never chosen by a tick. It goes in when a
 * note of the site uses it, and only then: a note without its pictures is
 * not what was asked for, and a picture without a note of the site was not
 * asked for at all. So ticking the whole vault does not put the pictures of
 * a private note into the site, nor a file that lies in a folder of private
 * notes and that no note links to.
 */
export function choose(files: readonly VaultFile[], rules: ChoiceRules): Choice {
  const isTicked = ticker(rules.ticks);
  // The same letters can be stored as one sign or as its parts: a path is compared in the form the patterns have
  const isExcluded = (path: string): boolean => {
    const normal = path.normalize("NFC");
    return rules.exclude.patterns.some((pattern) => pattern.test(normal));
  };
  const byPath = new Map(files.map((file) => [file.path, file]));

  const notes = new Set<string>();
  const others = new Set<string>();
  const byPattern = new Set<string>();
  const byProperty: Choice["byProperty"] = [];
  const unread: Choice["unread"] = [];
  const guarded: string[] = [];

  for (const file of files) {
    if (!file.isNote) {
      continue;
    }
    const excluded = isExcluded(file.path);
    const rule = excluded ? null : matchingRule(file.properties, rules.properties);
    if (excluded || rule !== null || file.unread !== undefined) {
      guarded.push(file.path);
    }
    if (!isTicked(file.path)) {
      continue;
    }
    if (excluded) {
      byPattern.add(file.path);
    } else if (rule !== null) {
      byProperty.push({ path: file.path, rule });
    } else if (file.unread !== undefined) {
      unread.push({ path: file.path, why: file.unread });
    } else {
      notes.add(file.path);
    }
  }

  const cut: Choice["cut"] = [];
  for (const from of notes) {
    for (const to of byPath.get(from)?.uses ?? []) {
      const target = byPath.get(to);
      if (target === undefined || to === from) {
        continue;
      }
      if (target.isNote) {
        if (!notes.has(to)) {
          cut.push({ from, to });
        }
      } else if (target.undrawn === true) {
        cut.push({ from, to });
      } else if (isExcluded(to)) {
        byPattern.add(to);
        cut.push({ from, to });
      } else {
        others.add(to);
      }
    }
  }

  const sorted = (paths: Iterable<string>): string[] => [...paths].sort();
  const byPathOrder = (a: { path: string }, b: { path: string }): number => a.path.localeCompare(b.path);
  return {
    notes: sorted(notes),
    files: sorted(others),
    byProperty: byProperty.sort(byPathOrder),
    byPattern: sorted(byPattern),
    unread: unread.sort(byPathOrder),
    // The plain order, as for the notes: this runs at every tick in the dialog, and with tens of thousands of links the order of a language costs most of it
    cut: cut.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0)),
    guarded: sorted(guarded),
  };
}

/** A sign of what a choice holds: two choices with the same notes and files have the same */
export function signatureOf(choice: Choice): string {
  return JSON.stringify([choice.notes, choice.files]);
}
