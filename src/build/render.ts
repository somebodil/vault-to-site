import { type App, Component, MarkdownRenderer, parseLinktext, type TFile } from "obsidian";
import { noteAddress } from "../site-format.ts";
import { EMPTY_URL } from "./styles.ts";
import { shownWords } from "./words.ts";

/** What the drawing of a note needs to know of the site */
export interface RenderContext {
  app: App;
  /** The notes of the site: path to id */
  noteIds: ReadonlyMap<string, string>;
  /** The other files of the site: path to where they are in the site */
  assets: ReadonlyMap<string, string>;
  /** The file of the vault that an address inside Obsidian shows, or null */
  resourceToPath: (url: string) => string | null;
  /** An element of the page of Obsidian, out of sight, to draw in */
  stage: HTMLElement;
}

/** A note as the site holds it */
export interface Rendered {
  /** What Obsidian drew, made fit for the site, as XML: see `serialize` */
  html: string;
  /** False when the time for a note ran out while a part of it had not arrived */
  isWhole: boolean;
  /** The words of it, a line for each paragraph, row or item: what the search of the site looks through */
  text: string;
}

/** Set while a note is tidied: the note an embed shows, for the links inside it */
const SOURCE = "data-v2s-source";
/** On a link that the build has made itself, to a file of the site, while a note is tidied */
const MADE = "data-v2s-made";
/** On what was emptied because it is not part of the site */
export const LEFT_OUT = "v2s-left-out";

/**
 * Has Obsidian draw a note, and makes what it drew fit for the site.
 *
 * Obsidian puts the text of an embedded note into the note that embeds it,
 * and the path of a linked note into the link. So nothing that points
 * outside the site is kept as it is: an embed, a link or a picture stays only
 * when it is known to be part of the site, and is emptied otherwise.
 */
export async function renderNote(file: TFile, text: string, context: RenderContext): Promise<Rendered> {
  const host = context.stage.createDiv({ cls: "markdown-preview-view markdown-rendered" });
  const component = new Component();
  component.load();
  try {
    await inTime(MarkdownRenderer.render(context.app, text, host, file.path, component));
    const isWhole = await settled(host);
    tidy(host, file, context);
    return { html: serialize(host), isWhole, text: visibleText(host) };
  } finally {
    component.unload();
    host.remove();
  }
}

/** The longest Obsidian is given to draw one note. Another plugin that never answers would hold the build for good. */
const LONGEST_DRAW = 60_000;

function inTime(drawing: Promise<void>): Promise<void> {
  let timer = 0;
  const late = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error("Obsidian did not finish drawing it."));
    }, LONGEST_DRAW);
  });
  return Promise.race([drawing, late]).finally(() => window.clearTimeout(timer));
}

/**
 * Waits until what was drawn stops changing. Embedded notes, formulas,
 * diagrams and the output of other plugins arrive after the first drawing.
 * What Obsidian marks as not ready yet is waited for by name; for the rest,
 * a short time without a change is taken as the end.
 *
 * @returns false when the time ran out while something that was waited for by name had not arrived
 */
function settled(host: HTMLElement): Promise<boolean> {
  // Formulas, code and embeds say when they are ready, and are waited for by name below. What says nothing
  // is the block of a plugin, such as a query: a note with one is given more time without a change.
  const QUIET = host.querySelector(".internal-embed, .mermaid, iframe, [class*='block-language-'], [class*='dataview']") === null ? 30 : 120;
  const LONGEST = 6000;
  const LONGEST_FOR_KNOWN = 4000;
  const start = Date.now();
  const isWaited = (): boolean =>
    host.querySelector(
      ".markdown-embed:not(.is-loaded), .math:not(.is-loaded), pre > code[class*='language-']:not(.is-loaded), .block-language-dataview:empty, .block-language-dataviewjs:empty",
    ) !== null ||
    Array.from(host.querySelectorAll(".mermaid")).some((diagram) => diagram.querySelector("svg") === null);
  return new Promise((resolve) => {
    let timer = 0;
    const finish = (): void => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(last);
      resolve(!isWaited());
    };
    const quiet = (): void => {
      if (isWaited() && Date.now() - start < LONGEST_FOR_KNOWN) {
        timer = window.setTimeout(quiet, QUIET);
        return;
      }
      finish();
    };
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(quiet, QUIET);
    });
    observer.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
    timer = window.setTimeout(quiet, QUIET);
    const last = window.setTimeout(finish, LONGEST);
  });
}

