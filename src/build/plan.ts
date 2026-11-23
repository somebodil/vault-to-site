import { type App, normalizePath } from "obsidian";
import { choose, type Choice, type VaultFile } from "../select/choose.ts";
import { parseExcludeRules } from "../select/exclude.ts";
import { parsePropertyRules } from "../select/properties.ts";
import { isAtOrUnder } from "../select/ticks.ts";
import type { Settings } from "../settings.ts";
import { zipPath } from "./output.ts";

/** The files of the vault as the choice sees them. What a build writes is not one of them. */
export function readVault(app: App, settings: Settings): VaultFile[] {
  const own = [zipPath(normalizePath(settings.zip)), normalizePath(settings.folder)];
  const resolved = app.metadataCache.resolvedLinks;
  const files: VaultFile[] = [];
  for (const file of app.vault.getFiles()) {
    if (own.some((path) => isAtOrUnder(file.path, path))) {
      continue;
    }
    if (file.extension !== "md") {
      files.push({ path: file.path, isNote: false });
      continue;
    }
    files.push({
      path: file.path,
      isNote: true,
      properties: app.metadataCache.getFileCache(file)?.frontmatter,
      uses: Object.keys(resolved[file.path] ?? {}),
    });
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
