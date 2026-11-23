import { type App, getIcon, normalizePath, TFile } from "obsidian";
import { signatureOf } from "../select/choose.ts";
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
import { mentionFinder, type Mention } from "./mentions.ts";
import { FolderOutput, MARKER, type SiteOutput, ZipOutput } from "./output.ts";
import { planSite } from "./plan.ts";
import { renderNote, resourceMap, type RenderContext } from "./render.ts";
import { captureStyles } from "./styles.ts";
import { shownValue, shownWords } from "./words.ts";

declare const VIEWER_JS: string;
declare const VIEWER_CSS: string;

/** Called as the build goes on: how much is done, of how much, and what is being worked on */
export type Progress = (done: number, total: number, label: string) => void;

export interface BuildResult {
  notes: number;
  files: number;
  /** The archive or the folder, from the root of the vault */
  place: string;
  bytes: number;
  millis: number;
  /** Writes that had to be done a second time */
  rewritten: number;
  /** Notes that Obsidian could not draw. The site says so in their place. */
  failed: { path: string; message: string }[];
  /** Notes that were taken as they were when their time ran out, with a part of them not there yet */
  unfinished: string[];
  /** Notes that a rule is meant for and whose name shows on a page of the site */
  mentions: Mention[];
}

/** Thrown when the build was stopped from outside */
export class BuildStopped extends Error {}

/** A part of the text to search in is closed when it is this long, so that no single script gets large */
const SEARCH_PART_LENGTH = 300_000;

/** What a zip archive can hold without the 64-bit form of the format. The site has some files of its own beside the notes. */
const MOST_FILES_IN_ZIP = 65_535 - 200;

/**
 * How many notes are drawn at a time. Obsidian takes about 60 ms to draw a
 * note, however short, and nearly all of it is waiting. Measured on an
 * emulated phone with 3000 notes: one after the other 160 s, four at a time
 * 40 to 55 s, and 20 to 30 s from eight on. More than that gains nothing.
 */
const AT_A_TIME = 16;

/** A build writes to one place and uses the page of Obsidian to draw: there is one at a time */
let isBuilding = false;

/**
 * Builds the site: decides what it holds, has Obsidian draw every note, and
 * writes the notes, the list of them, the text to search in, the style sheets
 * of Obsidian, the files the notes use and the script that shows it all.
 *
 * @param reviewed the sign of the choice that was looked over (`signatureOf`). The build is not done when the vault has changed since.
 */
export async function buildSite(
  app: App,
  settings: Settings,
  version: string,
  reviewed: string,
  progress: Progress,
  stop: { now: boolean },
): Promise<BuildResult> {
  if (isBuilding) {
    throw new Error("Another build is still running or stopping. Try again in a moment.");
  }
  isBuilding = true;
  try {
    return await build(app, settings, version, reviewed, progress, stop);
  } finally {
    isBuilding = false;
  }
}

