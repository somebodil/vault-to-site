import type { DataAdapter } from "obsidian";
import { extensionOf, hashOf } from "./ids.ts";

/** The style sheets Obsidian has loaded, as one sheet for the site, and the files that sheet points to */
export interface CapturedStyles {
  css: string;
  /** Fonts and pictures of the sheets: the name in the site, next to the sheet, and the content */
  resources: { name: string; bytes: ArrayBuffer }[];
}

/**
 * What stands in the place of an address that is taken out of a style. It gives nothing, and a browser
 * does not ask anything for it or say that it failed.
 */
export const EMPTY_URL = 'url("data:,")';
const URL_IN_CSS = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/g;

/**
 * Reads every style sheet of the page of Obsidian: the app, the theme, the
 * snippets, the plugins, also the sheets that a plugin makes with script,
 * and what the drawing of formulas added. Nothing of
 * this is shipped with the plugin: it is copied from the Obsidian that runs,
 * at the time of the build.
 *
 * A sheet points to fonts and pictures by addresses that only work inside
 * Obsidian. Those are fetched and written next to the sheet.
 */
export async function captureStyles(doc: Document, namesKeptOut: (text: string) => boolean = () => false): Promise<CapturedStyles> {
  const parts: string[] = [];
  /** The sheets that are taken from the web as they are. They have to stand before every rule. */
  const imports: string[] = [];
  const wanted = new Map<string, string>();
  const resources: CapturedStyles["resources"] = [];
  const inlined = new Set<string>();

  /** The rules of a sheet as text, with every address in them made one of the site, or null for a sheet that cannot be read */
  const textOfSheet = (sheet: CSSStyleSheet, depth: number): string | null => {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A sheet from another site cannot be read
      return null;
    }
    const base = sheet.href ?? doc.baseURI;
    let text = "";
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule) {
        // All sheets become one, and a sheet can only take in another at its very start. So a sheet of
        // the web is taken in at the start of the one, and a sheet that Obsidian serves is written out here.
        const inner = depth < 8 ? textOfSheet(rule.styleSheet as CSSStyleSheet, depth + 1) : null;
        if (localAddress(rule.href, base, doc) === null) {
          const address = absoluteWebAddress(rule.href, base);
          if (address !== null) {
            imports.push(`@import url("${address}")${rule.media.mediaText === "" ? "" : " " + rule.media.mediaText};`);
          }
        } else if (inner !== null) {
          text += (rule.media.mediaText === "" ? inner : `@media ${rule.media.mediaText} {\n${inner}}`) + "\n";
        }
        continue;
      }
      text += (rule instanceof CSSFontFaceRule ? withWholeWeightRange(textOf(rule, namesKeptOut)) : textOf(rule, namesKeptOut)) + "\n";
    }
    return text.replace(URL_IN_CSS, (whole, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      const address = (double ?? single ?? bare ?? "").trim();
      if (address.startsWith("data:")) {
        const file = fileOfData(address);
        if (file === null) {
          return whole;
        }
        if (!inlined.has(file.name)) {
          inlined.add(file.name);
          resources.push(file);
        }
        return `url("${file.name}")`;
      }
      // An address this function has written already, in a sheet that was taken into this one
      if (address.startsWith("res/") && (inlined.has(address) || [...wanted.values()].includes(address))) {
        return whole;
      }
      const local = localAddress(address, base, doc);
      if (local === null) {
        // An address of the web stays. One that leads into Obsidian or to a file of the device would
        // be dead in the site, and it holds the path of the vault on the device.
        return address === "" || /^\s*(https?:|data:|about:|#)/i.test(address) ? whole : EMPTY_URL;
      }
      let name = wanted.get(local);
      if (name === undefined) {
        const extension = extensionOf(new URL(local).pathname);
        name = "res/" + hashOf(local) + (extension === "" ? "" : "." + extension);
        wanted.set(local, name);
      }
      return `url("${name}")`;
    });
  };

  // The sheets of the page, and after them the sheets that plugins make with script: those are not among
  // the sheets of the page, and they come later when the browser decides which rule holds
  for (const sheet of allSheets(doc)) {
    const text = textOfSheet(sheet, 0);
    if (text !== null) {
      parts.push(text);
    }
  }

  for (const [address, name] of wanted) {
    try {
      // The address is a file that Obsidian serves to its own page, such as a font of the app.
      // `requestUrl` is for the web and cannot reach it.
      const response = await doc.defaultView?.fetch(address);
      if (response === undefined) {
        continue;
      }
      if (response.ok) {
        resources.push({ name, bytes: await response.arrayBuffer() });
      }
    } catch {
      // Without the file the site falls back to another font
    }
  }
  return { css: [...new Set(imports), ...parts].join("\n"), resources };
}

