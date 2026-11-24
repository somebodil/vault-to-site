import { OLD, PART, zipPath } from "./build/output.ts";
import { SIGNATURE } from "./select/choose.ts";
import { renameExtra } from "./select/extra.ts";
import { DEFAULT_PROPERTY_RULES } from "./select/properties.ts";
import { isAtOrUnder, movedPath, NO_TICKS, renameTicks, type Ticks } from "./select/ticks.ts";

/** A site is written as one zip archive, or as a folder */
export type Format = "zip" | "folder";

/** What the plugin keeps between sessions */
export interface Settings {
  /** The folders and files that are ticked */
  ticks: Ticks;
  /** Regular expressions, separated by commas: a path one of them matches is left out */
  exclude: string;
  /**
   * Regular expressions, separated by commas: when there is one, only a
   * note whose path one of them matches goes in. Empty for every ticked note.
   */
  include: string;
  /** `key: value` a line: a note with one of these properties is left out. A value between slashes is a regular expression. */
  properties: string;
  /**
   * `key: value` a line: when there is one, only a note with one of these
   * properties goes in, as `publish: true`. Empty for every ticked note.
   */
  only: string;
  /**
   * `path in the site: path in the vault` a line: a file that is put into
   * the site at a path of its own, as `Resume.pdf: Papers/Resume.pdf`. It
   * goes in whatever the ticks and the rules say.
   */
  extra: string;
  format: Format;
  /** The archive a site is written to, from the root of the vault */
  zip: string;
  /** The folder a site is written to, from the root of the vault */
  folder: string;
  /**
   * Every archive and folder a build has written. They are never content of
   * a site: an archive of an earlier build holds what was in the site then,
   * also notes that are private now.
   */
  written: string[];
  /**
   * The sign of the choice that was looked over and built last (`signatureOf`),
   * or empty when there is none. A build without the dialog is done only when
   * the site would be that one.
   */
  reviewed: string;
}

export const DEFAULT_SETTINGS: Settings = {
  ticks: NO_TICKS,
  exclude: "",
  include: "",
  properties: DEFAULT_PROPERTY_RULES,
  only: "",
  extra: "",
  format: "zip",
  // One file in plain sight: it can be shared from a phone, and Obsidian does not list a file it cannot open
  zip: "vault-to-site.zip",
  // Obsidian does not show a folder whose name starts with a dot, so the pictures of the site do not turn up among those of the vault
  folder: ".vault-to-site",
  written: [],
  reviewed: "",
};

/**
 * Where a build with these settings writes, from the root of the vault: the
 * archive with `.zip` at its end, or the folder.
 *
 * @param normal makes a path as it is written in a setting into the form the vault has
 */
export function placeOf(settings: Settings, normal: (path: string) => string = (path) => path): string {
  return settings.format === "zip" ? zipPath(normal(settings.zip)) : normal(settings.folder);
}

/**
 * The settings after a folder or file of the vault got another name.
 *
 * - A tick stays with what it was set on.
 * - What a build wrote stays the plugin's under its new name.
 * - The place of the next build moves only with a folder above it. An
 *   archive or a site folder that was itself renamed or moved was put aside:
 *   the next build writes a new one where the setting says, and does not
 *   write over the one that was put aside.
 *
 * The names a build gives its own archive on the way are not a rename by the
 * user, and change nothing.
 *
 * A rename that changes nothing gives back the settings it was given, the
 * same object: Obsidian tells of every file in a folder that is moved, and
 * so it is seen at no cost that there is nothing to save.
 *
 * @param isOntoGone see `renameTicks`
 * @param normal makes a path as it is written in a setting into the form the vault has
 */
export function followRename(settings: Settings, from: string, to: string, isOntoGone = false, normal: (path: string) => string = (path) => path): Settings {
  if ([from, to].some((path) => path.endsWith(PART) || path.endsWith(OLD))) {
    return settings;
  }
  const moved = (path: string): string => movedPath(path, from, to);
  const under = (path: string): string => (path === from ? path : moved(path));
  const zip = zipPath(normal(settings.zip));
  const folder = normal(settings.folder);
  const next: Settings = {
    ...settings,
    ticks: renameTicks(settings.ticks, from, to, isOntoGone),
    extra: renameExtra(settings.extra, moved, normal),
    written: [...new Set(settings.written.map(moved))],
    zip: under(zip) === zip ? settings.zip : under(zip),
    folder: under(folder) === folder ? settings.folder : under(folder),
  };
  const isSame =
    samePaths(next.ticks.on, settings.ticks.on) &&
    samePaths(next.ticks.off, settings.ticks.off) &&
    next.extra === settings.extra &&
    samePaths(next.written, settings.written) &&
    next.zip === settings.zip &&
    next.folder === settings.folder;
  return isSame ? settings : next;
}

