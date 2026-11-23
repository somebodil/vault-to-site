import { type App, getIcon, normalizePath, parseLinktext, Platform, TFile } from "obsidian";
import { signatureOf } from "../select/choose.ts";
import { placeOf, type Settings } from "../settings.ts";
import {
  ICON_NAMES,
  type FileEntry,
  type NoteEntry,
  noteAddress,
  type NotePage,
  type PropertyEntry,
  type PropertyValue,
  type SearchPart,
  type SiteIndex,
} from "../site-format.ts";
import { assignIds, extensionOf } from "./ids.ts";
import { mentionFinder, type Mention } from "./mentions.ts";
import { FolderOutput, MARKER, type SiteOutput, ZipOutput } from "./output.ts";
import { planSite } from "./plan.ts";
import { siteReadme } from "./readme.ts";
import { headingOf, renderNote, resourceMap, type RenderContext } from "./render.ts";
import { captureScriptFonts, captureStyles } from "./styles.ts";
import { shownValue, shownWords, soleLink } from "./words.ts";

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
const NOTES_A_PART = 100;

/** What a zip archive can hold without the 64-bit form of the format. The site has some files of its own beside the notes. */
const MOST_FILES_IN_ZIP = 65_535 - 200;

/**
 * How many notes are drawn at a time. Obsidian takes long to say that a note
 * is drawn, however short the note, and nearly all of that is waiting: of
 * the time a build takes, the processor works for a third. So many are
 * drawn at a time, until the processor is what is waited for.
 *
 * Measured with 1000 notes. On a computer: 16 at a time 11.8 s, 64 at a time
 * 6.0 s, 128 at a time 4.4 s, 256 at a time 4.1 s. On an emulated phone:
 * 13.0 s, 7.1 s and 5.7 s for 16, 64 and 128, with the same memory in use.
 * What is drawn is the same for each. A phone holds fewer at a time, for the
 * notes that are large.
 */
const AT_A_TIME = Platform.isMobile ? 64 : 128;

/** A build writes to one place and uses the page of Obsidian to draw: there is one at a time */
let isBuilding = false;

/**
 * Builds the site: decides what it holds, has Obsidian draw every note, and
 * writes the notes, the list of them, the text to search in, the style sheets
 * of Obsidian, the files the notes use and the script that shows it all.
 *
 * @param reviewed the sign of the choice that was looked over (`signatureOf`). The build is not done when the vault has changed since.
 * @param claim called with the place the site is written to, before anything of the build is there: from then on the place is the plugin's
 */
export async function buildSite(
  app: App,
  settings: Settings,
  version: string,
  reviewed: string,
  claim: (place: string) => Promise<void>,
  progress: Progress,
  stop: { now: boolean },
): Promise<BuildResult> {
  if (isBuilding) {
    throw new Error("Another build is still running or stopping. Try again in a moment.");
  }
  isBuilding = true;
  try {
    return await build(app, settings, version, reviewed, claim, progress, stop);
  } finally {
    isBuilding = false;
  }
}

