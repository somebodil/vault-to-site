import { readNoteAddress, type NotePage, type SiteGlobal, type SiteIndex } from "../site-format.ts";
import { el, iconButton, kept, loadScript, setIcon } from "./dom.ts";
import { haystack, type Haystack } from "./find.ts";
import { addFolding, unfoldFor } from "./fold.ts";
import { graphView } from "./graph.ts";
import { dressEmbeds, dressLists } from "./dress.ts";
import { copyText, fileView, findHeading, noteBlocks, propertiesView, titleOf } from "./note.ts";
import { watchPreviews } from "./preview.ts";
import { createSearch, type Found } from "./search.ts";
import { watchSwipe, type Side } from "./swipe.ts";
import { buildTree, firstNote, treeView } from "./tree.ts";

/**
 * The script of the site. It draws a frame like that of Obsidian, with the
 * classes Obsidian uses, so that the style sheets copied from Obsidian give
 * it the same look: the tree of files on the left, the note in the middle,
 * the outline and the backlinks on the right.
 *
 * The address after index.html says which note is open: `#/<id>`, or
 * `#/<id>/<heading>`. So the buttons of the browser go back and forth between
 * notes, and an address can be kept or passed on.
 */

/**
 * The notes that are loaded, the one used last at the end. Not all that were
 * ever asked for: a note is asked for when the pointer only rests on a link
 * to it, and a long visit to a large site would hold hundreds that were
 * never read.
 */
const pages = new Map<string, NotePage>();
const MOST_PAGES = 60;
/** The texts to search in, as the scripts of the data hand them over */
const texts: Haystack[] = [];

const site: SiteGlobal = {
  index(loaded) {
    start(loaded);
  },
  note(id, page) {
    pages.delete(id);
    pages.set(id, page);
    for (const oldest of pages.keys()) {
      if (pages.size <= MOST_PAGES) {
        break;
      }
      pages.delete(oldest);
    }
  },
  search(_part, entries) {
    for (const [id, text] of entries) {
      texts.push(haystack(id, text));
    }
  },
};
(window as unknown as { __site: SiteGlobal }).__site = site;

/** The notes that are being loaded, so that one note is asked for once */
const loading = new Map<string, Promise<void>>();

async function loadNote(id: string): Promise<NotePage | null> {
  if (!pages.has(id)) {
    let request = loading.get(id);
    if (request === undefined) {
      request = loadScript(`data/n/${id}.js`).catch(() => undefined);
      loading.set(id, request);
    }
    await request;
    loading.delete(id);
  }
  const page = pages.get(id);
  if (page !== undefined) {
    // Used now: it is the last to give way
    pages.delete(id);
    pages.set(id, page);
  }
  return page ?? null;
}

