import { OLD, PART, zipPath } from "./build/output.ts";
import { DEFAULT_PROPERTY_RULES } from "./select/properties.ts";
import { movedPath, NO_TICKS, renameTicks, type Ticks } from "./select/ticks.ts";

/** A site is written as one zip archive, or as a folder */
export type Format = "zip" | "folder";

/** What the plugin keeps between sessions */
export interface Settings {
  /** The folders and files that are ticked */
  ticks: Ticks;
  /** Regular expressions, separated by commas: a path one of them matches is left out */
  exclude: string;
  /** `key: value` a line: a note with one of these properties is left out */
  properties: string;
  /**
   * `key: value` a line: when there is one, only a note with one of these
   * properties goes in, as `publish: true`. Empty for every ticked note.
   */
  only: string;
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
   * The sign of the choice that was looked over and built last (`signatureOf`).
   * A build without the dialog is done only when the site would be that one.
   */
  reviewed: string;
}

export const DEFAULT_SETTINGS: Settings = {
  ticks: NO_TICKS,
  exclude: "",
  properties: DEFAULT_PROPERTY_RULES,
  only: "",
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
  return {
    ...settings,
    ticks: renameTicks(settings.ticks, from, to, isOntoGone),
    written: [...new Set(settings.written.map(moved))],
    zip: under(zip) === zip ? settings.zip : under(zip),
    folder: under(folder) === folder ? settings.folder : under(folder),
  };
}

/** Reads what was saved, and takes the default for what is missing or of the wrong kind */
export function readSettings(saved: unknown): Settings {
  const data = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>;
  const text = (key: "exclude" | "properties" | "only" | "reviewed"): string => {
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
    properties: text("properties"),
    only: text("only"),
    format: data.format === "folder" ? "folder" : "zip",
    zip: path("zip"),
    folder: path("folder"),
    written: paths(data.written),
    reviewed: text("reviewed"),
  };
}
