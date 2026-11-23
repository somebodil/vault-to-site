import type { SiteIndex } from "../site-format.ts";
import { el } from "./dom.ts";
import { findLines, nameScore, type Haystack } from "./find.ts";
import { titleOf } from "./note.ts";

export interface SearchHost {
  index: SiteIndex;
  /** The texts of the notes, once they are loaded. Starts the loading when asked the first time: a search by name does not need them. */
  texts(): { ready: Haystack[]; loading: Promise<void> | null };
  /** Opens a note, and shows `find` in it when it is given */
  go(id: string, find: string): void;
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
    isNote: host.index.notes[id] !== undefined,
  }));
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
    let isWaitingForTexts = false;
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
      const named = names
        .map((entry) => ({ entry, score: typed === "" ? (entry.isNote ? 1 : 0) : nameScore(typed, entry.title) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
        .slice(0, typed === "" ? 30 : MOST_NAMES);
      for (const { entry } of named) {
        row(entry.title, folderOf(entry.path), () => host.go(entry.id, ""));
      }
      if (typed.length >= 2) {
        const { ready, loading } = host.texts();
        if (!isWaitingForTexts) {
          // The texts arrive after they are asked for: the search is done again when they are there
          isWaitingForTexts = true;
          void loading?.then(() => {
            if (modal === mine && input.value.trim().length >= 2) {
              draw();
            }
          });
        }
        let shown = 0;
        for (const hay of ready) {
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
            row(titleOf(path), snippet, () => host.go(hay.id, found));
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
      } else if (event.key === "Escape") {
        close();
      }
    });
    input.value = query;
    draw();
    input.focus();
  };

  return { open, close };
}
