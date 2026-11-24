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
import { FolderOutput, isSiteArchive, MARKER, markerText, type SiteOutput, ZipOutput } from "./output.ts";
import { planSite } from "./plan.ts";
import { siteReadme } from "./readme.ts";
import { headingOf, renderNote, resourceMap, type RenderContext } from "./render.ts";
import { captureScriptFonts, captureStyles } from "./styles.ts";
import { shownValue, shownWords, soleLink } from "./words.ts";
import { severalAtATime } from "./workers.ts";

declare const VIEWER_JS: string;
declare const VIEWER_CSS: string;

/** Called as the build goes on: how much is done, of how much, and what is being worked on */
export type Progress = (done: number, total: number, label: string) => void;

export interface BuildResult {
  notes: number;
  /** The other files: those the notes use, and those at a path of their own */
  files: number;
  /** The archive or the folder, from the root of the vault */
  place: string;
  bytes: number;
  millis: number;
  /** Notes that Obsidian could not draw, or that were gone from the vault when their turn came. The site says so in their place. */
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

/**
 * A build writes to one place and uses the page of Obsidian to draw: there is
 * one at a time. The mark of it is kept on the window and not in this file:
 * Obsidian reads the file again when the plugin is turned off and on, and a
 * build of before that is still stopping would not be known here. It would
 * write into the site of the build after it.
 */
const BUILDING = "vaultToSiteIsBuilding";
const marks = window as unknown as Record<string, unknown>;

/**
 * Builds the site: decides what it holds, has Obsidian draw every note, and
 * writes the notes, the list of them, the text to search in, the style sheets
 * of Obsidian, the files the notes use and the script that shows it all.
 *
 * @param settings read once, when the build starts: what is changed in them while it runs changes nothing of it
 * @param reviewed the sign (`signatureOf`) of the choice the build is to hold: the one that was looked over in the dialog, or the one a program worked out. The build is not done when the vault has changed since.
 * @param width how wide the part of Obsidian that shows the notes is taken to be, in pixels. Left out, it is as wide as it is now.
 * @param needsEveryNote true for a build that nobody looks at: when a note could not be drawn, it gives up before the site takes its place
 */
export async function buildSite(
  app: App,
  settings: Settings,
  version: string,
  reviewed: string,
  progress: Progress,
  stop: { now: boolean },
  width?: number,
  needsEveryNote = false,
): Promise<BuildResult> {
  if (marks[BUILDING] === true) {
    throw new Error("Another build is still running or stopping. Try again in a moment.");
  }
  marks[BUILDING] = true;
  try {
    // A copy: the settings of the plugin are one object that is changed in place, when a file gets another
    // name or the saved settings are read anew. A build goes by what it started with.
    const own: Settings = { ...settings, ticks: { on: [...settings.ticks.on], off: [...settings.ticks.off] } };
    return await build(app, own, version, reviewed, progress, stop, width, needsEveryNote);
  } finally {
    marks[BUILDING] = false;
  }
}

async function build(
  app: App,
  settings: Settings,
  version: string,
  reviewed: string,
  progress: Progress,
  stop: { now: boolean },
  width: number | undefined,
  needsEveryNote: boolean,
): Promise<BuildResult> {
  const start = Date.now();
  const { choice } = planSite(app, settings);
  if (signatureOf(choice) !== reviewed) {
    // Said for both: the one who looked the list over in the dialog, and a program, whose list was worked out a moment ago
    throw new Error("The vault has changed since the list of what goes into the site was made: other notes or files would go in now. Make the list again: look it over again, or run again.");
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
  const extraPaths = choice.extra.map((file) => file.to);
  // An archive at the place may give way when a build of this plugin wrote it, which is known by what the
  // archive holds. Any other file there is somebody's, and is refused.
  const isOwnArchive = settings.format === "zip" && (await isSiteArchive(app.vault.adapter, place));
  const output: SiteOutput = settings.format === "zip" ? new ZipOutput(app.vault.adapter, place, isOwnArchive) : new FolderOutput(app.vault.adapter, place, extraPaths);
  await output.prepare();

  const total = choice.notes.length + choice.files.length + choice.extra.length + 1;
  let done = 0;
  const check = (): void => {
    if (stop.now) {
      throw new BuildStopped("The build was stopped.");
    }
  };

  const doc = activeDocument;
  // Made here, and put on the page only right before the work that takes it away again on every way out
  const stage = createDiv({ cls: "vault-to-site-stage" });
  // What is drawn to fit its place, as a diagram is, is drawn as wide as Obsidian shows a note now
  stage.setCssProps({ "--vault-to-site-stage-width": `${String(width ?? noteWidth(app, doc))}px` });
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
    if (path === undefined) {
      await settle(at, null);
      return;
    }
    // Null for a note that got another name or was deleted since the list was made. It is not passed over
    // in silence: it is a note that could not be drawn, and has the page that says so.
    const found = app.vault.getAbstractFileByPath(path);
    const file = found instanceof TFile ? found : null;
    progress(done, total, path);
    const id = idOf(path);
    const cache = file === null ? null : app.metadataCache.getFileCache(file);
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
      if (file === null) {
        throw new Error("It is no longer in the vault.");
      }
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

  doc.body.appendChild(stage);
  try {
    try {
      // The first file of a site: an archive is known as one of the plugin by how it starts (`isSiteArchive`).
      // The extra files are named in it: the next build takes away those it does not write again.
      await output.text(MARKER, markerText(version, extraPaths));
      await output.text(".nojekyll", "");
      // For the one who gets the site without having built it
      await output.text("README.txt", siteReadme(app.vault.getName(), doc.documentElement.lang));

      await severalAtATime(choice.notes.length, AT_A_TIME, async (at) => {
        check();
        await drawNote(at);
      });
      check();
      if (needsEveryNote && failed.length > 0) {
        // Before the site takes its place: nobody would see the page that says a note could not be drawn
        failed.sort((a, b) => a.path.localeCompare(b.path));
        throw new Error(`${String(failed.length)} notes could not be drawn: ${failed.map((one) => `${one.path} (${one.message})`).join("; ")}. The site was not finished.`);
      }

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
    await severalAtATime(choice.files.length, output.copiesAtATime, async (at) => {
      check();
      const path = choice.files[at] ?? "";
      const asset = assets.get(path);
      progress(done, total, path);
      if (asset !== undefined) {
        await output.copy(path, asset);
      }
      done++;
    });
    for (const file of choice.extra) {
      check();
      progress(done, total, file.from);
      await output.copy(file.from, file.to);
      done++;
    }

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
    // Only now does the site take its place: until then there is
    // nothing of this build at its place, and what someone puts there in the meantime is theirs
    const written = await output.finish();
    progress(total, total, "");

    return {
      notes: choice.notes.length,
      files: choice.files.length + choice.extra.length,
      place: written.place,
      bytes: written.bytes,
      millis: Date.now() - start,
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
