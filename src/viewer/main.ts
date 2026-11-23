import type { NotePage, PropertyValue, SearchPart, SiteGlobal, SiteIndex } from "../site-format.ts";
import { el, iconButton, kept, loadScript, setIcon } from "./dom.ts";
import { findLines, nameScore } from "./find.ts";
import { buildTree, firstNote, treeView, type TreeView } from "./tree.ts";

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
const searchParts: SearchPart[] = [];

const site: SiteGlobal = {
  index(loaded) {
    start(loaded);
  },
  note(id, page) {
    pages.set(id, page);
  },
  search(part, entries) {
    searchParts[part] = entries;
  },
};
(window as unknown as { __site: SiteGlobal }).__site = site;

async function loadNote(id: string): Promise<NotePage | null> {
  if (!pages.has(id)) {
    try {
      await loadScript(`data/n/${id}.js`);
    } catch {
      return null;
    }
  }
  return pages.get(id) ?? null;
}

let searchLoading: Promise<void> | null = null;
function loadSearch(count: number): Promise<void> {
  searchLoading ??= Promise.all(Array.from({ length: count }, (_, part) => loadScript(`data/s/${String(part)}.js`))).then(
    () => undefined,
    () => undefined,
  );
  return searchLoading;
}

function titleOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

function start(loaded: SiteIndex): void {
  const icons = loaded.icons;
  const body = document.body;
  body.setAttribute("style", loaded.bodyStyle);
  body.classList.add("obsidian-app", "show-view-header", "v2s");
  body.classList.toggle("show-inline-title", loaded.inlineTitle);
  body.classList.add(/Mac|iPhone|iPad/.test(navigator.platform) ? "mod-macos" : /Win/.test(navigator.platform) ? "mod-windows" : "mod-linux");

  // ---- Look: dark or light, as Obsidian was when the site was built, until the reader chooses ----
  let theme = kept.get("theme") ?? loaded.theme;
  const themeButton = iconButton(icons, "sun", "Dark or light", () => {
    theme = theme === "dark" ? "light" : "dark";
    kept.set("theme", theme);
    applyTheme();
  });
  const applyTheme = (): void => {
    body.classList.toggle("theme-dark", theme === "dark");
    body.classList.toggle("theme-light", theme !== "dark");
    setIcon(themeButton, icons, theme === "dark" ? "sun" : "moon", "Dark or light");
  };
  applyTheme();

  // ---- Frame ----
  const root = buildTree(loaded);
  const openFolders = new Set<string>(JSON.parse(kept.get("folders") ?? "[]") as string[]);
  const tree: TreeView = treeView(root, icons["right-triangle"] ?? "", openFolders, () => {
    kept.set("folders", JSON.stringify([...openFolders]));
  });

  const sizer = el("div", { cls: "markdown-preview-sizer markdown-preview-section" });
  const preview = el(
    "div",
    { cls: "markdown-preview-view markdown-rendered node-insert-event is-readable-line-width allow-fold-headings allow-fold-lists show-indentation-guide show-properties" },
    [sizer],
  );
  const scroller = preview;
  const titleParent = el("div", { cls: "view-header-title-parent" });
  const title = el("div", { cls: "view-header-title" });
  const outline = el("div", { cls: "v2s-pane-body" });
  const backlinks = el("div", { cls: "v2s-pane-body" });

  const left = el("div", { cls: "v2s-left" }, [
    el("div", { cls: "v2s-left-top" }, [
      el("div", { cls: "v2s-vault-name", text: loaded.name }),
      iconButton(icons, "search", "Search", () => openSearch("")),
      themeButton,
    ]),
    tree.el,
  ]);
  const right = el("div", { cls: "v2s-right" }, [
    el("div", { cls: "v2s-pane-title", text: "Outline" }),
    outline,
    el("div", { cls: "v2s-pane-title", text: "Backlinks" }),
    backlinks,
  ]);
  const main = el("div", { cls: "v2s-main" }, [
    el("div", { cls: "view-header" }, [
      iconButton(icons, "sidebar-left", "Files", () => toggle("left")),
      el("div", { cls: "view-header-title-container mod-at-start" }, [titleParent, title]),
      el("div", { cls: "view-actions" }, [
        iconButton(icons, "search", "Search", () => openSearch("")),
        iconButton(icons, "sidebar-right", "Outline and backlinks", () => toggle("right")),
      ]),
    ]),
    el("div", { cls: "view-content" }, [el("div", { cls: "markdown-reading-view" }, [preview])]),
  ]);
  const scrim = el("div", { cls: "v2s-scrim" });
  const app = el("div", { cls: "v2s-app" }, [left, main, right, scrim]);
  body.appendChild(app);

  // ---- The two sides: next to the note on a wide window, over it on a narrow one ----
  const narrow = window.matchMedia("(max-width: 750px)");
  const shown = { left: kept.get("left") !== "0", right: kept.get("right") === "1" };
  const applySides = (): void => {
    app.classList.toggle("v2s-show-left", shown.left);
    app.classList.toggle("v2s-show-right", shown.right);
    body.classList.toggle("is-mobile", narrow.matches);
    body.classList.toggle("is-phone", narrow.matches);
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
    if (narrow.matches) {
      shown.left = false;
      shown.right = false;
      applySides();
    }
  };
  scrim.addEventListener("click", closeOnNarrow);
  narrow.addEventListener("change", () => {
    if (narrow.matches) {
      shown.left = false;
      shown.right = false;
    } else {
      shown.left = kept.get("left") !== "0";
      shown.right = kept.get("right") === "1";
    }
    applySides();
  });
  if (narrow.matches) {
    shown.left = false;
    shown.right = false;
  }
  applySides();

  // ---- Showing a note ----
  let current = "";
  let drawing = 0;

  const show = async (id: string, heading: string, find: string): Promise<void> => {
    const turn = ++drawing;
    const note = loaded.notes[id];
    const file = loaded.files[id];
    const path = note?.p ?? file?.p;
    if (path === undefined) {
      sizer.replaceChildren(el("div", { cls: "v2s-empty", text: "This note is not part of the site." }));
      title.textContent = "";
      titleParent.textContent = "";
      return;
    }
    const slash = path.lastIndexOf("/");
    titleParent.textContent = slash === -1 ? "" : path.slice(0, slash + 1);
    title.textContent = titleOf(path);
    document.title = `${titleOf(path)} - ${loaded.name}`;
    tree.show(id);
    closeOnNarrow();

    const parts: Node[] = [];
    if (note === undefined && file !== undefined) {
      parts.push(el("div", { cls: "inline-title", text: titleOf(path) }), fileView(file.a, path));
    } else {
      const page = await loadNote(id);
      if (turn !== drawing) {
        return;
      }
      if (page === null) {
        sizer.replaceChildren(el("div", { cls: "v2s-empty", text: "This note could not be loaded." }));
        return;
      }
      if (loaded.inlineTitle) {
        parts.push(el("div", { cls: "inline-title", text: titleOf(path) }));
      }
      if (page.props.length > 0) {
        parts.push(propertiesView(page.props));
      }
      parts.push(...noteNodes(page.html));
    }
    sizer.replaceChildren(...parts);
    current = id;
    drawOutline(id);
    drawBacklinks(id);

    const target = heading !== "" ? headingEl(heading) : find !== "" ? textEl(find) : null;
    if (target === null) {
      scroller.scrollTop = 0;
    } else {
      target.scrollIntoView({ block: "start" });
      target.classList.add("v2s-flash");
      window.setTimeout(() => target.classList.remove("v2s-flash"), 1600);
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

  const drawOutline = (id: string): void => {
    const headings = loaded.notes[id]?.h ?? [];
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
          (ownHeadings()[at] ?? headingEl(text))?.scrollIntoView({ block: "start" });
          closeOnNarrow();
        });
        return el("div", { cls: "tree-item" }, [row]);
      }),
    );
  };

  const drawBacklinks = (id: string): void => {
    const from = Object.entries(loaded.notes)
      .filter(([, note]) => note.l.includes(id))
      .map(([other, note]) => ({ id: other, path: note.p }))
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
      openSearch(tag.getAttribute("data-v2s-tag") ?? "");
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

  // ---- Search ----
  /** What a search asked to be shown in the note it leads to */
  let pendingFind = "";
  let modal: HTMLElement | null = null;
  const closeSearch = (): void => {
    modal?.remove();
    modal = null;
  };
  const openSearch = (query: string): void => {
    closeSearch();
    const input = el("input", { cls: "prompt-input", attr: { type: "text", placeholder: "Find a note by name, or text in the notes", enterkeyhint: "go", spellcheck: "false" } });
    const results = el("div", { cls: "prompt-results" });
    const bg = el("div", { cls: "modal-bg" });
    modal = el("div", { cls: "modal-container mod-dim v2s-modal" }, [bg, el("div", { cls: "prompt" }, [el("div", { cls: "prompt-input-container" }, [input]), results])]);
    body.appendChild(modal);
    bg.addEventListener("click", closeSearch);

    let rows: { el: HTMLElement; go: () => void }[] = [];
    let selected = 0;
    const select = (at: number): void => {
      rows[selected]?.el.classList.remove("is-selected");
      selected = Math.max(0, Math.min(at, rows.length - 1));
      rows[selected]?.el.classList.add("is-selected");
      rows[selected]?.el.scrollIntoView({ block: "nearest" });
    };
    const row = (name: string, note: Node | string, go: () => void): void => {
      const item = el("div", { cls: "suggestion-item mod-complex" }, [
        el("div", { cls: "suggestion-content" }, [
          el("div", { cls: "suggestion-title", text: name }),
          typeof note === "string" ? el("div", { cls: "suggestion-note", text: note }) : el("div", { cls: "suggestion-note" }, [note]),
        ]),
      ]);
      const at = rows.length;
      item.addEventListener("click", () => {
        closeSearch();
        go();
      });
      item.addEventListener("mousemove", () => select(at));
      rows.push({ el: item, go });
      results.appendChild(item);
    };
    const folderOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

    const draw = (): void => {
      const typed = input.value.trim();
      results.replaceChildren();
      rows = [];
      const named = [...Object.entries(loaded.notes), ...Object.entries(loaded.files)]
        .map(([id, entry]) => ({ id, path: entry.p, score: typed === "" ? 1 : nameScore(typed, titleOf(entry.p)) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, typed === "" ? 30 : 12);
      for (const hit of named) {
        row(titleOf(hit.path), folderOf(hit.path), () => {
          window.location.hash = "#/" + hit.id;
        });
      }
      if (typed.length >= 2) {
        let shown = 0;
        for (const part of searchParts) {
          for (const [id, text] of part ?? []) {
            const path = loaded.notes[id]?.p;
            if (path === undefined || shown >= 40) {
              continue;
            }
            for (const line of findLines(typed, text, 2)) {
              const snippet = el("span", {}, [
                document.createTextNode(line.text.slice(0, line.start)),
                el("span", { cls: "suggestion-highlight", text: line.text.slice(line.start, line.end) }),
                document.createTextNode(line.text.slice(line.end)),
              ]);
              const found = line.text.slice(line.start, line.end);
              row(titleOf(path), snippet, () => {
                if (current === id) {
                  void show(id, "", found);
                } else {
                  pendingFind = found;
                  window.location.hash = "#/" + id;
                }
              });
              shown++;
            }
          }
        }
      }
      if (rows.length === 0) {
        results.appendChild(el("div", { cls: "suggestion-empty", text: typed === "" ? "Nothing to show." : "No matches found." }));
      }
      select(0);
    };

    input.addEventListener("input", draw);
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        select(selected + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        select(selected - 1);
      } else if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        const chosen = rows[selected];
        if (chosen !== undefined) {
          closeSearch();
          chosen.go();
        }
      } else if (event.key === "Escape") {
        closeSearch();
      }
    });
    input.value = query;
    draw();
    input.focus();
    void loadSearch(loaded.searchParts).then(() => {
      if (modal !== null && input.value.trim().length >= 2) {
        draw();
      }
    });
  };
  window.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "o" || event.key === "p")) {
      event.preventDefault();
      openSearch("");
    } else if (event.key === "/" && !typing) {
      event.preventDefault();
      openSearch("");
    } else if (event.key === "Escape") {
      closeSearch();
    }
  });

  // ---- The address ----
  const route = (): void => {
    const [, id = "", heading = ""] = window.location.hash.split("/");
    const wanted = id !== "" ? decodeURIComponent(id) : (firstNote(root, loaded) ?? "");
    const find = pendingFind;
    pendingFind = "";
    void show(wanted, safeDecode(heading), find);
  };
  window.addEventListener("hashchange", route);
  route();
}

/**
 * Reads a note back as it was written: as XML, so that a block inside a
 * paragraph stays there. Should a browser refuse the XML, the note is read as
 * HTML, which shows the same words with some of the nesting lost.
 */
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

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The browser does not let this page use the clipboard. The text can still be selected by hand.
  }
}

/** A file that is not a note: a picture, a sound, a film, a PDF, or a link to it */
function fileView(asset: string, path: string): HTMLElement {
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
function propertiesView(props: [string, PropertyValue][]): HTMLElement {
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