/** Characters that XML does not allow. A note can hold them; the site leaves them out. */
// eslint-disable-next-line no-control-regex -- the control characters are what is looked for
const NOT_IN_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * Writes what was drawn as XML, not as HTML.
 *
 * Obsidian puts blocks where HTML has no place for them: an embedded note is
 * a block inside a paragraph. Made with script that is fine, but written as
 * HTML and read again by a browser, the paragraph ends where the block
 * starts, and the embed is empty with its text after it. XML is read back
 * exactly as it was written.
 */
function serialize(host: HTMLElement): string {
  const serializer = new XMLSerializer();
  let xml = "";
  host.childNodes.forEach((node) => {
    xml += serializer.serializeToString(node);
  });
  return xml.replace(NOT_IN_XML, "");
}

/**
 * Takes out what could run script or reach outside the page. Obsidian cleans
 * what it draws already; this is for what a plugin may add after that.
 */
function disarm(host: HTMLElement): void {
  host.querySelectorAll("script, base, meta, link, object, embed, applet").forEach((el) => el.remove());
  host.querySelectorAll("*").forEach((el) => {
    for (const attribute of Array.from(el.attributes)) {
      const name = attribute.name.toLowerCase();
      const isAddress = name === "href" || name === "src" || name === "xlink:href" || name === "action" || name === "formaction";
      if (name.startsWith("on") || name === "srcdoc" || (isAddress && /^\s*(javascript|vbscript):/i.test(attribute.value))) {
        el.removeAttribute(attribute.name);
      }
    }
  });
}

function tidy(host: HTMLElement, file: TFile, context: RenderContext): void {
  disarm(host);
  // The properties are drawn by the site from the list of them
  host.querySelectorAll(".frontmatter, .frontmatter-container, .metadata-container").forEach((el) => el.remove());
  tidyEmbeds(host, file, context);
  tidyLinks(host, file, context);
  tidyMedia(host, context);
  host.querySelectorAll("a.tag").forEach((tag) => {
    tag.setAttribute("data-v2s-tag", tag.textContent ?? "");
    tag.removeAttribute("href");
  });
  host.querySelectorAll("a.external-link").forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener");
  });
  dropOtherAddresses(host, context);
  host.querySelectorAll("input[type=checkbox]").forEach((box) => box.setAttribute("disabled", ""));
  // A heading carries its text as it was written, with the target of a link in it
  host.querySelectorAll("[data-heading]").forEach((heading) => {
    heading.setAttribute("data-heading", shownWords(heading.getAttribute("data-heading") ?? ""));
  });
  // The block of the search of Obsidian lists lines of other notes, and a block of a base lists notes
  // and their properties, whatever they are
  host.querySelectorAll(".block-language-query, .internal-query, .block-language-base, .bases-embed").forEach(emptyOut);
  dropInnerAddresses(host);
  host.querySelectorAll(`[${SOURCE}], [${MADE}]`).forEach((el) => {
    el.removeAttribute(SOURCE);
    el.removeAttribute(MADE);
  });
}

/**
 * An address that leads into the running Obsidian or to a file of the
 * device. `obsidian://` is one of them: it opens a note by the name of the
 * vault and the path of the note.
 */