function start(index: SiteIndex): void {
  const icons = index.icons;
  const body = document.body;
  body.setAttribute("style", index.bodyStyle);
  body.classList.add("obsidian-app", "show-view-header", "v2s");
  body.classList.toggle("show-inline-title", index.inlineTitle);
  body.classList.add(/Mac|iPhone|iPad/.test(navigator.platform) ? "mod-macos" : /Win/.test(navigator.platform) ? "mod-windows" : "mod-linux");

  // ---- Look: dark or light, as Obsidian was when the site was built, until the reader chooses ----
  let theme = kept.get("theme") ?? index.theme;
  const themeButton = iconButton(icons, "sun", "Dark or light", () => {
    theme = theme === "dark" ? "light" : "dark";
    kept.set("theme", theme);
    applyTheme();
  });
  /** What is told when the look changes: the graphs paint with its colors */
  const onLook: (() => void)[] = [];
  const applyTheme = (): void => {
    body.classList.toggle("theme-dark", theme === "dark");
    body.classList.toggle("theme-light", theme !== "dark");
    setIcon(themeButton, icons, theme === "dark" ? "sun" : "moon", "Dark or light");
    onLook.forEach((tell) => tell());
  };
  applyTheme();

  /** The id of the note that is shown, or empty */
  let current = "";

  // ---- What is worked out once for the whole site ----
  const root = buildTree(index);
  /** For every note, the notes that link to it */
  const linkedFrom = new Map<string, string[]>();
  for (const [id, note] of Object.entries(index.notes)) {
    for (const to of note.l) {
      const from = linkedFrom.get(to);
      if (from === undefined) {
        linkedFrom.set(to, [id]);
      } else {
        from.push(id);
      }
    }
  }
  let searchLoading: Promise<void> | null = null;
  const search = createSearch({
    index,
    texts() {
      searchLoading ??= Promise.all(Array.from({ length: index.searchParts }, (_, part) => loadScript(`data/s/${String(part)}.js`))).then(
        () => undefined,
        () => undefined,
      );
      return { ready: texts, loading: searchLoading };
    },
    go(id, find) {
      // The address does not change for a note that is open or on its way: nothing would be told of it
      if (window.location.hash === "#/" + id || (current === id && find !== null)) {
        void show(id, "", find);
        return;
      }
      pendingFind = find;
      window.location.hash = "#/" + id;
    },
  });

  // ---- Frame ----
  const openFolders = new Set<string>(readList(kept.get("folders")));
  const tree = treeView(root, index, icons["right-triangle"] ?? "", openFolders, () => {
    kept.set("folders", JSON.stringify([...openFolders]));
  });
  const sizer = el("div", { cls: "markdown-preview-sizer markdown-preview-section" });
  // A site of an earlier build does not say how the view was set: then as Obsidian is at first
  const viewClass = typeof index.viewClass === "string" ? index.viewClass : "is-readable-line-width allow-fold-headings allow-fold-lists show-indentation-guide show-properties";
  const canFold = (what: "headings" | "lists"): boolean => ` ${viewClass} `.includes(` allow-fold-${what} `);
  const triangle = icons["right-triangle"] ?? "";
  // A box of a task or of a property shows what the note says. It is not for ticking: nothing would keep the tick.
  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === "checkbox" && event.target.closest(".markdown-rendered, .metadata-container") !== null) {
        event.preventDefault();
      }
    },
    true,
  );
  const scroller = el(
    "div",
    { cls: `markdown-preview-view markdown-rendered node-insert-event ${viewClass}` },
    [sizer],
  );
  // A note that is wider than the window, as with a wide diagram, is moved sideways by a finger as a whole.
  // The style sheet leaves that to the browser only where there is something to move: see the narrow window there.
  /** Where a note that was come back to is to be scrolled to, until the reader moves it or it has stood long enough */
  let putBack: number | null = null;
  new ResizeObserver(() => {
    scroller.classList.toggle("v2s-wide", scroller.scrollWidth > scroller.clientWidth + 1);
    // A picture that arrives makes the note taller: the place is counted from its top, so it is set again
    if (putBack !== null) {
      scroller.scrollTop = putBack;
    }
  }).observe(sizer);
  for (const type of ["wheel", "touchstart", "keydown", "mousedown"]) {
    scroller.addEventListener(type, () => (putBack = null), { passive: true });
  }
  const titleParent = el("div", { cls: "view-header-title-parent" });
  const title = el("div", { cls: "view-header-title" });
  const outline = el("div", { cls: "v2s-pane-body" });
  const backlinks = el("div", { cls: "v2s-pane-body" });

  // ---- Graphs: the one of the note that is open, at the side, and the one of the whole site ----
  // A color is a variable of the style sheets of Obsidian. An element is given it, and the browser says what it paints.
  const probe = el("span", { attr: { style: "display: none" } });
  body.appendChild(probe);
  const graphHost = {
    linksOf: (id: string): readonly string[] => index.notes[id]?.l ?? [],
    titleOf: (id: string): string => titleOf(index.notes[id]?.p ?? ""),
    color(variable: string, fallback: string): string {
      probe.style.color = `var(${variable}, ${fallback})`;
      return getComputedStyle(probe).color;
    },
  };
  const localGraph = graphView({
    ...graphHost,
    go(id) {
      window.location.hash = "#/" + id;
    },
  });
  onLook.push(() => localGraph.repaint());
  let isGraphOpen = false;
  const openGraph = (): void => {
    // The button keeps the keyboard after it was pressed: pressing it again is not a second graph
    if (isGraphOpen) {
      return;
    }
    isGraphOpen = true;
    const whole = graphView({
      ...graphHost,
      go(id) {
        closeGraph();
        window.location.hash = "#/" + id;
      },
    });
    const closeGraph = (): void => {
      isGraphOpen = false;
      whole.stop();
      modal.remove();
      window.removeEventListener("keydown", onKey);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeGraph();
      }
    };
    const bg = el("div", { cls: "modal-bg" });
    const closeButton = iconButton(icons, "x", "Close", closeGraph);
    closeButton.classList.add("v2s-graph-close");
    const modal = el("div", { cls: "modal-container mod-dim v2s-modal" }, [bg, el("div", { cls: "modal v2s-graph-modal" }, [closeButton, whole.el])]);
    bg.addEventListener("click", closeGraph);
    window.addEventListener("keydown", onKey);
    body.appendChild(modal);
    whole.show(Object.keys(index.notes), current === "" ? null : current);
  };

  const left = el("div", { cls: "v2s-left" }, [
    el("div", { cls: "v2s-left-top" }, [el("div", { cls: "v2s-vault-name", text: index.name }), iconButton(icons, "search", "Search", () => search.open("")), themeButton]),
    tree.el,
  ]);
  const right = el("div", { cls: "v2s-right" }, [
    el("div", { cls: "v2s-pane-title", text: "Outline" }),
    outline,
    el("div", { cls: "v2s-pane-title", text: "Backlinks" }),
    backlinks,
    el("div", { cls: "v2s-pane-title", text: "Graph" }),
    el("div", { cls: "v2s-local-graph" }, [localGraph.el]),
  ]);
  const main = el("div", { cls: "v2s-main" }, [
    el("div", { cls: "view-header" }, [
      iconButton(icons, "sidebar-left", "Files", () => toggle("left")),
      el("div", { cls: "view-header-title-container mod-at-start" }, [titleParent, title]),
      el("div", { cls: "view-actions" }, [
        iconButton(icons, "search", "Search", () => search.open("")),
        iconButton(icons, "git-fork", "Graph of the site", openGraph),
        iconButton(icons, "sidebar-right", "Outline and backlinks", () => toggle("right")),
      ]),
    ]),
    el("div", { cls: "view-content" }, [el("div", { cls: "markdown-reading-view" }, [scroller])]),
  ]);
  // What darkens the note while it is moved aside, and takes the touch that moves it back
  const scrim = el("div", { cls: "v2s-scrim" });
  main.appendChild(scrim);
  const app = el("div", { cls: "v2s-app" }, [left, main, right]);
  body.appendChild(app);

  // ---- The two sides: next to the note on a wide window, under it on a narrow one, where the note moves aside for them ----
  const narrow = window.matchMedia("(max-width: 750px)");
  const shown = { left: false, right: false };
  /** The side a finger is uncovering or covering on a narrow window: it is seen, though it is not open yet or any more */
  let moving: Side | null = null;
  /**
   * The note that is open with the notes it links to and the notes that link
   * to it. Placed only while the side is seen: on a phone it mostly is not.
   */
  let graphOf: string | null = null;
  const drawLocalGraph = (): void => {
    if ((!shown.right && moving !== "right") || graphOf === current) {
      return;
    }
    graphOf = current;
    const around = index.notes[current] === undefined ? [] : [...new Set([current, ...(index.notes[current]?.l ?? []), ...(linkedFrom.get(current) ?? [])])];
    localGraph.show(around, current === "" ? null : current);
  };

  const applySides = (): void => {
    app.classList.toggle("v2s-show-left", shown.left);
    app.classList.toggle("v2s-show-right", shown.right);
    drawLocalGraph();
    body.classList.toggle("is-mobile", narrow.matches);
    body.classList.toggle("is-phone", narrow.matches);
  };
  const sidesForWidth = (): void => {
    shown.left = !narrow.matches && kept.get("left") !== "0";
    shown.right = !narrow.matches && kept.get("right") === "1";
    applySides();
  };
  const toggle = (side: "left" | "right"): void => {
    shown[side] = !shown[side];
    if (narrow.matches && shown[side]) {
      shown[side === "left" ? "right" : "left"] = false;
    }
    if (!narrow.matches) {
      kept.set(side, shown[side] ? "1" : "0");
    }
    applySides();
  };
  const closeOnNarrow = (): void => {
    if (narrow.matches && (shown.left || shown.right)) {
      shown.left = false;
      shown.right = false;
      applySides();
    }
  };
  scrim.addEventListener("click", closeOnNarrow);

  // A finger moves the note aside. While it does, the place of the note is set on the note itself: a class
  // or a variable would have the browser work out the styles of the whole note at every move.
  const letGo = (): void => {
    moving = null;
    main.style.transform = "";
    scrim.style.opacity = "";
    app.classList.remove("v2s-moving", "v2s-moving-left", "v2s-moving-right");
  };
  const swipe = (): (() => void) =>
    watchSwipe(app, {
      open: () => (shown.left ? "left" : shown.right ? "right" : null),
      // As the style sheet has it, to the part of a pixel: the note ends where a button would put it
      width: (side) => (side === "left" ? left : right).getBoundingClientRect().width,
      begin(side) {
        moving = side;
        app.classList.add("v2s-moving", `v2s-moving-${side}`);
        drawLocalGraph();
      },
      move(shift, part) {
        main.style.transform = `translate3d(${String(shift)}px, 0, 0)`;
        scrim.style.opacity = String(part);
      },
      end(side, open) {
        letGo();
        shown.left = open && side === "left";
        shown.right = open && side === "right";
        applySides();
      },
    });
  // Fingers are watched only while the window is narrow: on a wide one nothing is asked of the browser
  let stopSwipe = narrow.matches ? swipe() : null;
  narrow.addEventListener("change", () => {
    stopSwipe?.();
    stopSwipe = narrow.matches ? swipe() : null;
    letGo();
    sidesForWidth();
  });
  sidesForWidth();

  // ---- Showing a note ----
  let drawing = 0;

  /** What a search asked to be shown in the note it leads to */
  let pendingFind: Found | null = null;

  /** Scrolls to something in the note, after opening the folded headings that hide it */
  const bring = (target: Element, block: ScrollLogicalPosition): void => {
    unfoldFor(sizer, target);
    target.scrollIntoView({ block });
  };

  const show = async (id: string, heading: string, find: Found | null): Promise<void> => {
    const turn = ++drawing;
    putBack = null;
    const note = index.notes[id];
    const file = index.files[id];
    const path = note?.p ?? file?.p;
    if (path === undefined) {
      current = "";
      sizer.replaceChildren(el("div", { cls: "v2s-empty", text: "This note is not part of the site." }));
      title.textContent = "";
      titleParent.textContent = "";
      drawOutline([]);
      backlinks.replaceChildren();
      drawLocalGraph();
      return;
    }
    // A note that is shown already is not drawn again for another place in it: what the reader folded stays folded
    if (id !== current && !(await draw(id, path, turn, heading, find))) {
      return;
    }

    const found = find !== null ? textPlace(find) : null;
    const state: unknown = window.history.state;
    if (found !== null) {
      unfoldFor(sizer, found.block);
      if (found.text === null) {
        found.block.scrollIntoView({ block: "start" });
      } else {
        // A line of a long block, as of a block of code: the line is brought into sight, a third down the window
        const line = document.createRange();
        line.selectNodeContents(found.text);
        scroller.scrollTop += line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 3;
      }
      flash(found.text?.parentElement ?? found.block);
    } else if (isPlace(state) && state.id === id) {
      // A note that is come back to with the buttons of the browser is where it was left, also when its address names a heading
      putBack = state.scroll;
      scroller.scrollTop = state.scroll;
      window.setTimeout(() => {
        if (turn === drawing) {
          putBack = null;
        }
      }, 4000);
    } else {
      const named = heading !== "" ? headingEl(heading) : null;
      if (named !== null) {
        bring(named, "start");
        flash(named);
      } else {
        scroller.scrollTop = 0;
      }
    }
  };

  const flash = (target: Element): void => {
    target.classList.add("v2s-flash");
    window.setTimeout(() => target.classList.remove("v2s-flash"), 1600);
  };

  /** Draws a note into the page. False when it could not be, or another note was asked for meanwhile. */
  const draw = async (id: string, path: string, turn: number, heading: string, find: Found | null): Promise<boolean> => {
    const note = index.notes[id];
    const file = index.files[id];
    const slash = path.lastIndexOf("/");
    titleParent.textContent = slash === -1 ? "" : path.slice(0, slash + 1);
    title.textContent = titleOf(path);
    document.title = `${titleOf(path)} - ${index.name}`;
    tree.show(id);
    closeOnNarrow();

    // As in the reading view of Obsidian: what stands above the note is one block that is not of the note,
    // the blocks of the note follow it, and a block that is not of the note ends it. Rules of Obsidian go
    // by these: the first block of a note has no space above it, and the last one keeps the space below it.
    const header = el("div", { cls: "mod-header mod-ui" });
    const parts: Node[] = [el("div", { cls: "markdown-preview-pusher" }), header];
    let headings: [number, string][] = [];
    if (index.inlineTitle) {
      header.appendChild(el("div", { cls: "inline-title", text: titleOf(path) }));
    }
    if (note === undefined && file !== undefined) {
      parts.push(fileView(file.a, path));
    } else {
      const page = await loadNote(id);
      if (turn !== drawing) {
        return false;
      }
      if (page === null) {
        // Nothing of the note before is left standing, as if it were this one, and the note can be asked for again
        current = "";
        const again = el("a", { text: "Try again", attr: { href: "#", role: "button" } });
        again.addEventListener("click", () => void show(id, heading, find));
        sizer.replaceChildren(el("div", { cls: "v2s-empty" }, [document.createTextNode("This note could not be loaded. "), again]));
        drawOutline([]);
        backlinks.replaceChildren();
        drawLocalGraph();
        return false;
      }
      if (page.props.length > 0) {
        header.appendChild(propertiesView(page.props, icons));
      }
      parts.push(...noteBlocks(page.html));
      headings = page.h;
    }
    parts.push(el("div", { cls: "mod-footer mod-ui" }));
    sizer.replaceChildren(...parts);
    current = id;
    dressLists(sizer, triangle, canFold("lists"));
    dressEmbeds(sizer, icons["maximize-2"] ?? "");
    if (canFold("headings")) {
      addFolding(sizer, triangle);
    }
    drawOutline(headings);
    drawBacklinks(id);
    drawLocalGraph();
    return true;
  };

  /** The headings of the note itself, not those of notes embedded in it */
  const ownHeadings = (): HTMLElement[] =>
    Array.from(sizer.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).filter((h) => h.closest(".markdown-embed") === null);

  /** The heading an address names: as it is written, or else as Obsidian would still find it */
  const headingEl = (heading: string): HTMLElement | null =>
    findHeading(ownHeadings(), (h) => h.getAttribute("data-heading") ?? h.textContent.trim(), heading);

  /**
   * Where in the note a search found its words: the block that holds the
   * line of the row that was chosen, and without one, the first block that
   * holds the words. In that block, the smallest part that still holds
   * them, as one row of a table, and in that part the piece of text on the
   * line, as one line of a block of code.
   *
   * Words are compared as they are read, not as they are marked up: a line
   * with a word in bold is one line, and what stands above the note, as its
   * name, is not looked at.
   */
  const textPlace = (find: Found): { block: Element; text: Text | null } | null => {
    const plain = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
    const words = plain(find.text);
    // A row shows a line cut to fit, with a sign where it was cut
    const line = plain(find.line.replace(/^…/, ""));
    if (words === "") {
      return null;
    }
    let first: { block: Element; wanted: string } | null = null;
    for (const block of Array.from(sizer.children)) {
      if (block.classList.contains("mod-ui") || block.classList.contains("markdown-preview-pusher")) {
        continue;
      }
      const text = plain(block.textContent);
      if (line !== "" && text.includes(line)) {
        first = { block, wanted: line };
        break;
      }
      if (first === null && text.includes(words)) {
        first = { block, wanted: words };
      }
    }
    if (first === null) {
      return null;
    }
    const { wanted } = first;
    let at = first.block;
    for (;;) {
      const inner: Element | undefined = Array.from(at.children).find((child) => plain(child.textContent).includes(wanted));
      if (inner === undefined) {
        break;
      }
      at = inner;
    }
    // The piece of text that holds the words, on the line of the row where several lines hold them
    const whole = at.textContent;
    const walker = document.createTreeWalker(at, NodeFilter.SHOW_TEXT);
    let anywhere: Text | null = null;
    let offset = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const piece = node.textContent ?? "";
      if (node instanceof Text && plain(piece).includes(words)) {
        const from = offset + Math.max(0, piece.toLowerCase().indexOf(words.split(" ")[0] ?? ""));
        const next = whole.indexOf("\n", from);
        const around = plain(whole.slice(whole.lastIndexOf("\n", from) + 1, next === -1 ? whole.length : next));
        if (line === "" || around.includes(line) || (around !== "" && line.includes(around))) {
          return { block: at, text: node };
        }
        anywhere ??= node;
      }
      offset += piece.length;
    }
    return { block: at, text: anywhere };
  };

  const drawOutline = (headings: [number, string][]): void => {
    if (headings.length === 0) {
      outline.replaceChildren(el("div", { cls: "pane-empty", text: "No headings found." }));
      return;
    }
    const least = Math.min(...headings.map(([level]) => level));
    outline.replaceChildren(
      ...headings.map(([level, text], at) => {
        const row = el("div", { cls: "tree-item-self is-clickable", attr: { style: `padding-inline-start: ${String(8 + (level - least) * 16)}px` } }, [
          el("div", { cls: "tree-item-inner", text }),
        ]);
        row.addEventListener("click", () => {
          // The heading with this text, and of several with the same text the one that has as many of them before it.
          // A heading on the page that the list does not know, as one inside a callout, does not shift the others.
          const before = headings.slice(0, at).filter(([, other]) => other === text).length;
          const same = ownHeadings().filter((h) => (h.getAttribute("data-heading") ?? h.textContent.trim()) === text);
          const target = same[before] ?? same[0] ?? ownHeadings()[at];
          if (target !== undefined) {
            bring(target, "start");
          }
          closeOnNarrow();
        });
        return el("div", { cls: "tree-item" }, [row]);
      }),
    );
  };

  const drawBacklinks = (id: string): void => {
    const from = (linkedFrom.get(id) ?? [])
      .map((other) => ({ id: other, path: index.notes[other]?.p ?? "" }))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (from.length === 0) {
      backlinks.replaceChildren(el("div", { cls: "pane-empty", text: "No backlinks found." }));
      return;
    }
    backlinks.replaceChildren(
      ...from.map((other) =>
        el("div", { cls: "tree-item" }, [
          el("a", { cls: "tree-item-self is-clickable", attr: { href: "#/" + other.id } }, [el("div", { cls: "tree-item-inner", text: titleOf(other.path) })]),
        ]),
      ),
    );
  };

  // ---- What can be done inside a note ----
  sizer.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const tag = target.closest("[data-v2s-tag]");
    if (tag !== null) {
      search.open(tag.getAttribute("data-v2s-tag") ?? "");
      return;
    }
    const copy = target.closest(".copy-code-button");
    if (copy !== null) {
      void copyText(copy.closest("pre")?.querySelector("code")?.textContent ?? "");
      return;
    }
    const fold = target.closest(".callout.is-collapsible > .callout-title");
    if (fold !== null) {
      const callout = fold.parentElement;
      const content = callout?.querySelector<HTMLElement>(":scope > .callout-content");
      const collapse = callout?.classList.toggle("is-collapsed") ?? false;
      fold.querySelector(".callout-fold")?.classList.toggle("is-collapsed", collapse);
      if (content !== null && content !== undefined) {
        content.style.display = collapse ? "none" : "";
      }
      return;
    }
    const opener = target.closest(".markdown-embed-link");
    const embedded = opener?.closest("[data-v2s-open]")?.getAttribute("data-v2s-open");
    if (embedded !== null && embedded !== undefined) {
      window.location.hash = "#/" + embedded;
      return;
    }
    // A link inside the page that is not a note, as the one from a footnote: the address is left alone
    const anchor = target.closest("a[href^='#']");
    const href = anchor?.getAttribute("href") ?? "";
    if (anchor !== null && !href.startsWith("#/")) {
      event.preventDefault();
      const target = href.length > 1 ? sizer.querySelector(`[id="${CSS.escape(href.slice(1))}"]`) : null;
      if (target !== null) {
        bring(target, "center");
      }
    }
  });

  // A note is asked for when the pointer rests on a link to it, so that it is there at the click. Not for a
  // pointer that only passes: moving down the list of files would ask for every note in it.
  let resting = 0;
  const linked = (event: Event): string | undefined => {
    const href = event.target instanceof Element ? event.target.closest("a[href^='#/']")?.getAttribute("href") : null;
    const id = href === null || href === undefined ? undefined : readNoteAddress(href).id;
    return id !== undefined && index.notes[id] !== undefined ? id : undefined;
  };
  app.addEventListener(
    "mouseover",
    (event) => {
      window.clearTimeout(resting);
      const id = linked(event);
      if (id !== undefined) {
        resting = window.setTimeout(() => void loadNote(id), 80);
      }
    },
    { passive: true },
  );
  // A finger that comes down on a link is about to open it
  app.addEventListener(
    "touchstart",
    (event) => {
      const id = linked(event);
      if (id !== undefined) {
        void loadNote(id);
      }
    },
    { passive: true },
  );

  watchPreviews(app, {
    isNote: (id) => index.notes[id] !== undefined,
    load: loadNote,
    dress: (view) => {
      dressLists(view, triangle, false);
      dressEmbeds(view, icons["maximize-2"] ?? "");
    },
  });

  // Where a note is scrolled to is kept with its place in the history of the browser
  let noting = 0;
  scroller.addEventListener(
    "scroll",
    () => {
      window.clearTimeout(noting);
      noting = window.setTimeout(() => {
        // Not while the note is still being put back where it was: its place then is not the reader's
        if (current !== "" && putBack === null) {
          try {
            window.history.replaceState({ id: current, scroll: scroller.scrollTop }, "");
          } catch {
            // Some browsers do not keep it for a page opened from a file
          }
        }
      }, 150);
    },
    { passive: true },
  );

  window.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    // Not the key that prints: a note of the site can be printed as any page
    if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "o")) {
      event.preventDefault();
      search.open("");
    } else if (event.key === "/" && !typing) {
      event.preventDefault();
      search.open("");
    } else if (event.key === "Escape") {
      search.close();
    }
  });

  // ---- The address ----
  const route = (): void => {
    // What was not noted of the note before is not noted for this one
    window.clearTimeout(noting);
    // An address of another kind, as that of a footnote, is not a note: what is shown stays
    if (window.location.hash.length > 1 && !window.location.hash.startsWith("#/") && current !== "") {
      return;
    }
    const { id, heading } = readNoteAddress(window.location.hash);
    const wanted = id !== "" ? id : (firstNote(root, index) ?? "");
    const find = pendingFind;
    pendingFind = null;
    void show(wanted, heading, find);
  };
  window.addEventListener("hashchange", route);
  route();
}

function isPlace(state: unknown): state is { id: string; scroll: number } {
  const place = state as { id?: unknown; scroll?: unknown } | null;
  return typeof place === "object" && place !== null && typeof place.id === "string" && typeof place.scroll === "number";
}

function readList(saved: string | null): string[] {
  try {
    const list: unknown = JSON.parse(saved ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
