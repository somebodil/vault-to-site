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

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

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

/** Draws the tree with the classes of the file explorer of Obsidian, so that it gets its look */
export function treeView(root: Folder, triangle: string, open: Set<string>, onToggle: () => void): TreeView {
  const rows = new Map<string, HTMLElement>();
  const folderEls = new Map<string, HTMLElement>();
  const parents = new Map<string, string[]>();

  const setOpen = (folder: HTMLElement, isOpen: boolean): void => {
    folder.classList.toggle("is-collapsed", !isOpen);
    folder.querySelector(":scope > .tree-item-self > .collapse-icon")?.classList.toggle("is-collapsed", !isOpen);
  };

  const draw = (folder: Folder, above: string[]): HTMLElement => {
    const children = el("div", { cls: "tree-item-children nav-folder-children" });
    for (const inner of folder.folders) {
      const icon = el("div", { cls: "tree-item-icon collapse-icon" });
      icon.innerHTML = triangle;
      const title = el("div", { cls: "tree-item-self nav-folder-title is-clickable mod-collapsible" }, [
        icon,
        el("div", { cls: "tree-item-inner nav-folder-title-content", text: inner.name }),
      ]);
      const item = el("div", { cls: "tree-item nav-folder" }, [title, draw(inner, [...above, inner.path])]);
      setOpen(item, open.has(inner.path));
      title.addEventListener("click", () => {
        const isOpen = item.classList.contains("is-collapsed");
        setOpen(item, isOpen);
        if (isOpen) {
          open.add(inner.path);
        } else {
          open.delete(inner.path);
        }
        onToggle();
      });
      folderEls.set(inner.path, item);
      children.appendChild(item);
    }
    for (const file of folder.items) {
      const row = el("a", { cls: "tree-item-self nav-file-title is-clickable", attr: { href: "#/" + file.id } }, [
        el("div", { cls: "tree-item-inner nav-file-title-content", text: file.name }),
        file.tag === "" ? null : el("div", { cls: "nav-file-tag", text: file.tag }),
      ]);
      rows.set(file.id, row);
      parents.set(file.id, above);
      children.appendChild(el("div", { cls: "tree-item nav-file" }, [row]));
    }
    return children;
  };

  const container = el("div", { cls: "nav-files-container node-insert-event" }, [draw(root, [])]);
  let active: HTMLElement | null = null;
  return {
    el: container,
    show(id) {
      active?.classList.remove("is-active");
      active = rows.get(id) ?? null;
      if (active === null) {
        return;
      }
      active.classList.add("is-active");
      for (const path of parents.get(id) ?? []) {
        const folder = folderEls.get(path);
        if (folder !== undefined) {
          setOpen(folder, true);
          open.add(path);
        }
      }
      onToggle();
      active.scrollIntoView({ block: "nearest" });
    },
  };
}
