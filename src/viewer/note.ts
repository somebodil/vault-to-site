import { readNoteAddress, type PropertyEntry, type PropertyValue } from "../site-format.ts";
import { el } from "./dom.ts";

/** The name of a note or file, without its folder and without `.md` */
export function titleOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

/**
 * A heading as it is compared when a link names it in other letters than it
 * is written in: Obsidian finds "Step 1: Install" for a link to "step 1
 * install". Letters and digits in lower case, with one space where anything
 * else stands.
 */
export function headingKey(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The heading among these that a link names: the one written the same, and
 * without one, the first that is the same when compared loosely.
 */
export function findHeading<T>(headings: readonly T[], textOf: (heading: T) => string, wanted: string): T | null {
  const key = headingKey(wanted);
  return headings.find((h) => textOf(h) === wanted) ?? (key === "" ? null : (headings.find((h) => headingKey(textOf(h)) === key) ?? null));
}

/**
 * The note an address names: the one whose id it holds, and for an address
 * without one, the note the site opens with.
 */
export function noteOfAddress(address: string, first: string): string {
  const { id } = readNoteAddress(address);
  return id !== "" ? id : first;
}

/**
 * True when two addresses name the same note and the same heading, however
 * each of them is written. A browser tells nothing of a link to the address
 * it has already.
 */
export function sameAddress(one: string, other: string): boolean {
  const a = readNoteAddress(one);
  const b = readNoteAddress(other);
  return a.id === b.id && a.heading === b.heading;
}

/**
 * The blocks of a note as the reading view of Obsidian has them: each in a
 * `div` that is named after what it holds, as `el-h2`, `el-p` or `el-ul`.
 * Obsidian draws a note for the build without these, and its own style
 * sheets, themes and snippets are written for a view that has them: the
 * first block of a note has no space above it, and a rule can be given for
 * `.el-h2 + .el-p`.
 */
export function noteBlocks(xml: string, isLazy = false): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const node of noteNodes(xml, isLazy)) {
    if (node instanceof Element) {
      const name = node.localName.toLowerCase();
      // What Obsidian draws from a block of code, as a diagram, keeps the name of the block it was written as
      const isDrawnCode = name === "div" && /(^|\s)(mermaid|block-language-\S+)(\s|$)/.test(node.getAttribute("class") ?? "");
      blocks.push(el("div", { cls: isDrawnCode ? "el-pre" : `el-${name}` }, [node]));
    } else if ((node.textContent ?? "").trim() !== "") {
      blocks.push(el("div", {}, [node]));
    }
  }
  return blocks;
}

/**
 * Reads a note back as it was written: as XML, so that a block inside a
 * paragraph stays there. Should a browser refuse the XML, the note is read as
 * HTML, which shows the same words with some of the nesting lost.
 *
 * @param isLazy pictures and frames are fetched when they come into sight, not at once: for a small window on a note, which shows a part of it
 */
