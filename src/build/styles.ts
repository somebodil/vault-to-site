import type { DataAdapter } from "obsidian";
import { extensionOf, hashOf } from "./ids.ts";

/** The style sheets Obsidian has loaded, as one sheet for the site, and the files that sheet points to */
export interface CapturedStyles {
  css: string;
  /** Fonts and pictures of the sheets: the name in the site, next to the sheet, and the content */
  resources: { name: string; bytes: ArrayBuffer }[];
}

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
export async function captureStyles(doc: Document): Promise<CapturedStyles> {
  const parts: string[] = [];
  const wanted = new Map<string, string>();
  const resources: CapturedStyles["resources"] = [];
  const inlined = new Set<string>();

  // The sheets of the page, and after them the sheets that plugins make with script: those are not among
  // the sheets of the page, and they come later when the browser decides which rule holds
  for (const sheet of allSheets(doc)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A sheet from another site cannot be read. It is left out.
      continue;
    }
    const base = sheet.href ?? doc.baseURI;
    let text = "";
    for (const rule of Array.from(rules)) {
      text += textOf(rule) + "\n";
    }
    parts.push(
      text.replace(URL_IN_CSS, (whole, double: string | undefined, single: string | undefined, bare: string | undefined) => {
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
        const local = localAddress(address, base, doc);
        if (local === null) {
          return whole;
        }
        let name = wanted.get(local);
        if (name === undefined) {
          const extension = extensionOf(new URL(local).pathname);
          name = "res/" + hashOf(local) + (extension === "" ? "" : "." + extension);
          wanted.set(local, name);
        }
        return `url("${name}")`;
      }),
    );
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
  return { css: parts.join("\n"), resources };
}

function allSheets(doc: Document): CSSStyleSheet[] {
  return [...Array.from(doc.styleSheets), ...doc.adoptedStyleSheets];
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

function namesPath(rule: CSSRule): boolean {
  const selector = (rule as { selectorText?: unknown }).selectorText;
  if (typeof selector === "string" && NAMES_A_PATH.test(selector)) {
    return true;
  }
  const inner = (rule as { cssRules?: CSSRuleList }).cssRules;
  return inner !== undefined && Array.from(inner).some(namesPath);
}

/**
 * The text of a rule, without the rules that name a path of the vault: such
 * a rule would carry the name of a folder or a note into the site, also of
 * one that is kept out. A rule that holds other rules, as one for a width of
 * the window, is written again without those.
 */
function textOf(rule: CSSRule): string {
  if (!namesPath(rule)) {
    return rule.cssText;
  }
  const inner = (rule as { cssRules?: CSSRuleList }).cssRules;
  const open = rule.cssText.indexOf("{");
  if (inner === undefined || inner.length === 0 || open === -1 || typeof (rule as { selectorText?: unknown }).selectorText === "string") {
    return "";
  }
  return rule.cssText.slice(0, open + 1) + Array.from(inner).map(textOf).join(" ") + "}";
}

/** The full address of a file that Obsidian serves itself, or null for what is inline or on the web */
function localAddress(address: string, base: string, doc: Document): string | null {
  if (address === "" || address.startsWith("data:") || address.startsWith("blob:") || address.startsWith("#")) {
    return null;
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
    css +=
      `@font-face { font-family: "${family}"; src: url("${name}") format("${FONT_FORMATS[extensionOf(path)] ?? "truetype"}"); ` +
      `font-weight: ${face.weight}; font-style: ${face.style}; font-stretch: ${face.stretch}; unicode-range: ${face.unicodeRange}; font-display: swap; }\n`;
  }
  return { css, resources };
}