const INNER_AT_START = /^\s*(app|capacitor|file|obsidian):/i;
/** The same further inside a value, as in a style or in a list of pictures of several sizes */
const INNER_INSIDE = /(^|[\s"'(,])(app|capacitor|file|obsidian):\/\/|\/_capacitor_file_\//i;
/** Attributes whose whole value is one address. An address of the web may hold another address as a part of it, and is left alone. */
const ONE_ADDRESS = new Set(["href", "src", "poster", "data", "action", "formaction", "cite", "xlink:href"]);

/**
 * Takes out every address that only works inside Obsidian. The pictures and
 * links of the site have theirs already; what is left of this kind would be
 * dead in the site, and it holds the path of the vault on the device.
 */
function dropInnerAddresses(host: HTMLElement): void {
  host.querySelectorAll("*").forEach((el) => {
    for (const attribute of Array.from(el.attributes)) {
      const isOne = ONE_ADDRESS.has(attribute.name.toLowerCase());
      if (isOne ? INNER_AT_START.test(attribute.value) || attribute.value.includes("/_capacitor_file_/") : INNER_INSIDE.test(attribute.value)) {
        el.removeAttribute(attribute.name);
      }
    }
  });
}

/** An address with a scheme, as `https:` or `mailto:`, that does not lead into Obsidian, to a file of the device, or to script */
const OUTER_ADDRESS = /^\s*(?!(?:app|capacitor|file|obsidian|javascript|vbscript|data|blob):)[a-z][a-z0-9+.-]*:/i;
/** Every attribute of HTML and of a drawing whose value is an address */
const ADDRESS_ATTRIBUTES = new Set([
  "href",
  "xlink:href",
  "src",
  "poster",
  "data",
  "action",
  "formaction",
  "cite",
  "background",
  "longdesc",
  "ping",
  "manifest",
  "codebase",
  "archive",
  "lowsrc",
  "dynsrc",
  "icon",
]);
/** Attributes that hold a list of pictures of several sizes */
const ADDRESS_LISTS = new Set(["srcset", "imagesrcset"]);
/** What draws a picture or plays a sound from its `src`, as a picture inside a drawing does from its `href`: there, one that is written into the page itself is as good as one of the web */
const MEDIA = new Set(["IMG", "AUDIO", "VIDEO", "SOURCE"]);
const URL_IN_STYLE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

/**
 * Takes away every address that is not one of the site and does not lead out
 * of it. The links and pictures that Obsidian knows as such have their
 * addresses by now. What is left with an address without a scheme was
 * written as HTML, as `<a href="Folder/Note.md">` or a picture in a `style`:
 * a path of the vault, which may be the path of a note that is kept out.
 *
 * An address of the site is one the build has made, and nothing that only
 * looks like one: a vault can have a folder with the name the site gives its
 * files.
 */
function dropOtherAddresses(host: HTMLElement, context: RenderContext): void {
  const made = new Set(context.assets.values());
  const isGood = (address: string): boolean => {
    const plain = address.trim();
    return plain.startsWith("#") || made.has(plain.split("#")[0] ?? "") || OUTER_ADDRESS.test(plain);
  };
  const isPicture = (address: string): boolean => /^\s*data:(image|audio|video)\//i.test(address);
  host.querySelectorAll("*").forEach((el) => {
    for (const attribute of Array.from(el.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name === "src" && el.classList.contains("internal-embed")) {
        // What an embed was written with. The embeds of what is not in the site have lost it already,
        // and rules of themes and snippets pick an embed by it, as one that puts a picture to the side.
        continue;
      }
      if (ADDRESS_ATTRIBUTES.has(name)) {
        const drawsIt = name === "src" ? MEDIA.has(el.tagName) : el.localName === "image" && name.endsWith("href");
        if (isGood(attribute.value) || (drawsIt && isPicture(attribute.value))) {
          continue;
        }
        el.removeAttribute(attribute.name);
        if (el.tagName === "A") {
          el.removeAttribute("aria-label");
          el.removeAttribute("title");
          el.classList.add("is-unresolved");
        }
      } else if (ADDRESS_LISTS.has(name)) {
        // Each of them has to be good
        const addresses = attribute.value.split(",").map((part) => part.trim().split(/\s+/)[0] ?? "");
        if (!addresses.every((address) => isGood(address) || isPicture(address))) {
          el.removeAttribute(attribute.name);
        }
      } else if (name === "style" && attribute.value.toLowerCase().includes("url(")) {
        el.setAttribute(
          attribute.name,
          attribute.value.replace(URL_IN_STYLE, (whole, double: string | undefined, single: string | undefined, bare: string | undefined) => {
            const address = double ?? single ?? bare ?? "";
            return /^\s*https?:/i.test(address) || isPicture(address) ? whole : EMPTY_URL;
          }),
        );
      }
    }
  });
}

/** The note that the text around an element comes from: the embedded note it is inside of, or the note itself */
function sourceOf(el: Element, file: TFile): string {
  return el.parentElement?.closest(`[${SOURCE}]`)?.getAttribute(SOURCE) ?? file.path;
}

function emptyOut(el: Element): void {
  el.replaceChildren();
  for (const name of ["src", "alt", "href", "data-href", "aria-label", "title"]) {
    el.removeAttribute(name);
  }
  el.classList.add(LEFT_OUT);
}

function tidyEmbeds(host: HTMLElement, file: TFile, context: RenderContext): void {
  // In the order of the page, so that an embed is seen before the embeds inside it
  for (const embed of Array.from(host.querySelectorAll<HTMLElement>(".internal-embed"))) {
    if (!host.contains(embed)) {
      continue;
    }
    const { path } = parseLinktext(embed.getAttribute("src") ?? "");
    const source = sourceOf(embed, file);
    const target = path === "" ? source : context.app.metadataCache.getFirstLinkpathDest(path, source)?.path;
    if (target === undefined) {
      emptyOut(embed);
      continue;
    }
    const noteId = context.noteIds.get(target);
    const asset = context.assets.get(target);
    if (noteId !== undefined) {
      embed.setAttribute(SOURCE, target);
      embed.setAttribute("data-v2s-open", noteId);
    } else if (asset === undefined) {
      emptyOut(embed);
    } else if (embed.classList.contains("pdf-embed")) {
      // Obsidian shows a PDF with a viewer of its own. A browser has one too.
      embed.replaceChildren(createEl("iframe", { cls: "v2s-pdf", attr: { src: asset, title: target.slice(target.lastIndexOf("/") + 1) } }));
    } else if (!embed.classList.contains("media-embed")) {
      // A canvas, a base or another file that Obsidian draws with content of its own: cards and rows
      // of other notes, whatever they are. The file is part of the site, so there is a link to it.
      const name = target.slice(target.lastIndexOf("/") + 1);
      embed.replaceChildren(createEl("a", { cls: "internal-link", text: name, attr: { href: asset, target: "_blank", [MADE]: "" } }));
      for (const attribute of ["src", "alt"]) {
        embed.removeAttribute(attribute);
      }
    }
  }
}

function tidyLinks(host: HTMLElement, file: TFile, context: RenderContext): void {
  for (const link of Array.from(host.querySelectorAll<HTMLElement>("a.internal-link"))) {
    if (link.hasAttribute(MADE)) {
      // Has the address of a file of the site already. Whatever carries this mark without being made here loses its address later.
      continue;
    }
    const { path, subpath } = parseLinktext(link.getAttribute("data-href") ?? link.getAttribute("href") ?? "");
    const source = sourceOf(link, file);
    const target = path === "" ? source : context.app.metadataCache.getFirstLinkpathDest(path, source)?.path;
    link.removeAttribute("data-href");
    link.removeAttribute("target");
    link.removeAttribute("rel");
    const noteId = target === undefined ? undefined : context.noteIds.get(target);
    const asset = target === undefined ? undefined : context.assets.get(target);
    if (noteId !== undefined) {
      link.setAttribute("href", noteAddress(noteId, headingOf(subpath)));
    } else if (asset !== undefined) {
      link.setAttribute("href", asset);
      link.setAttribute("target", "_blank");
    } else {
      // The words of the link are part of the note and stay. Where it led does not.
      for (const name of ["href", "aria-label", "title", "data-tooltip-position"]) {
        link.removeAttribute(name);
      }
      link.classList.add("is-unresolved");
    }
  }
}

/** The heading a link ends with. A link to a block has none: it leads to the note. */
function headingOf(subpath: string): string {
  if (subpath === "" || subpath.includes("^")) {
    return "";
  }
  return subpath.slice(subpath.lastIndexOf("#") + 1);
}

function tidyMedia(host: HTMLElement, context: RenderContext): void {
  for (const el of Array.from(host.querySelectorAll<HTMLElement>("img[src], audio[src], video[src], source[src]"))) {
    const src = el.getAttribute("src") ?? "";
    const path = context.resourceToPath(src);
    const asset = path === null ? undefined : context.assets.get(path);
    if (asset !== undefined) {
      el.setAttribute("src", asset);
    } else if (path !== null || !isFromTheWeb(src)) {
      emptyOut(el);
    }
  }
}

/** A picture that a note takes from the web stays where it is. Anything else that is not a file of the site goes. */
function isFromTheWeb(src: string): boolean {
  if (src.startsWith("data:")) {
    return true;
  }
  try {
    const url = new URL(src);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

const BLOCKS = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "BLOCKQUOTE", "DIV", "TABLE", "UL", "OL", "DL", "DT", "DD", "HR", "BR", "SECTION", "FIGURE", "FIGCAPTION", "DETAILS", "SUMMARY"]);
/** What has no words to search for: drawings, formulas as they are drawn, buttons, and what was emptied */
const WORDLESS = new Set(["SVG", "STYLE", "SCRIPT", "MJX-CONTAINER", "BUTTON", "IFRAME", "IMG", "AUDIO", "VIDEO"]);

/**
 * The words of a note as a reader of the site sees them, a line for each
 * block. The search looks through this and not through the note as it was
 * written: a link written as `[[Folder/Name|words]]` shows only its words, and
 * so only they are found.
 */
export function visibleText(host: HTMLElement): string {
  const lines: string[] = [];
  let line = "";
  const end = (): void => {
    const clean = line.replace(/\s+/g, " ").trim();
    if (clean !== "") {
      lines.push(clean);
    }
    line = "";
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      line += node.textContent ?? "";
      return;
    }
    if (!node.instanceOf(Element) || WORDLESS.has(node.tagName.toUpperCase())) {
      return;
    }
    if (node.tagName === "PRE") {
      end();
      for (const row of (node.querySelector("code") ?? node).textContent.split("\n")) {
        if (row.trim() !== "") {
          lines.push(row.trimEnd());
        }
      }
      return;
    }
    const isBlock = BLOCKS.has(node.tagName);
    if (isBlock) {
      end();
    }
    node.childNodes.forEach(walk);
    if (isBlock) {
      end();
    } else if (node.tagName === "TD" || node.tagName === "TH") {
      line += " ";
    }
  };
  walk(host);
  end();
  return lines.join("\n");
}

/**
 * Makes the way back from the address Obsidian gives a file to the file.
 * An address has a number after a question mark that changes with the file.
 */
export function resourceMap(app: App): (url: string) => string | null {
  const paths = new Map<string, string>();
  const key = (url: string): string => {
    const plain = url.split("?")[0] ?? "";
    try {
      return decodeURIComponent(plain);
    } catch {
      return plain;
    }
  };
  for (const file of app.vault.getFiles()) {
    paths.set(key(app.vault.getResourcePath(file)), file.path);
  }
  return (url) => paths.get(key(url)) ?? null;
}
