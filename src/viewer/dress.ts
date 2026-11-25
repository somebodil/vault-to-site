import { el, iconNodes } from "./dom.ts";

/**
 * Gives the lists of a note what the reading view of Obsidian gives them
 * after it has drawn a note: a mark of its own before every item of a list
 * with bullets, which the style sheets of Obsidian draw the bullet with, and
 * a triangle before an item that has a list inside it, which folds that
 * list. Obsidian draws a note for the build without them.
 */
export function dressLists(root: ParentNode, triangle: string, canFold: boolean): void {
  for (const list of Array.from(root.querySelectorAll("ul"))) {
    list.classList.add("has-list-bullet");
  }
  for (const item of Array.from(root.querySelectorAll("li"))) {
    const first = item.firstChild;
    if (first instanceof Element && (first.classList.contains("list-bullet") || first.classList.contains("list-collapse-indicator"))) {
      // Dressed before
      continue;
    }
    if (item.parentElement?.localName === "ul") {
      item.insertBefore(el("span", { cls: "list-bullet" }), first);
    }
    if (canFold && Array.from(item.children).some((child) => child.localName === "ul" || child.localName === "ol")) {
      const indicator = el("span", { cls: "list-collapse-indicator collapse-indicator collapse-icon" }, iconNodes(triangle));
      indicator.addEventListener("click", (event) => {
        event.stopPropagation();
        indicator.classList.toggle("is-collapsed", item.classList.toggle("is-collapsed"));
      });
      item.insertBefore(indicator, first);
    }
  }
}

/**
 * Puts a link that opens the PDF itself above every PDF shown in a frame:
 * the viewer of the browser then shows all of it in a page of its own. On a
 * phone or a tablet the link stands alone (viewer.css): Safari there draws a
 * PDF in a frame as its first page only, cut to the frame.
 */
export function dressPdfs(root: ParentNode): void {
  for (const frame of Array.from(root.querySelectorAll("iframe.v2s-pdf"))) {
    const src = frame.getAttribute("src");
    if (src === null || frame.previousElementSibling?.classList.contains("v2s-pdf-open") === true) {
      continue;
    }
    const name = frame.getAttribute("title") ?? "PDF";
    const link = el("a", { cls: "external-link", text: "Open " + name, attr: { href: src, target: "_blank", rel: "noopener" } });
    frame.before(el("div", { cls: "v2s-pdf-open" }, [link]));
  }
}

/**
 * Gives every embedded note the corner that opens it, as the reading view of
 * Obsidian does. A press on it is heard by the page.
 */
export function dressEmbeds(root: ParentNode, corner: string): void {
  for (const embed of Array.from(root.querySelectorAll(".markdown-embed[data-v2s-open]"))) {
    if (Array.from(embed.children).some((child) => child.classList.contains("markdown-embed-link"))) {
      continue;
    }
    embed.appendChild(el("div", { cls: "markdown-embed-link", attr: { "aria-label": "Open link", role: "button" } }, iconNodes(corner)));
  }
}
