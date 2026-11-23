import { readNoteAddress, type NotePage } from "../site-format.ts";
import { el } from "./dom.ts";
import { noteBlocks } from "./note.ts";

export interface PreviewHost {
  /** True for a note of the site: only notes have a preview */
  isNote(id: string): boolean;
  load(id: string): Promise<NotePage | null>;
  /** Gives the note in the preview what the page gives a note after it is drawn */
  dress(view: HTMLElement): void;
}

/** How long the pointer rests on a link before its note is shown, as in Obsidian */
const REST = 350;
/** How long the preview stays after the pointer has left, so that the pointer can be moved onto it */
const LINGER = 250;

/**
 * Shows the note of a link in a small window while the pointer rests on the
 * link, as the page preview of Obsidian does. Only where there is a pointer
 * that can rest: on a phone a touch opens the note.
 */
export function watchPreviews(root: HTMLElement, host: PreviewHost): void {
  if (!window.matchMedia("(hover: hover)").matches) {
    return;
  }
  let popover: HTMLElement | null = null;
  let waiting = 0;
  let leaving = 0;
  let wanted = "";

  const close = (): void => {
    window.clearTimeout(waiting);
    window.clearTimeout(leaving);
    popover?.remove();
    popover = null;
    wanted = "";
  };

  const open = async (link: Element, id: string, heading: string): Promise<void> => {
    const page = await host.load(id);
    if (page === null || wanted !== link.getAttribute("href") || !link.isConnected) {
      return;
    }
    popover?.remove();
    const view = el("div", { cls: "markdown-preview-view markdown-rendered" });
    view.append(...noteBlocks(page.html));
    host.dress(view);
    const mine = el("div", { cls: "popover hover-popover v2s-popover" }, [
      el("div", { cls: "markdown-embed is-loaded" }, [el("div", { cls: "markdown-embed-content" }, [view])]),
    ]);
    popover = mine;
    document.body.appendChild(mine);

    // Below the link where there is room, else above it; never off the window
    const at = link.getBoundingClientRect();
    const box = mine.getBoundingClientRect();
    const below = at.bottom + 6 + box.height <= window.innerHeight || at.top < box.height + 6;
    mine.style.left = `${String(Math.max(8, Math.min(at.left, window.innerWidth - box.width - 8)))}px`;
    mine.style.top = `${String(below ? Math.min(at.bottom + 6, window.innerHeight - box.height - 8) : at.top - box.height - 6)}px`;
    if (heading !== "") {
      Array.from(view.querySelectorAll("[data-heading]"))
        .find((h) => h.getAttribute("data-heading") === heading)
        ?.scrollIntoView({ block: "start" });
    }
    mine.addEventListener("mouseenter", () => window.clearTimeout(leaving));
    mine.addEventListener("mouseleave", () => {
      leaving = window.setTimeout(close, LINGER);
    });
    mine.addEventListener("click", (event) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
      const href = anchor?.getAttribute("href") ?? "";
      if (anchor === null) {
        return;
      }
      if (href.startsWith("#/")) {
        // A link to a note is followed as any other: the preview has done its work
        close();
        return;
      }
      // A link inside the page, as the one from a footnote: it stays inside the preview, and the address is left alone
      event.preventDefault();
      if (href.length > 1) {
        view.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: "center" });
      }
    });
  };

  root.addEventListener("mouseover", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href^='#/']") : null;
    const href = link?.getAttribute("href") ?? "";
    if (link === null) {
      return;
    }
    if (href === wanted) {
      // Back on the link whose note is shown or asked for: it stays
      window.clearTimeout(leaving);
      return;
    }
    const { id, heading } = readNoteAddress(href);
    if (!host.isNote(id)) {
      return;
    }
    window.clearTimeout(waiting);
    window.clearTimeout(leaving);
    wanted = href;
    waiting = window.setTimeout(() => {
      void open(link, id, heading);
    }, REST);
  });
  root.addEventListener("mouseout", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href^='#/']") : null;
    // From one part of a link to another part of it, the pointer has not left the link
    if (link === null || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) {
      return;
    }
    window.clearTimeout(waiting);
    if (popover === null) {
      // Left before the note was shown: nothing is asked for any more, and coming back starts the wait again
      wanted = "";
    } else {
      leaving = window.setTimeout(close, LINGER);
    }
  });
  window.addEventListener("hashchange", close);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    }
  });
}