function noteNodes(xml: string, isLazy: boolean): Node[] {
  const parsed = new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${xml}</div>`, "application/xhtml+xml");
  const root = parsed.documentElement;
  if (root.localName === "div" && parsed.getElementsByTagName("parsererror").length === 0) {
    if (isLazy) {
      // Said while the note is still in the document it was read into, where nothing is fetched yet
      for (const media of Array.from(root.querySelectorAll("img, iframe"))) {
        media.setAttribute("loading", "lazy");
      }
    }
    // Moved, not copied: the document they were read into is not used again
    return Array.from(document.adoptNode(root).childNodes);
  }
  const content = el("div");
  // What Obsidian drew for the note. The build has cleaned it of scripts.
  content.innerHTML = xml;
  return Array.from(content.childNodes);
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The browser does not let this page use the clipboard. The text can still be selected by hand.
  }
}

/** A file that is not a note: a picture, a sound, a film, a PDF, or a link to it */
export function fileView(asset: string, path: string): HTMLElement {
  const ending = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ending)) {
    return el("div", { cls: "image-container" }, [el("img", { attr: { src: asset, alt: titleOf(path) } })]);
  }
  if (["mp3", "wav", "m4a", "ogg", "flac", "3gp"].includes(ending)) {
    return el("audio", { attr: { src: asset, controls: "" } });
  }
  if (["mp4", "webm", "ogv", "mov", "mkv"].includes(ending)) {
    return el("video", { attr: { src: asset, controls: "" } });
  }
  if (ending === "pdf") {
    return el("iframe", { cls: "v2s-pdf", attr: { src: asset, title: titleOf(path) } });
  }
  return el("p", {}, [el("a", { cls: "external-link", text: "Open " + titleOf(path), attr: { href: asset, target: "_blank", rel: "noopener" } })]);
}

/** The properties of a note, with the classes Obsidian gives them */
export function propertiesView(props: PropertyEntry[], icons: Record<string, string>): HTMLElement {
  /** One item of a value: a link when it leads to a note of the site, else its words */
  const linkOr = (cls: string, words: string, to: string | null | undefined, plainCls: string): HTMLElement => {
    if (to === null || to === undefined) {
      return el("div", { cls: plainCls, text: words });
    }
    const link = el("div", { cls: `${cls} internal-link`, text: words, attr: { role: "link", tabindex: "0" } });
    const go = (): void => {
      window.location.hash = to;
    };
    link.addEventListener("click", go);
    link.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        go();
      }
    });
    return link;
  };
  const field = (cls: string, type: string, value: string): HTMLElement => el("input", { cls, attr: { type, value, readonly: "", tabindex: "-1", placeholder: "Empty" } });

  const valueEl = (value: PropertyValue, kind: string, to: (string | null)[] | undefined): HTMLElement => {
    if (Array.isArray(value)) {
      return el(
        "div",
        { cls: "multi-select-container", attr: { tabindex: "-1" } },
        value.map((item, at) =>
          el("div", { cls: "multi-select-pill" }, [
            kind === "tags"
              ? el("div", { cls: "multi-select-pill-content" }, [el("span", { text: plain(item) })])
              : linkOr("multi-select-pill-content", plain(item), to?.[at], "multi-select-pill-content"),
          ]),
        ),
      );
    }
    if (typeof value === "boolean") {
      const box = el("input", { cls: "metadata-input-checkbox", attr: { type: "checkbox", "data-indeterminate": "false" } });
      box.checked = value;
      return box;
    }
    // A kind that the value does not fit is shown as text, as the words of the note are
    if (kind === "number" && typeof value === "number") {
      return field("metadata-input metadata-input-number", "number", String(value));
    }
    if (kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return field("metadata-input metadata-input-text mod-date", "date", value);
    }
    if (kind === "datetime" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      return field("metadata-input metadata-input-text mod-datetime", "datetime-local", value.slice(0, 19));
    }
    if (to?.[0] !== null && to?.[0] !== undefined) {
      return el("div", { cls: "metadata-link" }, [linkOr("metadata-link-inner", plain(value), to[0], "metadata-link-inner")]);
    }
    return el("div", { cls: "metadata-input-longtext", text: plain(value), attr: { placeholder: "Empty" } });
  };

  const container = el("div", { cls: "metadata-container", attr: { tabindex: "-1", "data-property-count": String(props.length) } });
  const indicator = el("div", { cls: "collapse-indicator collapse-icon" });
  indicator.innerHTML = icons["right-triangle"] ?? "";
  const heading = el("div", { cls: "metadata-properties-heading", attr: { tabindex: "0", role: "button" } }, [indicator, el("div", { cls: "metadata-properties-title", text: "Properties" })]);
  const fold = (): void => {
    indicator.classList.toggle("is-collapsed", container.classList.toggle("is-collapsed"));
  };
  heading.addEventListener("click", fold);
  heading.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fold();
    }
  });
  container.append(
    heading,
    el("div", { cls: "metadata-content" }, [
      el(
        "div",
        { cls: "metadata-properties" },
        props.map(([key, value, kind = "text", to]) => {
          const icon = el("span", { cls: "metadata-property-icon" });
          icon.innerHTML = icons[`property-${kind}`] ?? "";
          return el("div", { cls: "metadata-property", attr: { "data-property-key": key } }, [
            el("div", { cls: "metadata-property-key" }, [icon, field("metadata-property-key-input", "text", key)]),
            el("div", { cls: "metadata-property-value", attr: { "data-property-type": kind } }, [valueEl(value, kind, to)]),
          ]);
        }),
      ),
    ]),
  );
  return container;
}

function plain(value: PropertyValue): string {
  if (value === null) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
