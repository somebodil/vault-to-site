import { type App, normalizePath } from "obsidian";
import { choose, type Choice, type VaultFile } from "../select/choose.ts";
import { parseExcludeRules } from "../select/exclude.ts";
import { planExtra, type KindOfPath } from "../select/extra.ts";
import { parsePropertyRules, propertyProblems } from "../select/properties.ts";
import { isAtOrUnder } from "../select/ticks.ts";
import { placeOf, type Settings } from "../settings.ts";
import { SITE_NAMES } from "./output.ts";

/** Files that Obsidian draws from what is in them. See `VaultFile.undrawn`. */
const UNDRAWN = new Set(["canvas", "base"]);

/** The files of the vault as the choice sees them. What lies where the build writes is not one of them. */
export function readVault(app: App, settings: Settings): VaultFile[] {
  // Where the build writes: the site of the build before, which gives way. Not the place of the other
  // format: a name typed there and never built to may be a folder of notes.
  const own = placeOf(settings, normalizePath);
  const isOwn = (path: string): boolean => isAtOrUnder(path, own);
  const resolved = app.metadataCache.resolvedLinks;
  const files: VaultFile[] = [];
  for (const file of app.vault.getFiles()) {
    if (isOwn(file.path)) {
      continue;
    }
    if (file.extension !== "md") {
      files.push(UNDRAWN.has(file.extension.toLowerCase()) ? { path: file.path, isNote: false, undrawn: true } : { path: file.path, isNote: false });
      continue;
    }
    const cache = app.metadataCache.getFileCache(file);
    const note: VaultFile = { path: file.path, isNote: true, uses: Object.keys(resolved[file.path] ?? {}) };
    if (cache === null) {
      // Right after Obsidian starts, or after a sync, a note is in the vault before it is read
      note.unread = "Obsidian has not read it yet";
    } else if (cache.frontmatter !== undefined) {
      note.properties = cache.frontmatter;
    } else if (cache.frontmatterPosition !== undefined || cache.sections?.[0]?.type === "yaml") {
      const block = cache.frontmatterPosition ?? cache.sections?.[0]?.position;
      // Two lines of dashes with nothing between them are properties that say nothing. Anything else that
      // Obsidian could not read is not valid: what it says cannot be known.
      if (block === undefined || block.end.line - block.start.line > 1) {
        note.unread = "its properties cannot be read";
      }
    }
    files.push(note);
  }
  return files;
}

/**
 * What a build with these settings would hold.
 *
 * `invalid` names the rules that do not work: a pattern that is not a
 * regular expression, a line that is not a property, an extra file that is
 * not there. Such a rule keeps nothing out, and what it was written for
 * would go in, or the site would lack what it was to have: a site is not
 * built while there is one. A pattern to take in by that does not work
 * would leave out what it was written for, and stops a build as well.
 */
export function planSite(app: App, settings: Settings, files: readonly VaultFile[] = readVault(app, settings)): { choice: Choice; invalid: string[] } {
  const exclude = parseExcludeRules(settings.exclude);
  const include = parseExcludeRules(settings.include);
  const choice = choose(files, {
    ticks: settings.ticks,
    exclude,
    include,
    properties: parsePropertyRules(settings.properties),
    only: parsePropertyRules(settings.only),
  });
  const invalid = [
    ...[...exclude.invalid, ...include.invalid].map((pattern) => `The pattern "${pattern}" is not a valid regular expression.`),
    ...propertyProblems(settings.properties),
    ...propertyProblems(settings.only),
  ];
  if (settings.extra.trim() !== "") {
    // What a build writes is not among the files, so a site of an earlier build cannot be named
    const kinds = new Map<string, KindOfPath>(files.map((file) => [file.path, file.isNote ? "note" : file.undrawn === true ? "undrawn" : "file"]));
    const extra = planExtra(settings.extra, (path) => kinds.get(path) ?? "none", normalizePath, SITE_NAMES);
    choice.extra = extra.files;
    invalid.push(...extra.invalid);
  }
  return { choice, invalid };
}
