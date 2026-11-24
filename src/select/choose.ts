import { pathMatcher, type ExcludeRules } from "./exclude.ts";
import type { ExtraFile } from "./extra.ts";
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
  /** When it has a pattern, only a note whose path one of them matches goes in */
  include?: ExcludeRules;
  properties: readonly PropertyRule[];
  /** When there is one, only a note with one of these properties goes in */
  only?: readonly PropertyRule[];
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
  /** Ticked notes whose path no pattern matches, when only the paths that are named go in */
  unnamed: string[];
  /** Ticked notes that are not marked for the site, when only marked notes go in */
  unmarked: string[];
  /** Links and embeds from a note of the site to something that is not in it */
  cut: { from: string; to: string }[];
  /** Every note of the vault that a rule is meant for, ticked or not: the notes whose names should not show */
  guarded: string[];
  /** Files that are named one by one to go in at a path of their own. Not decided here: see `planExtra`. */
  extra: ExtraFile[];
}

/**
 * Decides what the site holds.
 *
 * Ticks are for notes. A pattern or a property always wins over a tick, and
 * a note whose properties are not known stays out as well: it cannot be said
 * that no rule is meant for it. Where only marked notes go in, a ticked note
 * needs the mark as well: a property as `publish: true`. That is the way for
 * a site that is built with nobody looking the list over, where a new note
 * must not go in by being new. Where only the paths that are named go in, a
 * ticked note needs a pattern that matches its path as well. A file that is
 * not a note needs none: it comes with the note that uses it.
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
  const isExcluded = pathMatcher(rules.exclude);
  const isNamed = rules.include === undefined || rules.include.patterns.length === 0 ? (): boolean => true : pathMatcher(rules.include);
  const byPath = new Map(files.map((file) => [file.path, file]));

  const notes = new Set<string>();
  const others = new Set<string>();
  const byPattern = new Set<string>();
  const byProperty: Choice["byProperty"] = [];
  const unread: Choice["unread"] = [];
  const unnamed: string[] = [];
  const unmarked: string[] = [];
  const only = rules.only ?? [];
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
    } else if (!isNamed(file.path)) {
      // Before the properties are asked for: a note that is out by its path is out whatever they say
      unnamed.push(file.path);
    } else if (file.unread !== undefined) {
      unread.push({ path: file.path, why: file.unread });
    } else if (only.length > 0 && matchingRule(file.properties, only) === null) {
      unmarked.push(file.path);
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
    unnamed: unnamed.sort(),
    unmarked: unmarked.sort(),
    // The plain order, as for the notes: this runs at every tick in the dialog, and with tens of thousands of links the order of a language costs most of it
    cut: cut.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0)),
    guarded: sorted(guarded),
    extra: [],
  };
}

/**
 * A sign of what a choice holds: two choices with the same notes and files
 * have the same. It is not saved: the step that shows the list hands it to
 * the build, and the build works it out again, so that a vault that has
 * changed since the list was looked over is told.
 */
export function signatureOf(choice: Choice): string {
  return JSON.stringify([choice.notes, choice.files, choice.extra.map((file) => [file.to, file.from])]);
}
