import { DEFAULT_PROPERTY_RULES } from "./select/properties.ts";
import { NO_TICKS, type Ticks } from "./select/ticks.ts";

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
  format: Format;
  /** The archive a site is written to, from the root of the vault */
  zip: string;
  /** The folder a site is written to, from the root of the vault */
  folder: string;
}

export const DEFAULT_SETTINGS: Settings = {
  ticks: NO_TICKS,
  exclude: "",
  properties: DEFAULT_PROPERTY_RULES,
  format: "zip",
  // One file in plain sight: it can be shared from a phone, and Obsidian does not list a file it cannot open
  zip: "vault-to-site.zip",
  // Obsidian does not show a folder whose name starts with a dot, so the pictures of the site do not turn up among those of the vault
  folder: ".vault-to-site",
};

/** Where a build with these settings writes, as it is written in the setting */
export function outputOf(settings: Settings): string {
  return settings.format === "zip" ? settings.zip : settings.folder;
}

/** Reads what was saved, and takes the default for what is missing or of the wrong kind */
export function readSettings(saved: unknown): Settings {
  const data = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>;
  const text = (key: "exclude" | "properties"): string => {
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
    format: data.format === "folder" ? "folder" : "zip",
    zip: path("zip"),
    folder: path("folder"),
  };
}
