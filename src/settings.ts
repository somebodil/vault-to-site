import { DEFAULT_PROPERTY_RULES } from "./select/properties.ts";
import { NO_TICKS, type Ticks } from "./select/ticks.ts";

/** What the plugin keeps between sessions */
export interface Settings {
  /** The folders and files that are ticked */
  ticks: Ticks;
  /** Regular expressions, separated by commas: a path one of them matches is left out */
  exclude: string;
  /** `key: value` a line: a note with one of these properties is left out */
  properties: string;
  /** The folder the site is written to, from the root of the vault */
  output: string;
}

/** A folder whose name starts with a dot is not shown by Obsidian, so the site does not turn up among the notes */
export const DEFAULT_SETTINGS: Settings = {
  ticks: NO_TICKS,
  exclude: "",
  properties: DEFAULT_PROPERTY_RULES,
  output: ".vault-to-site",
};

/** Reads what was saved, and takes the default for what is missing or of the wrong kind */
export function readSettings(saved: unknown): Settings {
  const data = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>;
  const text = (key: keyof Settings): string => {
    const value = data[key];
    return typeof value === "string" ? value : (DEFAULT_SETTINGS[key] as string);
  };
  const paths = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []);
  const ticks = (typeof data.ticks === "object" && data.ticks !== null ? data.ticks : {}) as Record<string, unknown>;
  return {
    ticks: { on: paths(ticks.on), off: paths(ticks.off) },
    exclude: text("exclude"),
    properties: text("properties"),
    output: text("output").trim() === "" ? DEFAULT_SETTINGS.output : text("output").trim(),
  };
}
