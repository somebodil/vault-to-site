import type { SiteIndex } from "../site-format.ts";
import { el } from "./dom.ts";

/** A folder of the tree of the site */
export interface Folder {
  name: string;
  path: string;
  folders: Folder[];
  /** Notes and files: id, name to show, and the ending of a file that is not a note */
  items: { id: string; name: string; tag: string }[];
}

/** One collator for all names: `localeCompare` with options makes a new one for every pair it compares */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

/** The folders of the site, made from the paths of what it holds. Folders come before files, as in Obsidian. */
export function buildTree(index: SiteIndex): Folder {
  const root: Folder = { name: "", path: "", folders: [], items: [] };
  const folders = new Map<string, Folder>([["", root]]);
  const folderOf = (path: string): Folder => {
    const known = folders.get(path);
    if (known !== undefined) {
      return known;
    }
    const slash = path.lastIndexOf("/");
    const folder: Folder = { name: path.slice(slash + 1), path, folders: [], items: [] };
    folders.set(path, folder);
    folderOf(slash === -1 ? "" : path.slice(0, slash)).folders.push(folder);
    return folder;
  };
  const add = (id: string, path: string, isNote: boolean): void => {
    const slash = path.lastIndexOf("/");
    const file = path.slice(slash + 1);
    const dot = file.lastIndexOf(".");
    folderOf(slash === -1 ? "" : path.slice(0, slash)).items.push({
      id,
      name: isNote || dot <= 0 ? file.replace(/\.md$/i, "") : file.slice(0, dot),
      tag: isNote || dot <= 0 ? "" : file.slice(dot + 1).toUpperCase(),
    });
  };
  for (const [id, note] of Object.entries(index.notes)) {
    add(id, note.p, true);
  }
  for (const [id, file] of Object.entries(index.files)) {
    add(id, file.p, false);
  }
  for (const folder of folders.values()) {
    folder.folders.sort((a, b) => byName(a.name, b.name));
    folder.items.sort((a, b) => byName(a.name, b.name));
  }
  return root;
}

/** The first note in the order of the tree: what the site opens with */
export function firstNote(folder: Folder, index: SiteIndex): string | null {
  for (const item of folder.items) {
    if (index.notes[item.id] !== undefined) {
      return item.id;
    }
  }
  for (const inner of folder.folders) {
    const found = firstNote(inner, index);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

export interface TreeView {
  el: HTMLElement;
  /** Marks the note that is open, and opens the folders above it */
  show(id: string): void;
}

/**
 * Draws the tree with the classes of the file explorer of Obsidian, so that
 * it gets its look. The rows of a folder are made when the folder is opened
 * for the first time: a site of thousands of notes starts with the few rows
 * that are seen.
 */
export function treeView(root: Folder, index: SiteIndex, triangle: string, open: Set<string>, onToggle: () => void): TreeView {
  const rows = new Map<string, HTMLElement>();
  /** For every folder: its element, the place of its rows, and whether they were made */
  const drawn = new Map<string, { item: HTMLElement; children: HTMLElement; folder: Folder; isMade: boolean }>();

  const setOpen = (path: string, isOpen: boolean): void => {
    const entry = drawn.get(path);
    if (entry === undefined) {
      return;
    }
    if (isOpen && !entry.isMade) {
      fill(entry.children, entry.folder);
      entry.isMade = true;
    }
    entry.item.classList.toggle("is-collapsed", !isOpen);
    entry.item.querySelector(":scope > .tree-item-self > .collapse-icon")?.classList.toggle("is-collapsed", !isOpen);
    if (isOpen) {
      open.add(path);
    } else {
      open.delete(path);
    }
  };

  const fill = (children: HTMLElement, folder: Folder): void => {
    for (const inner of folder.folders) {
      const icon = el("div", { cls: "tree-item-icon collapse-icon is-collapsed" });
      icon.innerHTML = triangle;
      const title = el("div", { cls: "tree-item-self nav-folder-title is-clickable mod-collapsible" }, [
        icon,
        el("div", { cls: "tree-item-inner nav-folder-title-content", text: inner.name }),
      ]);
      const innerChildren = el("div", { cls: "tree-item-children nav-folder-children" });
      const item = el("div", { cls: "tree-item nav-folder is-collapsed" }, [title, innerChildren]);
      drawn.set(inner.path, { item, children: innerChildren, folder: inner, isMade: false });
      title.addEventListener("click", () => {
        setOpen(inner.path, item.classList.contains("is-collapsed"));
        onToggle();
      });
      children.appendChild(item);
      if (open.has(inner.path)) {
        setOpen(inner.path, true);
      }
    }
    for (const file of folder.items) {
      const row = el("a", { cls: "tree-item-self nav-file-title is-clickable", attr: { href: "#/" + file.id } }, [
        el("div", { cls: "tree-item-inner nav-file-title-content", text: file.name }),
        file.tag === "" ? null : el("div", { cls: "nav-file-tag", text: file.tag }),
      ]);
      rows.set(file.id, row);
      children.appendChild(el("div", { cls: "tree-item nav-file" }, [row]));
    }
  };

  const top = el("div", { cls: "tree-item-children nav-folder-children" });
  fill(top, root);
  const container = el("div", { cls: "nav-files-container node-insert-event" }, [top]);
  let active: HTMLElement | null = null;
  return {
    el: container,
    show(id) {
      active?.classList.remove("is-active");
      // The folders above the note, from the root down: each is opened, which makes its rows
      const path = index.notes[id]?.p ?? index.files[id]?.p ?? "";
      const parts = path.split("/").slice(0, -1);
      for (let depth = 1; depth <= parts.length; depth++) {
        setOpen(parts.slice(0, depth).join("/"), true);
      }
      active = rows.get(id) ?? null;
      if (active !== null) {
        active.classList.add("is-active");
        active.scrollIntoView({ block: "nearest" });
      }
      onToggle();
    },
  };
}