async function build(
  app: App,
  settings: Settings,
  version: string,
  reviewed: string,
  claim: (place: string) => Promise<void>,
  progress: Progress,
  stop: { now: boolean },
): Promise<BuildResult> {
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

  const place = placeOf(settings, normalizePath);
  const output: SiteOutput =
    settings.format === "zip" ? new ZipOutput(app.vault.adapter, place, settings.written.includes(place)) : new FolderOutput(app.vault.adapter, place);
  await output.prepare();
  if (settings.format === "folder") {
    // Before the first file: what a build has started to write into a folder is the plugin's, also when the build is stopped
    await claim(place);
  }

  const total = choice.notes.length + choice.files.length + 1;
  let done = 0;
  const check = (): void => {
    if (stop.now) {
      throw new BuildStopped();
    }
  };

  const doc = activeDocument;
  const stage = doc.body.createDiv({ cls: "vault-to-site-stage" });
  // What is drawn to fit its place, as a diagram is, is drawn as wide as Obsidian shows a note now
  stage.setCssProps({ "--vault-to-site-stage-width": `${String(noteWidth(app, doc))}px` });
  const viewClass = viewClasses(app);
  const context: RenderContext = { app, noteIds, assets, resourceToPath: resourceMap(app), stage, viewClass, made: new Set(assets.values()) };
  const failed: BuildResult["failed"] = [];
  const unfinished: string[] = [];
  const mentions = mentionFinder(choice.guarded);
  // The words of the notes, for the search, in parts. A part is a run of notes that follow each other, and
  // it is written as soon as its notes are drawn: the words of a large vault are not all held at once, also
  // not while one slow note is waited for. The same vault gives the same parts, whatever order the notes
  // are done in, so that a site kept in a repository changes only where the notes have changed.
  const partCount = Math.ceil(choice.notes.length / NOTES_A_PART);
  const openParts = new Map<number, { texts: ([string, string] | null)[]; left: number }>();
  /** Takes what a note gives to the search, or nothing for a note that was passed over */
  const settle = async (at: number, words: [string, string] | null): Promise<void> => {
    const number = Math.floor(at / NOTES_A_PART);
    let part = openParts.get(number);
    if (part === undefined) {
      const size = Math.min(NOTES_A_PART, choice.notes.length - number * NOTES_A_PART);
      part = { texts: new Array<[string, string] | null>(size).fill(null), left: size };
      openParts.set(number, part);
    }
    part.texts[at - number * NOTES_A_PART] = words;
    if (--part.left === 0) {
      openParts.delete(number);
      const full: SearchPart = part.texts.filter((text) => text !== null);
      await output.text(`data/s/${String(number)}.js`, `__site.search(${String(number)},${JSON.stringify(full)});\n`);
    }
  };
  const entries: ([string, NoteEntry] | undefined)[] = [];

  /** The kinds of property the notes of the site have: each has its sign beside the name of the property */
  const kinds = new Set<string>();
  const propertyOf = (key: string, value: PropertyValue, source: string): PropertyEntry => {
    const kind = kindOfProperty(app, key, value);
    kinds.add(kind);
    // A value that is a link to a note of the site leads there, as it does in Obsidian
    const to = (Array.isArray(value) ? value : [value]).map((item) => {
      const linked = typeof item === "string" ? soleLink(item) : null;
      const { path, subpath } = parseLinktext(linked ?? "");
      const target = linked === null ? null : path === "" ? source : app.metadataCache.getFirstLinkpathDest(path, source)?.path;
      const id = target === null || target === undefined ? undefined : noteIds.get(target);
      return id === undefined ? null : noteAddress(id, headingOf(subpath));
    });
    return to.some((address) => address !== null) ? [key, shownValue(value), kind, to] : [key, shownValue(value), kind];
  };

  const drawNote = async (at: number): Promise<void> => {
    const path = choice.notes[at];
    const file = path === undefined ? null : app.vault.getAbstractFileByPath(path);
    if (path === undefined || !(file instanceof TFile)) {
      await settle(at, null);
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
        .map(([key, value]) => propertyOf(key, value as PropertyValue, path)),
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
    await settle(at, [id, text]);
    const links = Object.keys(app.metadataCache.resolvedLinks[path] ?? {})
      .map((to) => noteIds.get(to))
      .filter((to): to is string => to !== undefined && to !== id);
    entries[at] = [id, { p: path, l: links }];
    done++;
  };

  try {
    await output.text(MARKER, JSON.stringify({ plugin: "vault-to-site", version }, null, 2) + "\n");
    await output.text(".nojekyll", "");
    // For the one who gets the site without having built it
    await output.text("README.txt", siteReadme(app.vault.getName(), doc.documentElement.lang));

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
      // A rule of a snippet can pick an element by the name of a note, as one that hides its tab
      const outside = mentionFinder(
        app.vault
          .getMarkdownFiles()
          .map((file) => file.path)
          .filter((path) => !noteIds.has(path)),
      );
      const styles = await captureStyles(doc, (text) => outside.names(text));
      const fonts = await captureScriptFonts(doc, app.vault.adapter, normalizePath(app.vault.configDir + "/fonts"));
      await output.text("app/obsidian.css", styles.css + fonts.css);
      for (const resource of [...styles.resources, ...fonts.resources]) {
        await output.binary("app/" + resource.name, resource.bytes);
      }
      done++;
    } finally {
      stage.remove();
    }

    const files: Record<string, FileEntry> = {};
    for (const path of choice.files) {
      const asset = assets.get(path);
      if (asset !== undefined) {
        files[idOf(path)] = { p: path, a: asset };
      }
    }
    let nextFile = 0;
    const copier = async (): Promise<void> => {
      while (nextFile < choice.files.length) {
        check();
        const path = choice.files[nextFile++] ?? "";
        const asset = assets.get(path);
        progress(done, total, path);
        if (asset !== undefined) {
          await output.copy(path, asset);
        }
        done++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(output.copiesAtATime, choice.files.length) }, copier));

    const icons: Record<string, string> = {};
    for (const name of ICON_NAMES) {
      const icon = getIcon(name);
      if (icon !== null) {
        icons[name] = icon.outerHTML;
      }
    }
    for (const kind of kinds) {
      const icon = getIcon(iconOfKind(app, kind));
      if (icon !== null) {
        icons[`property-${kind}`] = icon.outerHTML;
      }
    }
    const notes: Record<string, NoteEntry> = Object.fromEntries(entries.filter((entry) => entry !== undefined));
    const index: SiteIndex = {
      name: app.vault.getName(),
      notes,
      files,
      searchParts: partCount,
      theme: doc.body.classList.contains("theme-dark") ? "dark" : "light",
      inlineTitle: doc.body.classList.contains("show-inline-title"),
      viewClass,
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
    if (settings.format === "zip") {
      // Only now: until the archive is about to stand, there is nothing of the plugin at its place, and a
      // file that someone puts there in the meantime is theirs
      await claim(place);
    }
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

/**
 * How wide the part of Obsidian is that shows the notes. With a line of
 * readable length, a note is narrower than this by the setting; without it,
 * a note is as wide as this.
 */
function noteWidth(app: App, doc: Document): number {
  const main = (app.workspace.rootSplit as unknown as { containerEl?: HTMLElement }).containerEl;
  const width = main?.clientWidth ?? 0;
  return Math.max(320, width > 0 ? width : doc.body.clientWidth);
}

/** What Obsidian keeps of the kinds of the properties. Not a part of what it promises to plugins, so each piece is asked for with care. */
interface PropertyKinds {
  getPropertyInfo?: (key: string) => { widget?: unknown } | undefined;
  registeredTypeWidgets?: Record<string, { icon?: unknown } | undefined>;
}

const KIND_ICONS: Record<string, string> = {
  text: "lucide-text",
  multitext: "lucide-list",
  number: "lucide-binary",
  checkbox: "lucide-check-square",
  date: "lucide-calendar",
  datetime: "lucide-clock",
  tags: "lucide-tags",
  aliases: "lucide-forward",
};

/** The kind Obsidian shows a property as: the one set for its name in the vault, else by what the value is */
function kindOfProperty(app: App, key: string, value: PropertyValue): string {
  const widget = (app as unknown as { metadataTypeManager?: PropertyKinds }).metadataTypeManager?.getPropertyInfo?.(key.toLowerCase())?.widget;
  if (typeof widget === "string" && widget !== "") {
    return widget;
  }
  return Array.isArray(value) ? "multitext" : typeof value === "boolean" ? "checkbox" : typeof value === "number" ? "number" : "text";
}

function iconOfKind(app: App, kind: string): string {
  const icon = (app as unknown as { metadataTypeManager?: PropertyKinds }).metadataTypeManager?.registeredTypeWidgets?.[kind]?.icon;
  return typeof icon === "string" && icon !== "" ? icon : (KIND_ICONS[kind] ?? "lucide-text");
}

/**
 * The classes the reading view of Obsidian has by what is set under Editor in
 * its settings. The site gives them to its own view, so that a note is as
 * wide there, and folds there, as it does in Obsidian.
 */
function viewClasses(app: App): string {
  const config = (key: string): unknown => (app.vault as unknown as { getConfig?: (key: string) => unknown }).getConfig?.(key);
  // Each of these is on until it is turned off
  const classes = [
    config("readableLineLength") !== false ? "is-readable-line-width" : "",
    config("foldHeading") !== false ? "allow-fold-headings" : "",
    config("foldIndent") !== false ? "allow-fold-lists" : "",
    config("showIndentGuide") !== false ? "show-indentation-guide" : "",
    config("propertiesInDocument") !== "hidden" ? "show-properties" : "",
    config("rightToLeft") === true ? "rtl" : "",
  ];
  return classes.filter((name) => name !== "").join(" ");
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
