import { type App, normalizePath } from "obsidian";
import { choose, type Choice, type VaultFile } from "../select/choose.ts";
import { parseExcludeRules } from "../select/exclude.ts";
import { parsePropertyRules } from "../select/properties.ts";
import { isAtOrUnder } from "../select/ticks.ts";
import type { Settings } from "../settings.ts";

/** The files of the vault as the choice sees them. The folder of the site itself is not one of them. */
export function readVault(app: App, output: string): VaultFile[] {
  const root = normalizePath(output);
  const resolved = app.metadataCache.resolvedLinks;
  const files: VaultFile[] = [];
  for (const file of app.vault.getFiles()) {
    if (isAtOrUnder(file.path, root)) {
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
export function planSite(app: App, settings: Settings): { choice: Choice; hasInvalidPattern: boolean } {
  const exclude = parseExcludeRules(settings.exclude);
  const choice = choose(readVault(app, settings.output), {
    ticks: settings.ticks,
    exclude,
    properties: parsePropertyRules(settings.properties),
  });
  return { choice, hasInvalidPattern: exclude.hasInvalid };
}