async function build(app: App, settings: Settings, version: string, reviewed: string, progress: Progress, stop: { now: boolean }): Promise<BuildResult> {
  const start = Date.now();
  const { choice } = planSite(app, settings);
  if (signatureOf(choice) !== reviewed) {
    throw new Error("The vault has changed since you looked the site over: other notes or files would go in now. Look it over again.");
  }
  if (settings.format === "zip" && choice.notes.length + choice.files.length > MOST_FILES_IN_ZIP) {
    throw new Error("The site has too many files for one zip archive. Build it as a folder.");
  }
  const ids = assignIds([...choice.notes, ...choice.files]);
  const idOf = (path: string): string => ids.get(path) ?? "";

  const noteIds = new Map(choice.notes.map((path) => [path, idOf(path)]));
  const assets = new Map(
    choice.files.map((path) => {
      const extension = extensionOf(path);
      return [path, "assets/" + idOf(path) + (extension === "" ? "" : "." + extension)];
    }),
  );

  const output: SiteOutput =
    settings.format === "zip"
      ? new ZipOutput(app.vault.adapter, normalizePath(settings.zip))
      : new FolderOutput(app.vault.adapter, normalizePath(settings.folder));
  await output.prepare();

  const total = choice.notes.length + choice.files.length + 1;
  let done = 0;
  const check = (): void => {
    if (stop.now) {
      throw new BuildStopped();
    }
  };

  const doc = activeDocument;
  const stage = doc.body.createDiv({ cls: "vault-to-site-stage" });
  const context: RenderContext = { app, noteIds, assets, resourceToPath: resourceMap(app), stage };
  const failed: BuildResult["failed"] = [];
  const unfinished: string[] = [];
  const notes: Record<string, NoteEntry> = {};
  const mentions = mentionFinder(choice.guarded);
  // The words of the notes, for the search. A part is written when it is full, so that the words of a
  // large vault are not all held at once.
  let part: SearchPart = [];
  let partLength = 0;
  let parts = 0;
  const closePart = async (): Promise<void> => {
    if (part.length === 0) {
      return;
    }
    const full = part;
    const number = parts++;
    part = [];
    partLength = 0;
    await output.text(`data/s/${String(number)}.js`, `__site.search(${String(number)},${JSON.stringify(full)});\n`);
  };

  const drawNote = async (at: number): Promise<void> => {
    const path = choice.notes[at];
    const file = path === undefined ? null : app.vault.getAbstractFileByPath(path);
    if (path === undefined || !(file instanceof TFile)) {
      return;
    }
    progress(done, total, path);
    const id = idOf(path);
    const cache = app.metadataCache.getFileCache(file);
    // A property or a heading reaches the site as it was written, not as Obsidian draws it: its links are shown as their words
    const page: NotePage = {
      html: "",
      props: Object.entries(cache?.frontmatter ?? {})
        .filter(([key]) => key !== "position")
        .map(([key, value]) => [key, shownValue(value as PropertyValue)]),
      h: (cache?.headings ?? []).map((heading) => [heading.level, shownWords(heading.heading)]),
    };
    let words = "";
    try {
      const rendered = await renderNote(file, await app.vault.cachedRead(file), context);
      page.html = rendered.html;
      words = rendered.text;
      if (!rendered.isWhole) {
        unfinished.push(path);
      }
    } catch (error) {
      console.error(error);
      failed.push({ path, message: error instanceof Error ? error.message : String(error) });
      page.html = '<p class="v2s-empty">This note could not be drawn when the site was built.</p>';
    }
    await output.text(`data/n/${id}.js`, `__site.note(${JSON.stringify(id)},${JSON.stringify(page)});\n`);

    // The properties are shown above the note, so they are words of the page as well
    const properties = page.props.map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
    const text = [...properties, words].join("\n");
    mentions.add(path, text);
    part.push([id, text]);
    partLength += text.length;
    if (partLength >= SEARCH_PART_LENGTH) {
      await closePart();
    }
    const links = Object.keys(app.metadataCache.resolvedLinks[path] ?? {})
      .map((to) => noteIds.get(to))
      .filter((to): to is string => to !== undefined && to !== id);
    notes[id] = { p: path, l: links };
    done++;
  };

  try {
    await output.text(MARKER, JSON.stringify({ plugin: "vault-to-site", version }, null, 2) + "\n");
    await output.text(".nojekyll", "");

    try {
      // When one of them cannot go on, as when a write fails, the others stop too: they are not left to write into a build that is over
      let next = 0;
      // Kept in an object: what a function sets from inside is not seen by the compiler on a plain variable
      const first: { failure: Error | null } = { failure: null };
      const worker = async (): Promise<void> => {
        while (next < choice.notes.length && first.failure === null) {
          try {
            check();
            await drawNote(next++);
          } catch (error) {
            first.failure ??= error instanceof Error ? error : new Error(String(error));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(AT_A_TIME, choice.notes.length) }, worker));
      if (first.failure !== null) {
        throw first.failure;
      }
      check();

      // After the notes: drawing a formula adds styles for the signs it uses
      progress(done, total, "Styles");
      const styles = await captureStyles(doc);
      await output.text("app/obsidian.css", styles.css);
      for (const resource of styles.resources) {
        await output.binary("app/" + resource.name, resource.bytes);
      }
      done++;
    } finally {
      stage.remove();
    }

    await closePart();

    const files: Record<string, FileEntry> = {};
    for (const path of choice.files) {
      check();
      progress(done, total, path);
      const asset = assets.get(path);
      if (asset !== undefined) {
        await output.copy(path, asset);
        files[idOf(path)] = { p: path, a: asset };
      }
      done++;
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
      theme: doc.body.classList.contains("theme-dark") ? "dark" : "light",
      inlineTitle: doc.body.classList.contains("show-inline-title"),
      bodyStyle: doc.body.getAttribute("style") ?? "",
      icons,
    };
    await output.text("data/index.js", `__site.index(${JSON.stringify(index)});\n`);
    await output.text("app/viewer.css", VIEWER_CSS);
    await output.text("app/viewer.js", VIEWER_JS);
    // The page itself comes last: a folder without it is not taken for a site
    await output.text("index.html", indexHtml(index.name, doc.documentElement.lang));
    check();
    progress(total, total, "Writing");
    const written = await output.finish();
    progress(total, total, "");

    return {
      notes: choice.notes.length,
      files: choice.files.length,
      place: written.place,
      bytes: written.bytes,
      millis: Date.now() - start,
      rewritten: output.rewritten,
      failed: failed.sort((a, b) => a.path.localeCompare(b.path)),
      unfinished: unfinished.sort(),
      mentions: mentions.found(),
    };
  } catch (error) {
    await output.abort().catch(() => undefined);
    throw error;
  }
}

/** @param language the language Obsidian is set to: the browser chooses fonts and breaks words by it, as Obsidian does */
function indexHtml(name: string, language: string): string {
  const title = name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : "en";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="data:,">
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