/** The whole address of a sheet of the web, or null for what is not of the web */
function absoluteWebAddress(address: string, base: string): string | null {
  try {
    const url = new URL(address, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href.replace(/["\\\n]/g, encodeURIComponent) : null;
  } catch {
    return null;
  }
}

function allSheets(doc: Document): CSSStyleSheet[] {
  return [...Array.from(doc.styleSheets), ...doc.adoptedStyleSheets];
}

/**
 * The range of weights a font file can be drawn in, when it is a font with a
 * weight that varies. Null for a font of one weight, and for what cannot be read.
 *
 * Read from the table `fvar` of the file: the axis `wght`, with its least and its greatest value.
 */
export function weightRangeOf(bytes: ArrayBuffer): [least: number, greatest: number] | null {
  const view = new DataView(bytes);
  try {
    const tables = view.getUint16(4);
    for (let i = 0; i < tables; i++) {
      const record = 12 + i * 16;
      if (view.getUint32(record) !== 0x66766172) {
        continue; // not "fvar"
      }
      const table = view.getUint32(record + 8);
      const axes = table + view.getUint16(table + 4);
      const count = view.getUint16(table + 8);
      const size = view.getUint16(table + 10);
      for (let axis = 0; axis < count; axis++) {
        const at = axes + axis * size;
        if (view.getUint32(at) === 0x77676874) {
          // "wght": numbers with 16 bits after the point
          const least = view.getInt32(at + 4) / 65536;
          const greatest = view.getInt32(at + 12) / 65536;
          return greatest > least ? [Math.round(least), Math.round(greatest)] : null;
        }
      }
    }
  } catch {
    // Not a font this reads
  }
  return null;
}

/**
 * A rule for a font whose file can be drawn in a range of weights, but which
 * names one weight only, gets the whole range.
 *
 * With one weight named, a browser has to make bold itself, and not every
 * browser does that for such a font: the site would show bold text on one
 * device and none on another. With the range, bold is drawn by the font.
 */
function withWholeWeightRange(rule: string): string {
  const data = /url\(\s*["']?(data:(?:font|application)\/[^"')]+)["']?\s*\)/i.exec(rule);
  const file = data?.[1] === undefined ? null : fileOfData(data[1]);
  const range = file === null ? null : weightRangeOf(file.bytes);
  if (range === null) {
    return rule;
  }
  const weight = `font-weight: ${String(range[0])} ${String(range[1])};`;
  // The descriptor is before the font itself in the text of the rule or after it; a rule without one gets it at its end
  const named = /font-weight:\s*[^;}]*;?/i;
  const head = rule.slice(0, data?.index ?? 0);
  const tail = rule.slice((data?.index ?? 0) + (data?.[0].length ?? 0));
  if (named.test(head)) {
    return head.replace(named, weight) + (data?.[0] ?? "") + tail;
  }
  if (named.test(tail)) {
    return head + (data?.[0] ?? "") + tail.replace(named, weight);
  }
  return rule.replace(/\}\s*$/, ` ${weight} }`);
}

/** From this length on, a file that is written into a sheet is taken out of it */
const LONG_DATA = 20_000;
const DATA_KINDS: Record<string, string> = {
  "font/ttf": "ttf",
  "font/truetype": "ttf",
  "application/x-font-ttf": "ttf",
  "font/otf": "otf",
  "font/opentype": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "application/font-woff": "woff",
  "application/font-woff2": "woff2",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * A large file that a sheet holds as text, as a plugin does with a font of
 * several megabytes, becomes a file of the site. As text it is a third
 * larger, and the browser would read all of it again on every start.
 * Null for a small one, or one of a kind that is not known: it stays where it is.
 */
export function fileOfData(address: string): { name: string; bytes: ArrayBuffer } | null {
  if (address.length < LONG_DATA) {
    return null;
  }
  if (lastData?.address === address) {
    return lastData.file;
  }
  const file = decodeData(address);
  lastData = file === null ? null : { address, file };
  return file;
}

/** The file that was made last: the rule of a font is looked at twice, and a font of megabytes is decoded once */
let lastData: { address: string; file: { name: string; bytes: ArrayBuffer } } | null = null;

function decodeData(address: string): { name: string; bytes: ArrayBuffer } | null {
  const comma = address.indexOf(",");
  const head = comma === -1 ? "" : address.slice(5, comma).toLowerCase();
  const kind = DATA_KINDS[head.split(";")[0] ?? ""];
  if (kind === undefined || !head.endsWith(";base64")) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(address.slice(comma + 1));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Named by its length and by a part of its start and its end: the same file in two rules is written once
  return { name: `res/${hashOf(String(address.length) + address.slice(comma + 1, comma + 400) + address.slice(-400))}.${kind}`, bytes: bytes.buffer };
}

/** A selector that picks an element by a path of the vault, as plugins write them to hide or to mark a folder */
const NAMES_A_PATH = /\[\s*data-(path|href|file|tooltip)/i;
/** The same by an attribute that every element can have, when what it is compared with reads like a path: letters, then a slash, or `.md` */
const COMPARES_A_PATH = /\[\s*(?:src|alt|title|aria-label|href)\s*[~|^$*]?=\s*["']?(?![a-z][a-z0-9+.-]*:|#|\/\/)(?:[^"'\]]*[\p{L}\p{N}][^"'\]]*\/|[^"'\]]*\.md\b)/iu;

/** What a selector compares an attribute with, when it is written in quotes: `[aria-label="Diary 2026"]` gives `Diary 2026` */
export function quotedInSelector(selector: string): string[] {
  const quoted: string[] = [];
  for (const match of selector.matchAll(/\[[^\]=]*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) {
    quoted.push(match[1] ?? match[2] ?? "");
  }
  return quoted;
}

/**
 * True for a rule that would carry a path or a name of the vault into the
 * site: one that picks an element by a path, and one that compares an
 * attribute with the name of a note that is not in the site, as a snippet
 * does that hides the tab of a note.
 */
function namesPath(rule: CSSRule, namesKeptOut: (text: string) => boolean): boolean {
  const selector = (rule as { selectorText?: unknown }).selectorText;
  if (typeof selector === "string") {
    if (NAMES_A_PATH.test(selector) || COMPARES_A_PATH.test(selector)) {
      return true;
    }
    if (selector.includes("[") && quotedInSelector(selector).some(namesKeptOut)) {
      return true;
    }
  }
  const inner = (rule as { cssRules?: CSSRuleList }).cssRules;
  return inner !== undefined && Array.from(inner).some((one) => namesPath(one, namesKeptOut));
}

/**
 * The text of a rule, without the rules that name a path of the vault: such
 * a rule would carry the name of a folder or a note into the site, also of
 * one that is kept out. A rule that holds other rules, as one for a width of
 * the window, is written again without those.
 */
function textOf(rule: CSSRule, namesKeptOut: (text: string) => boolean): string {
  if (!namesPath(rule, namesKeptOut)) {
    return rule.cssText;
  }
  const inner = (rule as { cssRules?: CSSRuleList }).cssRules;
  const open = rule.cssText.indexOf("{");
  if (inner === undefined || inner.length === 0 || open === -1 || typeof (rule as { selectorText?: unknown }).selectorText === "string") {
    return "";
  }
  return (
    rule.cssText.slice(0, open + 1) +
    Array.from(inner)
      .map((one) => textOf(one, namesKeptOut))
      .join(" ") +
    "}"
  );
}

/** The full address of a file that Obsidian serves itself, or null for what is inline or on the web */
function localAddress(address: string, base: string, doc: Document): string | null {
  if (address === "" || address.startsWith("data:") || address.startsWith("#")) {
    return null;
  }
  if (address.startsWith("blob:")) {
    // Made by the page itself, as by a plugin that loads a font: the page can read it
    return address;
  }
  try {
    const url = new URL(address, base);
    return url.origin === new URL(doc.baseURI).origin ? url.href : null;
  } catch {
    return null;
  }
}

/** A font as a name is compared: letters and digits only, in lower case, so that `Pretendard Variable` is `pretendardvariable.ttf` */
export function fontKey(name: string): string {
  return name
    .replace(/^["']|["']$/g, "")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const FONT_FORMATS: Record<string, string> = { ttf: "truetype", otf: "opentype", woff: "woff", woff2: "woff2" };

/**
 * The fonts that a plugin has loaded with script instead of a style sheet.
 *
 * Such a font is in no sheet, so copying the sheets leaves it behind, and
 * the site would name a font that it does not have. The page does not give
 * out the content of a font either. What can be done: a font whose file
 * lies in the fonts folder of the settings folder, under the name of the
 * font, is taken from there. That is where plugins that load fonts keep them.
 *
 * @param fontFolder the folder to look in, from the root of the vault
 * @returns rules to add to the sheet of the site, and the files they point to
 */
export async function captureScriptFonts(doc: Document, adapter: DataAdapter, fontFolder: string): Promise<CapturedStyles> {
  // The fonts that a sheet declares are copied with the sheet
  const declared = new Set<string>();
  for (const sheet of allSheets(doc)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSFontFaceRule) {
          declared.add(fontKey(rule.style.getPropertyValue("font-family")));
        }
      }
    } catch {
      // A sheet from another site cannot be read
    }
  }
  const wanted: FontFace[] = [];
  doc.fonts.forEach((face) => {
    if (face.status === "loaded" && !declared.has(fontKey(face.family))) {
      wanted.push(face);
    }
  });
  if (wanted.length === 0 || !(await adapter.exists(fontFolder))) {
    return { css: "", resources: [] };
  }

  const files = (await adapter.list(fontFolder)).files.filter((path) => FONT_FORMATS[extensionOf(path)] !== undefined);
  const byKey = new Map(files.map((path) => [fontKey(path.slice(path.lastIndexOf("/") + 1)), path]));
  const resources: CapturedStyles["resources"] = [];
  const written = new Map<string, string>();
  let css = "";
  for (const face of wanted) {
    const path = byKey.get(fontKey(face.family));
    if (path === undefined) {
      continue;
    }
    let name = written.get(path);
    if (name === undefined) {
      name = "res/" + hashOf(path) + "." + extensionOf(path);
      written.set(path, name);
      resources.push({ name, bytes: await adapter.readBinary(path) });
    }
    const family = face.family.replace(/^["']|["']$/g, "").replace(/["\\]/g, "");
    const range = weightRangeOf(resources.find((resource) => resource.name === name)?.bytes ?? new ArrayBuffer(0));
    css +=
      `@font-face { font-family: "${family}"; src: url("${name}") format("${FONT_FORMATS[extensionOf(path)] ?? "truetype"}"); ` +
      `font-weight: ${range === null ? face.weight : `${String(range[0])} ${String(range[1])}`}; font-style: ${face.style}; font-stretch: ${face.stretch}; unicode-range: ${face.unicodeRange}; font-display: swap; }\n`;
  }
  return { css, resources };
}

