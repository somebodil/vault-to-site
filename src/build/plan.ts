import { type App, normalizePath } from "obsidian";
import { choose, type Choice, type VaultFile } from "../select/choose.ts";
import { parseExcludeRules } from "../select/exclude.ts";
import { parsePropertyRules } from "../select/properties.ts";
import { isAtOrUnder } from "../select/ticks.ts";
import type { Settings } from "../settings.ts";
import { zipPath } from "./output.ts";

/** Files that Obsidian draws from what is in them. See `VaultFile.undrawn`. */
const UNDRAWN = new Set(["canvas", "base"]);

/** The files of the vault as the choice sees them. What a build writes, or has written, is not one of them. */
export function readVault(app: App, settings: Settings): VaultFile[] {
  const archive = zipPath(normalizePath(settings.zip));
  // The archive while it is written has another name, and one that broke off may still lie there
  const own = [archive, archive + ".part", archive + ".old", normalizePath(settings.folder), ...settings.written.map((path) => normalizePath(path))];
  const resolved = app.metadataCache.resolvedLinks;
  const files: VaultFile[] = [];
  for (const file of app.vault.getFiles()) {
    if (own.some((path) => isAtOrUnder(file.path, path))) {
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
      // The note starts with properties, but they are not valid: what they say cannot be known
      note.unread = "its properties cannot be read";
    }
    files.push(note);
  }
  return files;
}

/** What a build with these settings would hold */
export function planSite(app: App, settings: Settings, files: readonly VaultFile[] = readVault(app, settings)): { choice: Choice; hasInvalidPattern: boolean } {
  const exclude = parseExcludeRules(settings.exclude);
  const choice = choose(files, {
    ticks: settings.ticks,
    exclude,
    properties: parsePropertyRules(settings.properties),
  });
  return { choice, hasInvalidPattern: exclude.hasInvalid };
}