function samePaths(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((path, at) => path === other[at]);
}

/**
 * The settings after a folder or file of the vault was deleted: what a build
 * wrote there is the plugin's no longer. Without this, a folder of notes
 * that is made later under the name of a site that is gone would be taken
 * for that site, and none of its notes would be offered for a site.
 *
 * Gives back the same object when nothing a build wrote was there.
 */
export function followDelete(settings: Settings, deleted: string): Settings {
  const written = deleted === "" ? settings.written : settings.written.filter((path) => !isAtOrUnder(path, deleted));
  return written.length === settings.written.length ? settings : { ...settings, written };
}

const GIVEN_TEXTS: readonly string[] = ["exclude", "include", "properties", "only", "extra"];
const GIVEN_PATHS: readonly string[] = ["zip", "folder"];

/**
 * What is wrong with the settings a run by a program was given, said for the
 * one who wrote them: nothing when every one of them is a setting, and of
 * the kind that is read.
 *
 * `readSettings` takes the default for what it cannot read, which is right
 * for what the plugin saved itself. Here it would be a rule that is passed
 * over in silence: with `"exlude"` for `"exclude"`, or a list where text is
 * read, the site would be built without the rule, and nobody looks it over.
 */
export function givenProblems(given: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(given)) {
    if (key === "ticks") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        problems.push('"ticks" has to be an object with the lists "on" and "off", as {"on": [""]}.');
        continue;
      }
      for (const [list, paths] of Object.entries(value)) {
        if (list !== "on" && list !== "off") {
          problems.push(`"ticks.${list}" is not a setting: "ticks" has the lists "on" and "off".`);
        } else if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) {
          problems.push(`"ticks.${list}" has to be a list of paths, each as text: [""] is the whole vault.`);
        }
      }
    } else if (GIVEN_TEXTS.includes(key)) {
      if (typeof value !== "string") {
        problems.push(`"${key}" has to be text, as it is typed in the dialog.`);
      }
    } else if (GIVEN_PATHS.includes(key)) {
      if (typeof value !== "string" || value.trim() === "") {
        problems.push(`"${key}" has to be a path, as text.`);
      }
    } else if (key === "format") {
      if (value !== "zip" && value !== "folder") {
        problems.push('"format" has to be "zip" or "folder".');
      }
    } else {
      problems.push(`"${key}" is not a setting: a run takes ticks, exclude, include, properties, only, extra, format, zip and folder.`);
    }
  }
  return problems;
}

/** Reads what was saved, and takes the default for what is missing or of the wrong kind */
export function readSettings(saved: unknown): Settings {
  const data = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>;
  const text = (key: "exclude" | "include" | "properties" | "only" | "extra"): string => {
    const value = data[key];
    return typeof value === "string" ? value : DEFAULT_SETTINGS[key];
  };
  const path = (key: "zip" | "folder"): string => {
    const value = data[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : DEFAULT_SETTINGS[key];
  };
  const paths = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []);
  const ticks = (typeof data.ticks === "object" && data.ticks !== null ? data.ticks : {}) as Record<string, unknown>;
  return {
    ticks: { on: paths(ticks.on), off: paths(ticks.off) },
    exclude: text("exclude"),
    include: text("include"),
    properties: text("properties"),
    only: text("only"),
    extra: text("extra"),
    format: data.format === "folder" ? "folder" : "zip",
    zip: path("zip"),
    folder: path("folder"),
    written: paths(data.written),
    // What was kept here before was as long as the list of all notes. It is no sign as they are now: nothing counts as looked over.
    reviewed: typeof data.reviewed === "string" && SIGNATURE.test(data.reviewed) ? data.reviewed : "",
  };
}
