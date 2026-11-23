import { type App, getIcon, TFile } from "obsidian";
import type { Settings } from "../settings.ts";
import {
  ICON_NAMES,
  type FileEntry,
  type NoteEntry,
  type NotePage,
  type PropertyValue,
  type SearchPart,
  type SiteIndex,
} from "../site-format.ts";
import { assignIds, extensionOf } from "./ids.ts";
import { MARKER, Output } from "./output.ts";
import { planSite } from "./plan.ts";
import { renderNote, resourceMap, type RenderContext } from "./render.ts";
import { captureStyles } from "./styles.ts";

declare const VIEWER_JS: string;
declare const VIEWER_CSS: string;

/** Called as the build goes on: how much is done, of how much, and what is being worked on */
export type Progress = (done: number, total: number, label: string) => void;

export interface BuildResult {
  notes: number;
  files: number;
  folder: string;
  millis: number;
}

/** Thrown when the build was stopped from outside */
export class BuildStopped extends Error {}

/** A part of the text to search in is closed when it is this long, so that no single script gets large */
const SEARCH_PART_LENGTH = 300_000;

/**
 * Builds the site: decides what it holds, has Obsidian draw every note, and
 * writes the notes, the list of them, the text to search in, the style sheets
 * of Obsidian, the files the notes use and the script that shows it all.
 */
export async function buildSite(
  app: App,
  settings: Settings,
  version: string,
  progress: Progress,
  stop: { now: boolean },
): Promise<BuildResult> {
  const start = Date.now();
  const { choice } = planSite(app, settings);
  const ids = assignIds([...choice.notes, ...choice.files]);
  const idOf = (path: string): string => ids.get(path) ?? "";

  const noteIds = new Map(choice.notes.map((path) => [path, idOf(path)]));
  const assets = new Map(
    choice.files.map((path) => {
      const extension = extensionOf(path);
      return [path, "assets/" + idOf(path) + (extension === "" ? "" : "." + extension)];
    }),
  );

  const output = new Output(app.vault.adapter, settings.output);
  await output.prepare();
  await output.text(MARKER, JSON.stringify({ plugin: "vault-to-site", version }, null, 2) + "\n");
  await output.text(".nojekyll", "");

  const total = choice.notes.length + choice.files.length + 1;
  let done = 0;
  const step = (label: string): void => {
    if (stop.now) {
      throw new BuildStopped();
    }
    progress(done, total, label);
    done++;
  };

  const stage = activeDocument.body.createDiv({ cls: "vault-to-site-stage" });
  const context: RenderContext = { app, noteIds, assets, resourceToPath: resourceMap(app), stage };
  const notes: Record<string, NoteEntry> = {};
  let part: SearchPart = [];
  let partLength = 0;
  let parts = 0;
  const closePart = async (): Promise<void> => {
    if (part.length === 0) {
      return;
    }
    await output.text(`data/s/${String(parts)}.js`, `__site.search(${String(parts)},${JSON.stringify(part)});\n`);
    parts++;
    part = [];
    partLength = 0;
  };

  try {
    for (const path of choice.notes) {
      step(path);
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        continue;
      }
      const id = idOf(path);
      const cache = app.metadataCache.getFileCache(file);
      const text = await app.vault.cachedRead(file);
      const page: NotePage = {
        html: await renderNote(file, text, context),
        props: Object.entries(cache?.frontmatter ?? {})
          .filter(([key]) => key !== "position")
          .map(([key, value]) => [key, value as PropertyValue]),
      };
      await output.text(`data/n/${id}.js`, `__site.note(${JSON.stringify(id)},${JSON.stringify(page)});\n`);

      const links = Object.keys(app.metadataCache.resolvedLinks[path] ?? {})
        .map((to) => noteIds.get(to))
        .filter((to): to is string => to !== undefined && to !== id);
      notes[id] = { p: path, h: (cache?.headings ?? []).map((h) => [h.level, h.heading]), l: links };

      // What is searched is what was written, as in Obsidian, without the properties
      const body = text.slice(cache?.frontmatterPosition?.end.offset ?? 0);
      part.push([id, body]);
      partLength += body.length;
      if (partLength >= SEARCH_PART_LENGTH) {
        await closePart();
      }
    }
    await closePart();

    // After the notes: drawing a formula adds styles for the signs it uses
    step("Styles");
    const styles = await captureStyles(activeDocument);
    await output.text("app/obsidian.css", styles.css);
    for (const resource of styles.resources) {
      await output.binary("app/" + resource.name, resource.bytes);
    }
  } finally {
    stage.remove();
  }

  const files: Record<string, FileEntry> = {};
  for (const path of choice.files) {
    step(path);
    const asset = assets.get(path);
    if (asset === undefined) {
      continue;
    }
    await output.copy(path, asset);
    files[idOf(path)] = { p: path, a: asset };
  }

  const icons: Record<string, string> = {};
  for (const name of ICON_NAMES) {
    const icon = getIcon(name);
    if (icon !== null) {
      icons[name] = icon.outerHTML;
    }
  }
  const index: SiteIndex = {
    name: app.vault.getName(),
    notes,
    files,
    searchParts: parts,
    theme: activeDocument.body.classList.contains("theme-dark") ? "dark" : "light",
    inlineTitle: activeDocument.body.classList.contains("show-inline-title"),
    bodyStyle: activeDocument.body.getAttribute("style") ?? "",
    icons,
  };
  await output.text("data/index.js", `__site.index(${JSON.stringify(index)});\n`);
  await output.text("app/viewer.css", VIEWER_CSS);
  await output.text("app/viewer.js", VIEWER_JS);
  await output.text("index.html", indexHtml(index.name));
  progress(total, total, "");

  return { notes: choice.notes.length, files: choice.files.length, folder: output.root, millis: Date.now() - start };
}

function indexHtml(name: string): string {
  const title = name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="app/obsidian.css">
<link rel="stylesheet" href="app/viewer.css">
</head>
<body>
<noscript>This page needs JavaScript to show the notes.</noscript>
<script src="app/viewer.js"></script>
<script src="data/index.js"></script>
</body>
</html>
`;
}
