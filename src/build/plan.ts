import { type App, normalizePath } from "obsidian";
import { choose, type Choice, type VaultFile } from "../select/choose.ts";
import { parseExcludeRules } from "../select/exclude.ts";
import { invalidPropertyLines, parsePropertyRules } from "../select/properties.ts";
import { isAtOrUnder } from "../select/ticks.ts";
import { placeOf, type Settings } from "../settings.ts";
import { OLD, PART } from "./output.ts";

/** Files that Obsidian draws from what is in them. See `VaultFile.undrawn`. */
const UNDRAWN = new Set(["canvas", "base"]);

/** The files of the vault as the choice sees them. What a build writes, or has written, is not one of them. */
export function readVault(app: App, settings: Settings): VaultFile[] {
  // Where the next build writes, and where builds have written. Not the place of the other format: a name
  // typed there and never built to may be a folder of notes.
  const own = [placeOf(settings, normalizePath), ...settings.written.map((path) => normalizePath(path))];
  // An archive has another name while it is written, and one that broke off may still lie there
  const isOwn = (path: string): boolean => path.endsWith(PART) || path.endsWith(OLD) || own.some((mine) => isAtOrUnder(path, mine));
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
 * regular expression, a line that is not a property. Such a rule keeps
 * nothing out, and what it was written for would go in: a site is not built
 * while there is one.
 */
export function planSite(app: App, settings: Settings, files: readonly VaultFile[] = readVault(app, settings)): { choice: Choice; invalid: string[] } {
  const exclude = parseExcludeRules(settings.exclude);
  const choice = choose(files, {
    ticks: settings.ticks,
    exclude,
    properties: parsePropertyRules(settings.properties),
  });
  const invalid = invalidPropertyLines(settings.properties).map((line) => `"${line}" is not a property: write it as key: value.`);
  if (exclude.hasInvalid) {
    invalid.unshift("A pattern is not a valid regular expression.");
  }
  return { choice, invalid };
}
