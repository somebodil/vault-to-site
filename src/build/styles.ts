import type { DataAdapter } from "obsidian";
import { rewriteCss, topRuleCount, type CssChoice } from "./css.ts";
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
/** An address in a style, in any of the three ways it is written. `url` may be in capital letters. */
export const URL_IN_CSS = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi;

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
  const made = new Set<string>();
  const resources: CapturedStyles["resources"] = [];
  const inlined = new Set<string>();
  const decoded = new Map<string, { name: string; bytes: ArrayBuffer } | null>();

  /** A text of rules with every address in it made one of the site */
  const withSiteAddresses = (text: string, base: string): string =>
    text.replace(URL_IN_CSS, (whole, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      const address = (double ?? single ?? bare ?? "").trim();
      if (address.startsWith("data:")) {
        // The same font can stand in several rules: it is decoded once, and kept only for this build
        let file = decoded.get(address);
        if (file === undefined) {
          file = fileOfData(address);
          decoded.set(address, file);
        }
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
      if (inlined.has(address) || made.has(address)) {
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
        made.add(name);
      }
      return `url("${name}")`;
    });

  const read = async (address: string): Promise<string | null> => {
    try {
      // A file that Obsidian serves to its own page. `requestUrl` is for the web and cannot reach it.
      const response = await doc.defaultView?.fetch(address);
      return response?.ok === true ? await response.text() : null;
    } catch {
      return null;
    }
  };

  /** Another sheet that a sheet takes in: one of the web is taken in at the start of the one sheet of the site, as only there a sheet can take in another */
  const takeIn = (address: string, rest: string, base: string): void => {
    const whole = absoluteWebAddress(address, base);
    if (whole !== null) {
      imports.push(`@import url("${whole}")${rest === "" ? "" : " " + rest};`);
    }
  };

  const choice: CssChoice = {
    drops: (selector, block) => namesPathIn(selector, namesKeptOut) || (block.includes("{") && namesPathIn(block, namesKeptOut)),
  };

  /** A sheet from the text it was written in */
  const fromText = async (text: string, base: string, depth: number): Promise<string> => {
    let css = "";
    for (const piece of rewriteCss(text, choice)) {
      if (typeof piece === "string") {
        css += withSiteAddresses(piece, base);
        continue;
      }
      const local = localAddress(piece.address, base, doc);
      if (local === null) {
        takeIn(piece.address, piece.rest, base);
        continue;
      }
      // A sheet that Obsidian serves is written out where it was taken in
      const inner = depth < 8 ? await read(local) : null;
      if (inner !== null) {
        const innerCss = await fromText(inner, local, depth + 1);
        css += piece.rest === "" || /^(layer|supports)\b/i.test(piece.rest) ? innerCss : `@media ${piece.rest}{\n${innerCss}}\n`;
      }
    }
    return css;
  };

  /**
   * A sheet from what the browser holds of it, for a sheet whose text is not
   * there: one that a plugin has made with script. Null for a sheet that
   * cannot be read.
   */
  const fromRules = (sheet: CSSStyleSheet, depth: number): string | null => {
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
        const inner = depth < 8 ? fromRules(rule.styleSheet as CSSStyleSheet, depth + 1) : null;
        if (localAddress(rule.href, base, doc) === null) {
          takeIn(rule.href, rule.media.mediaText, base);
        } else if (inner !== null) {
          text += (rule.media.mediaText === "" ? inner : `@media ${rule.media.mediaText} {\n${inner}}`) + "\n";
        }
        continue;
      }
      text += textOf(rule, namesKeptOut) + "\n";
    }
    return withSiteAddresses(text, base);
  };

  // The sheets of the page, and after them the sheets that plugins make with script: those are not among
  // the sheets of the page, and they come later when the browser decides which rule holds
  for (const sheet of allSheets(doc)) {
    if (sheet.disabled) {
      continue;
    }
    const written = await writtenText(sheet, doc, read);
    const css = written === null ? fromRules(sheet, 0) : await fromText(written.text, written.base, 0);
    if (css === null) {
      continue;
    }
    const media = sheet.media.mediaText;
    parts.push(media === "" || media === "all" ? css : `@media ${media}{\n${css}}\n`);
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

/**
 * The text a sheet was written in, and the address its own addresses are
 * read from. Null when the text is not there or is not what the browser
 * holds: a sheet made with script has none, and script can add rules to a
 * sheet after it was read. Then the sheet has more rules than its text.
 */
async function writtenText(sheet: CSSStyleSheet, doc: Document, read: (address: string) => Promise<string | null>): Promise<{ text: string; base: string } | null> {
  let held: number;
  try {
    held = sheet.cssRules.length;
  } catch {
    return null;
  }
  const owner = sheet.ownerNode;
  const kind = owner?.nodeName.toUpperCase() ?? "";
  const text = kind === "STYLE" ? (owner?.textContent ?? "") : kind === "LINK" && sheet.href !== null ? await read(sheet.href) : null;
  if (text === null || text.trim() === "" || topRuleCount(text) < held) {
    return null;
  }
  return { text, base: sheet.href ?? doc.baseURI };
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
/** The same by an attribute that every element can have, when what it is compared with reads like a path: letters, then a slash, or `.md` */
const COMPARES_A_PATH = /\[\s*(?:src|alt|title|aria-label|href)\s*[~|^$*]?=\s*["']?(?![a-z][a-z0-9+.-]*:|#|\/\/)(?:[^"'\]]*[\p{L}\p{N}][^"'\]]*\/|[^"'\]]*\.md\b)/iu;

/**
 * Attributes whose value is one of a few fixed words and never the name of a
 * note: the kind of a callout, of a view, of an input. A rule for the callout
 * `todo` is not left out because a note outside the site is called `Todo`.
 */
const HOLDS_A_KEYWORD = new Set([
  "data-callout",
  "data-callout-fold",
  "data-callout-metadata",
  "data-task",
  "data-type",
  "data-mode",
  "data-language",
  "type",
  "role",
  "lang",
  "dir",
  "rel",
  "target",
  // The others that the sheet of Obsidian itself compares, mostly without quotes: `[contenteditable=true]`,
  // `[class*=language-]`, `[data-view-type=table]`. Its rules are not left out for a note called `True` or `Table`.
  "align",
  "aria-disabled",
  "class",
  "contenteditable",
  "data-ext",
  "data-group",
  "data-highlight",
  "data-indeterminate",
  "data-main-rotation",
  "data-property-count",
  "data-property-type",
  "data-resize",
  "data-rhs-type",
  "data-section",
  "data-side",
  "data-view",
  "data-view-type",
  "disabled",
  "draggable",
  "side",
]);

/**
 * What a selector compares an attribute with, in quotes or without:
 * `[aria-label="Diary 2026"]` gives `Diary 2026`, and `[title=Diary]` gives
 * `Diary`. Nothing for an attribute that holds a keyword.
 */
export function comparedInSelector(selector: string): string[] {
  const compared: string[] = [];
  for (const match of selector.matchAll(/\[\s*([^\]=]*?)\s*[~|^$*]?=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|((?:[^\]\s"'\\]|\\.)+))/g)) {
    // A name can have the name of a set before it, as `svg|type`
    const attribute = (match[1] ?? "").split("|").pop() ?? "";
    if (!HOLDS_A_KEYWORD.has(attribute.toLowerCase())) {
      compared.push(match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return compared;
}

/**
 * True for a rule that would carry a path or a name of the vault into the
 * site: one that picks an element by a path, and one that compares an
 * attribute with the name of a note that is not in the site, as a snippet
 * does that hides the tab of a note.
 */
export function namesPathIn(selector: string, namesKeptOut: (text: string) => boolean): boolean {
  return NAMES_A_PATH.test(selector) || COMPARES_A_PATH.test(selector) || (selector.includes("[") && comparedInSelector(selector).some(namesKeptOut));
}

/**
 * What stands before the block of a rule as the browser holds it: a selector,
 * or what a rule that holds rules is for, which can pick an element as well
 * (`@scope ([aria-label="Diary"])`)
 */
function preludeOf(rule: CSSRule): string {
  const held = rule as { selectorText?: unknown; conditionText?: unknown; start?: unknown; end?: unknown };
  return [held.selectorText, held.conditionText, held.start, held.end].filter((part) => typeof part === "string").join(" ");
}

/** The same for a rule as the browser holds it */
function namesPath(rule: CSSRule, namesKeptOut: (text: string) => boolean): boolean {
  if (namesPathIn(preludeOf(rule), namesKeptOut)) {
    return true;
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
  // A rule with a selector goes as a whole, and so does a rule that names a path in what stands before its block
  if (inner === undefined || inner.length === 0 || open === -1 || typeof (rule as { selectorText?: unknown }).selectorText === "string" || namesPathIn(preludeOf(rule), namesKeptOut)) {
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
    // As Obsidian has the font: a weight the font is not declared for is drawn by the browser from the one it has, there and here
    css +=
      `@font-face { font-family: "${family}"; src: url("${name}") format("${FONT_FORMATS[extensionOf(path)] ?? "truetype"}"); ` +
      `font-weight: ${face.weight}; font-style: ${face.style}; font-stretch: ${face.stretch}; unicode-range: ${face.unicodeRange}; font-display: swap; }\n`;
  }
  return { css, resources };
}

