import type { ExcludeRules } from "./exclude.ts";
import { matchingRule, type PropertyRule } from "./properties.ts";
import { ticker, type Ticks } from "./ticks.ts";

/** What the choice needs to know of a file of the vault */
export interface VaultFile {
  path: string;
  /** A Markdown note. Everything else is a file that notes use or that is opened as it is. */
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
  /** The other files of the site: ticked, or used by one of the notes */
  files: string[];
  /** The files that are there only because a note uses them */
  pulledIn: string[];
  /** Ticked notes that a property keeps out */
  byProperty: { path: string; rule: PropertyRule }[];
  /** Ticked paths, and files a note uses, that a pattern keeps out */
  byPattern: string[];
  /** Ticked notes whose properties are not known, and why. They stay out: a rule may be meant for them. */
  unread: { path: string; why: string }[];
  /** Ticked files that only notes outside the site use: they stay out with those notes */
  withNotes: string[];
  /** Ticked canvases, bases and the like: files the site cannot draw */
  undrawn: string[];
  /** Links and embeds from a note of the site to a note that is not in it */
  cut: { from: string; to: string }[];
  /** Every note of the vault that a rule is meant for, ticked or not: the notes whose names should not show */
  guarded: string[];
}

/**
 * Decides what the site holds.
 *
 * A pattern or a property always wins over a tick. A note whose properties
 * are not known stays out as well: it cannot be said that no rule is meant
 * for it.
 *
 * A file that is not a note comes along when a note of the site uses it,
 * ticked or not: a note without its pictures is not what was asked for. A
 * note never comes along that way.
 *
 * A file that notes use, but none of the site, stays out even when it is
 * ticked. Otherwise ticking a whole folder of pictures would put the
 * pictures of a private note into the site without the note. A ticked file
 * that no note uses goes in: it was asked for on its own.
 */
export function choose(files: readonly VaultFile[], rules: ChoiceRules): Choice {
  const isTicked = ticker(rules.ticks);
  // The same letters can be stored as one sign or as its parts: a path is compared in the form the patterns have
  const isExcluded = (path: string): boolean => {
    const normal = path.normalize("NFC");
    return rules.exclude.patterns.some((pattern) => pattern.test(normal));
  };
  const byPath = new Map(files.map((file) => [file.path, file]));

  /** The files that are not notes and that some note of the vault uses */
  const used = new Set<string>();
  for (const file of files) {
    for (const to of file.uses ?? []) {
      if (byPath.get(to)?.isNote === false) {
        used.add(to);
      }
    }
  }

  const notes = new Set<string>();
  const others = new Set<string>();
  /** Ticked files that a note uses: they go in only when a note of the site does */
  const waiting = new Set<string>();
  const pulledIn = new Set<string>();
  const byPattern = new Set<string>();
  const byProperty: Choice["byProperty"] = [];
  const unread: Choice["unread"] = [];
  const undrawn: string[] = [];
  const guarded: string[] = [];

  for (const file of files) {
    const excluded = isExcluded(file.path);
    const rule = file.isNote && !excluded ? matchingRule(file.properties, rules.properties) : null;
    if (file.isNote && (excluded || rule !== null || file.unread !== undefined)) {
      guarded.push(file.path);
    }
    if (!isTicked(file.path)) {
      continue;
    }
    if (excluded) {
      byPattern.add(file.path);
    } else if (file.undrawn === true) {
      undrawn.push(file.path);
    } else if (!file.isNote) {
      (used.has(file.path) ? waiting : others).add(file.path);
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
        continue;
      }
      if (others.has(to)) {
        continue;
      }
      if (target.undrawn === true) {
        cut.push({ from, to });
        continue;
      }
      if (waiting.delete(to)) {
        others.add(to);
        continue;
      }
      if (isExcluded(to)) {
        byPattern.add(to);
        cut.push({ from, to });
        continue;
      }
      others.add(to);
      pulledIn.add(to);
    }
  }

  const sorted = (paths: Iterable<string>): string[] => [...paths].sort();
  const byPathOrder = (a: { path: string }, b: { path: string }): number => a.path.localeCompare(b.path);
  return {
    notes: sorted(notes),
    files: sorted(others),
    pulledIn: sorted(pulledIn),
    byProperty: byProperty.sort(byPathOrder),
    byPattern: sorted(byPattern),
    unread: unread.sort(byPathOrder),
    withNotes: sorted(waiting),
    undrawn: sorted(undrawn),
    cut: cut.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    guarded: sorted(guarded),
  };
}

/** A sign of what a choice holds: two choices with the same notes and files have the same */
export function signatureOf(choice: Choice): string {
  return JSON.stringify([choice.notes, choice.files]);
}
