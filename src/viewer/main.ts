import type { NotePage, SiteGlobal, SiteIndex } from "../site-format.ts";
import { el, iconButton, kept, loadScript, setIcon } from "./dom.ts";
import { haystack, type Haystack } from "./find.ts";
import { addFolding } from "./fold.ts";
import { graphView } from "./graph.ts";
import { dressEmbeds, dressLists } from "./dress.ts";
import { copyText, fileView, noteBlocks, propertiesView, titleOf } from "./note.ts";
import { watchPreviews } from "./preview.ts";
import { createSearch } from "./search.ts";
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

const pages = new Map<string, NotePage>();
/** The texts to search in, as the scripts of the data hand them over */
const texts: Haystack[] = [];

const site: SiteGlobal = {
  index(loaded) {
    start(loaded);
  },
  note(id, page) {
    pages.set(id, page);
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
  return pages.get(id) ?? null;
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
      if (current === id && find !== "") {
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
  const openGraph = (): void => {
    const whole = graphView({
      ...graphHost,
      go(id) {
        closeGraph();
        window.location.hash = "#/" + id;
      },
    });
    const closeGraph = (): void => {
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
  const scrim = el("div", { cls: "v2s-scrim" });
  const app = el("div", { cls: "v2s-app" }, [left, main, right, scrim]);
  body.appendChild(app);

  // ---- The two sides: next to the note on a wide window, over it on a narrow one ----
  const narrow = window.matchMedia("(max-width: 750px)");
  const shown = { left: false, right: false };
  /**
   * The note that is open with the notes it links to and the notes that link
   * to it. Placed only while the side is seen: on a phone it mostly is not.
   */
  let graphOf: string | null = null;
  const drawLocalGraph = (): void => {
    if (!shown.right || graphOf === current) {
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
  narrow.addEventListener("change", sidesForWidth);
  sidesForWidth();

  // ---- Showing a note ----
  let drawing = 0;

  /** What a search asked to be shown in the note it leads to */
  let pendingFind = "";

  const show = async (id: string, heading: string, find: string): Promise<void> => {
    const turn = ++drawing;
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
    const slash = path.lastIndexOf("/");
    titleParent.textContent = slash === -1 ? "" : path.slice(0, slash + 1);
    title.textContent = titleOf(path);
    document.title = `${titleOf(path)} - ${index.name}`;
    tree.show(id);
    closeOnNarrow();

    // As in the reading view of Obsidian: what stands above the note is one block that is not of the note, and the blocks of the note follow it
    const header = el("div", { cls: "mod-header mod-ui" });
    const parts: Node[] = [header];
    let headings: [number, string][] = [];
    if (index.inlineTitle) {
      header.appendChild(el("div", { cls: "inline-title", text: titleOf(path) }));
    }
    if (note === undefined && file !== undefined) {
      parts.push(fileView(file.a, path));
    } else {
      const page = await loadNote(id);
      if (turn !== drawing) {
        return;
      }
      if (page === null) {
        sizer.replaceChildren(el("div", { cls: "v2s-empty", text: "This note could not be loaded." }));
        return;
      }
      if (page.props.length > 0) {
        header.appendChild(propertiesView(page.props, icons));
      }
      parts.push(...noteBlocks(page.html));
      headings = page.h;
    }
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

    const target = heading !== "" ? headingEl(heading) : find !== "" ? textEl(find) : null;
    if (target !== null) {
      target.scrollIntoView({ block: "start" });
      target.classList.add("v2s-flash");
      window.setTimeout(() => target.classList.remove("v2s-flash"), 1600);
    } else {
      // A note that is come back to with the buttons of the browser is where it was left
      const state: unknown = window.history.state;
      scroller.scrollTop = isPlace(state) && state.id === id ? state.scroll : 0;
    }
  };

  /** The headings of the note itself, not those of notes embedded in it */
  const ownHeadings = (): HTMLElement[] =>
    Array.from(sizer.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).filter((h) => h.closest(".markdown-embed") === null);

  const headingEl = (heading: string): HTMLElement | null =>
    ownHeadings().find((h) => h.getAttribute("data-heading") === heading || h.textContent.trim() === heading) ?? null;

  /** The first element whose own text holds what was searched for */
  const textEl = (find: string): HTMLElement | null => {
    const wanted = find.toLowerCase();
    const walker = document.createTreeWalker(sizer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent ?? "").toLowerCase().includes(wanted)) {
        return node.parentElement;
      }
    }
    return null;
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
          (same[before] ?? same[0] ?? ownHeadings()[at])?.scrollIntoView({ block: "start" });
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
      if (href.length > 1) {
        sizer.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: "center" });
      }
    }
  });

  // A note is asked for when the pointer comes to a link to it, so that it is there at the click
  const ahead = (event: Event): void => {
    const href = event.target instanceof Element ? event.target.closest("a[href^='#/']")?.getAttribute("href") : null;
    const id = href?.split("/")[1];
    if (id !== undefined && index.notes[id] !== undefined) {
      void loadNote(id);
    }
  };
  app.addEventListener("mouseover", ahead, { passive: true });
  app.addEventListener("touchstart", ahead, { passive: true });

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
        if (current !== "") {
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
    if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "o" || event.key === "p")) {
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
    const [, id = "", heading = ""] = window.location.hash.split("/");
    const wanted = id !== "" ? safeDecode(id) : (firstNote(root, index) ?? "");
    const find = pendingFind;
    pendingFind = "";
    void show(wanted, safeDecode(heading), find);
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

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
