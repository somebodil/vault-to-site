import type { SiteIndex } from "../site-format.ts";
import { el } from "./dom.ts";
import { findLines, foldedNameScore, foldName, type Haystack } from "./find.ts";
import { titleOf } from "./note.ts";

export interface SearchHost {
  index: SiteIndex;
  /** The texts of the notes that are loaded, in the order of the site */
  texts(): readonly Haystack[];
  /**
   * Asks for the texts that are not there: a search by name does not need
   * them. Gives back what ends when they have arrived or could not be
   * loaded, and null when all of them are there.
   */
  load(): Promise<void> | null;
  /** Opens a note, and shows what was found in it when that is given */
  go(id: string, find: Found | null): void;
}

/** What a search found in a note: the words that fit, and the line of the row they stand in */
export interface Found {
  text: string;
  line: string;
}

export interface Search {
  open(query: string): void;
  close(): void;
}

const MOST_NAMES = 12;
const MOST_LINES = 40;
/** Typing does not search at every key: the search waits this long for the next one */
const WAIT = 70;

/**
 * The search dialog, with the classes of the quick switcher of Obsidian. One
 * input finds notes by name and lines by text: the names come first, as they
 * are found without loading anything.
 */
export function createSearch(host: SearchHost): Search {
  let modal: HTMLElement | null = null;
  const names = [...Object.entries(host.index.notes), ...Object.entries(host.index.files)].map(([id, entry]) => ({
    id,
    path: entry.p,
    title: titleOf(entry.p),
    // In lower case once, not for every name at every key
    folded: foldName(titleOf(entry.p)),
    isNote: host.index.notes[id] !== undefined,
  }));
  // In the order of their paths once: a search then sorts only by how well a name fits, and names that fit as well stay in this order
  names.sort((a, b) => a.path.localeCompare(b.path));
  const folderOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

  const close = (): void => {
    modal?.remove();
    modal = null;
  };

  const open = (query: string): void => {
    close();
    const input = el("input", {
      cls: "prompt-input",
      attr: { type: "text", placeholder: "Find a note by name, or text in the notes", enterkeyhint: "go", spellcheck: "false", autocapitalize: "off" },
    });
    const results = el("div", { cls: "prompt-results" });
    const bg = el("div", { cls: "modal-bg" });
    const mine = el("div", { cls: "modal-container mod-dim v2s-modal" }, [bg, el("div", { cls: "prompt" }, [el("div", { cls: "prompt-input-container" }, [input]), results])]);
    modal = mine;
    document.body.appendChild(mine);
    bg.addEventListener("click", close);

    let rows: { el: HTMLElement; go: () => void }[] = [];
    let selected = 0;
    let hasAskedForTexts = false;
    const select = (at: number, scroll: boolean): void => {
      rows[selected]?.el.classList.remove("is-selected");
      selected = Math.max(0, Math.min(at, rows.length - 1));
      rows[selected]?.el.classList.add("is-selected");
      if (scroll) {
        rows[selected]?.el.scrollIntoView({ block: "nearest" });
      }
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
        close();
        go();
      });
      item.addEventListener("mousemove", () => select(at, false));
      rows.push({ el: item, go });
      results.appendChild(item);
    };

    const draw = (): void => {
      const typed = input.value.trim();
      results.replaceChildren();
      rows = [];
      const foldedTyped = foldName(typed);
      const named = names
        .map((entry) => ({ entry, score: typed === "" ? (entry.isNote ? 1 : 0) : foldedNameScore(foldedTyped, entry.folded) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, typed === "" ? 30 : MOST_NAMES);
      for (const { entry } of named) {
        row(entry.title, folderOf(entry.path), () => host.go(entry.id, null));
      }
      if (typed.length >= 2) {
        if (!hasAskedForTexts) {
          // Once for each time the search is opened, not at every key: a part that could not be loaded is asked for again the next time
          hasAskedForTexts = true;
          // The texts arrive after they are asked for: the search is done again when they are there.
          // With all of them there, nothing is waited for, and nothing is searched a second time.
          void host.load()?.then(() => {
            if (modal === mine && input.value.trim().length >= 2) {
              draw();
            }
          });
        }
        let shown = 0;
        for (const hay of host.texts()) {
          if (shown >= MOST_LINES) {
            break;
          }
          const path = host.index.notes[hay.id]?.p;
          if (path === undefined) {
            continue;
          }
          for (const line of findLines(typed, hay, 2)) {
            const found = line.text.slice(line.start, line.end);
            const snippet = el("span", {}, [
              document.createTextNode(line.text.slice(0, line.start)),
              el("span", { cls: "suggestion-highlight", text: found }),
              document.createTextNode(line.text.slice(line.end)),
            ]);
            row(titleOf(path), snippet, () => host.go(hay.id, { text: found, line: line.text }));
            shown++;
          }
        }
      }
      if (rows.length === 0) {
        results.appendChild(el("div", { cls: "suggestion-empty", text: typed === "" ? "Nothing to show." : "No matches found." }));
      }
      select(0, false);
    };

    let timer = 0;
    /** True while what was typed last has not been searched for yet */
    let isBehind = false;
    const catchUp = (): void => {
      if (isBehind) {
        window.clearTimeout(timer);
        isBehind = false;
        draw();
      }
    };
    input.addEventListener("input", () => {
      window.clearTimeout(timer);
      isBehind = true;
      timer = window.setTimeout(catchUp, WAIT);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        select(selected + 1, true);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        select(selected - 1, true);
      } else if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        catchUp();
        const chosen = rows[selected];
        if (chosen !== undefined) {
          close();
          chosen.go();
        }
      }
    });
    input.value = query;
    draw();
    input.focus();
  };

  return { open, close };
}
