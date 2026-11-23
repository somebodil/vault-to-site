import type { PropertyValue } from "../site-format.ts";
import { el } from "./dom.ts";

/** The name of a note or file, without its folder and without `.md` */
export function titleOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

/**
 * Reads a note back as it was written: as XML, so that a block inside a
 * paragraph stays there. Should a browser refuse the XML, the note is read as
 * HTML, which shows the same words with some of the nesting lost.
 */
/**
 * The blocks of a note as the reading view of Obsidian has them: each in a
 * `div` that is named after what it holds, as `el-h2`, `el-p` or `el-ul`.
 * Obsidian draws a note for the build without these, and its own style
 * sheets, themes and snippets are written for a view that has them: the
 * first block of a note has no space above it, and a rule can be given for
 * `.el-h2 + .el-p`.
 */
export function noteBlocks(xml: string): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const node of noteNodes(xml)) {
    if (node instanceof Element) {
      blocks.push(el("div", { cls: `el-${node.localName.toLowerCase()}` }, [node]));
    } else if ((node.textContent ?? "").trim() !== "") {
      blocks.push(el("div", {}, [node]));
    }
  }
  return blocks;
}

function noteNodes(xml: string): Node[] {
  const parsed = new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${xml}</div>`, "application/xhtml+xml");
  const root = parsed.documentElement;
  if (root.localName === "div" && parsed.getElementsByTagName("parsererror").length === 0) {
    return Array.from(document.importNode(root, true).childNodes);
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
export function propertiesView(props: [string, PropertyValue][]): HTMLElement {
  const valueEl = (value: PropertyValue): HTMLElement => {
    if (Array.isArray(value)) {
      return el(
        "div",
        { cls: "multi-select-container" },
        value.map((item) => el("div", { cls: "multi-select-pill" }, [el("div", { cls: "multi-select-pill-content", text: plain(item) })])),
      );
    }
    if (typeof value === "boolean") {
      const box = el("input", { cls: "metadata-input-checkbox", attr: { type: "checkbox", disabled: "" } });
      box.checked = value;
      return box;
    }
    return el("div", { cls: "metadata-input-longtext", text: plain(value) });
  };
  return el("div", { cls: "metadata-container", attr: { tabindex: "-1" } }, [
    el("div", { cls: "metadata-properties-heading" }, [el("div", { cls: "metadata-properties-title", text: "Properties" })]),
    el("div", { cls: "metadata-content" }, [
      el(
        "div",
        { cls: "metadata-properties" },
        props.map(([key, value]) =>
          el("div", { cls: "metadata-property", attr: { "data-property-key": key } }, [
            el("div", { cls: "metadata-property-key" }, [el("div", { cls: "metadata-property-key-input", text: key })]),
            el("div", { cls: "metadata-property-value" }, [valueEl(value)]),
          ]),
        ),
      ),
    ]),
  ]);
}

function plain(value: PropertyValue): string {
  if (value === null) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
