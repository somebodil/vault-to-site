import { type App, Modal, normalizePath, Platform, Setting } from "obsidian";
import { zipPath } from "../build/output.ts";
import { planSite, readVault } from "../build/plan.ts";
import { BuildStopped, buildSite } from "../build/site.ts";
import { signatureOf, type Choice, type VaultFile } from "../select/choose.ts";
import { parseExcludeRules } from "../select/exclude.ts";
import { missingTicks, parentOf, setTick, ticker } from "../select/ticks.ts";
import type { Settings } from "../settings.ts";

/** What the dialog needs of the plugin */
export interface BuildHost {
  settings: Settings;
  version: string;
  save(): Promise<void>;
}

interface Folder {
  path: string;
  name: string;
  folders: Folder[];
  files: string[];
  /** How many files are inside, however deep */
  total: number;
}

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * The dialog a site is built from. It has three steps: choosing what goes in,
 * looking over what a build would hold, and the build itself. The second step
 * is there so that nothing gets into a site unseen: it lists every note, and
 * what was kept out and why.
 */
export class BuildModal extends Modal {
  private readonly host: BuildHost;
  /** The folders that are open in the tree */
  private readonly openFolders = new Set<string>([""]);
  private stop = { now: false };
  private building = false;

  constructor(app: App, host: BuildHost) {
    super(app);
    this.host = host;
  }

  override onOpen(): void {
    this.modalEl.addClass("vault-to-site-modal");
    this.showChoose();
  }

  override onClose(): void {
    this.stop.now = true;
    this.contentEl.empty();
  }

  private get settings(): Settings {
    return this.host.settings;
  }

  private change(change: (settings: Settings) => void): void {
    change(this.settings);
    void this.host.save();
  }

  // ---- Step 1: what goes in ----

  private showChoose(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Build a site");
    contentEl.createEl("p", {
      cls: "vault-to-site-lead",
      text: "Tick the folders and notes that go into the site. Pictures and other files that a ticked note uses come along.",
    });

    let files: VaultFile[] = [];
    let root: Folder = toTree([]);
    /** Ticked paths that a rule keeps out, with the rule */
    let keptOut = new Map<string, string>();
    const summary = contentEl.createDiv({ cls: "vault-to-site-summary" });
    const treeEl = contentEl.createDiv({ cls: "vault-to-site-tree" });
    let review: { setDisabled(disabled: boolean): unknown } | null = null;

    /** Works out what a build would hold, and says it above the tree */
    const plan = (): void => {
      const { choice, hasInvalidPattern } = planSite(this.app, this.settings, files);
      keptOut = new Map<string, string>([
        ...choice.withNotes.map((path): [string, string] => [path, "its notes are out"]),
        ...choice.unread.map((x): [string, string] => [x.path, "not read"]),
        ...choice.undrawn.map((path): [string, string] => [path, "cannot be drawn"]),
        ...choice.byPattern.map((path): [string, string] => [path, "pattern"]),
        ...choice.byProperty.map((x): [string, string] => [x.path, `${x.rule.key}: ${x.rule.value}`]),
      ]);
      summary.empty();
      summary.createSpan({ text: `${count(choice.notes.length, "note")} and ${count(choice.files.length, "other file")} go in.` });
      if (keptOut.size > 0) {
        summary.createSpan({ cls: "vault-to-site-muted", text: ` ${String(keptOut.size)} kept out by a rule.` });
      }
      if (hasInvalidPattern) {
        // A pattern that does not work keeps nothing out, and what it was written for would go in
        summary.createDiv({ cls: "vault-to-site-warning", text: "A pattern is not a valid regular expression. Correct it or take it out: a site is not built with a rule that does not work." });
      }
      const gone = this.goneLeftOut();
      if (gone.length > 0) {
        summary.createDiv({ cls: "vault-to-site-warning", text: goneWarning(gone) });
      }
      review?.setDisabled(hasInvalidPattern || choice.notes.length + choice.files.length === 0);
    };

    const drawTree = (): void => {
      const isTicked = ticker(this.settings.ticks);
      // How many files are ticked inside each folder, in one pass over the files
      const ticked = new Map<string, number>();
      for (const file of files) {
        if (!isTicked(file.path)) {
          continue;
        }
        for (let at = parentOf(file.path); at !== null; at = parentOf(at)) {
          ticked.set(at, (ticked.get(at) ?? 0) + 1);
        }
      }
      const stateOf = (folder: Folder): "on" | "off" | "some" => {
        const n = ticked.get(folder.path) ?? 0;
        if (folder.total === 0) {
          return isTicked(folder.path) ? "on" : "off";
        }
        return n === 0 ? "off" : n === folder.total ? "on" : "some";
      };

      const scroll = treeEl.scrollTop;
      treeEl.empty();
      const row = (parent: HTMLElement, path: string, name: string, state: "on" | "off" | "some", folder: Folder | null): HTMLElement => {
        const line = parent.createDiv({ cls: "vault-to-site-row" });
        const arrow = line.createSpan({ cls: "vault-to-site-arrow" });
        const label = line.createEl("label", { cls: "vault-to-site-label" });
        const box = label.createEl("input", { type: "checkbox" });
        box.checked = state === "on";
        box.indeterminate = state === "some";
        box.toggleClass("is-some", state === "some");
        box.addEventListener("change", () => {
          this.change((settings) => {
            settings.ticks = setTick(settings.ticks, path, state !== "on");
          });
          plan();
          drawTree();
        });
        label.createSpan({ cls: folder !== null ? "vault-to-site-folder-name" : "vault-to-site-file-name", text: name });
        if (folder === null) {
          const rule = state === "on" ? keptOut.get(path) : undefined;
          if (rule !== undefined) {
            line.addClass("is-kept-out");
            line.createSpan({ cls: "vault-to-site-count", text: rule });
          }
          return line;
        }
        const toggle = (): void => {
          if (this.openFolders.has(path)) {
            this.openFolders.delete(path);
          } else {
            this.openFolders.add(path);
          }
          drawTree();
        };
        arrow.setText(this.openFolders.has(path) ? "▾" : "▸");
        arrow.addClass("is-folder");
        arrow.addEventListener("click", toggle);
        line
          .createSpan({ cls: "vault-to-site-count", text: `${String(ticked.get(path) ?? 0)} / ${String(folder.total)}` })
          .addEventListener("click", toggle);
        return line;
      };
      const draw = (parent: HTMLElement, folder: Folder): void => {
        for (const inner of folder.folders) {
          row(parent, inner.path, inner.name, stateOf(inner), inner);
          if (this.openFolders.has(inner.path)) {
            draw(parent.createDiv({ cls: "vault-to-site-children" }), inner);
          }
        }
        for (const file of folder.files) {
          row(parent, file, nameOf(file), isTicked(file) ? "on" : "off", null);
        }
      };
      row(treeEl, "", this.app.vault.getName(), stateOf(root), root).addClass("is-root");
      if (this.openFolders.has("")) {
        draw(treeEl.createDiv({ cls: "vault-to-site-children" }), root);
      }
      treeEl.scrollTop = scroll;
    };

    /** After typing: the vault is worked through once the keys have stopped, not at each of them */
    let typing = 0;
    const afterTyping = (): void => {
      window.clearTimeout(typing);
      typing = window.setTimeout(() => {
        plan();
        drawTree();
      }, 150);
    };

    /** Reads the files of the vault again: what a build writes is not among them, so they change with where it writes */
    const readFiles = (): void => {
      files = readVault(this.app, this.settings);
      root = toTree(files.map((file) => file.path));
      plan();
      drawTree();
    };

    new Setting(contentEl)
      .setName("Leave out by path")
      .setDesc("Regular expressions, separated by commas. A path that one of them matches stays out, ticked or not.")
      .addText((text) => {
        text.setPlaceholder("^Archive/, \\.pdf$").setValue(this.settings.exclude);
        const mark = (): void => {
          text.inputEl.toggleClass("vault-to-site-invalid", parseExcludeRules(text.getValue()).hasInvalid);
        };
        mark();
        text.onChange((value) => {
          this.change((settings) => {
            settings.exclude = value;
          });
          mark();
          afterTyping();
        });
      });

    new Setting(contentEl)
      .setName("Leave out by property")
      .setDesc("One property a line, as key: value. A note that has one of them stays out, ticked or not.")
      .addTextArea((area) => {
        area.setValue(this.settings.properties);
        area.inputEl.rows = 3;
        area.onChange((value) => {
          this.change((settings) => {
            settings.properties = value;
          });
          afterTyping();
        });
      });

    const place = new Setting(contentEl);
    const drawPlace = (): void => {
      const isZip = this.settings.format === "zip";
      place.clear();
      place
        .setName("Written as")
        .setDesc(
          isZip
            ? "One zip archive, from the root of the vault. Unpack it to read the site. A build writes over the archive of the build before."
            : "A folder, from the root of the vault. A build empties this folder first.",
        )
        .addDropdown((dropdown) => {
          dropdown
            .addOption("zip", "Zip archive")
            .addOption("folder", "Folder")
            .setValue(this.settings.format)
            .onChange((value) => {
              this.change((settings) => {
                settings.format = value === "folder" ? "folder" : "zip";
              });
              drawPlace();
              readFiles();
            });
        })
        .addText((text) => {
          text.setValue(isZip ? this.settings.zip : this.settings.folder);
          text.onChange((value) => {
            this.change((settings) => {
              if (isZip) {
                settings.zip = value.trim();
              } else {
                settings.folder = value.trim();
              }
            });
          });
          // When the typing is over: the files of the vault are read again without what the build writes
          text.inputEl.addEventListener("blur", readFiles);
        });
    };
    drawPlace();

    new Setting(contentEl).addButton((button) => {
      review = button;
      button
        .setButtonText("Look over")
        .setCta()
        .onClick(() => {
          window.clearTimeout(typing);
          this.showReview();
        });
    });

    readFiles();
  }

  /** The paths that were left out of a ticked folder and are not in the vault any more */
  private goneLeftOut(): string[] {
    return missingTicks(this.settings.ticks, (path) => this.app.vault.getAbstractFileByPath(path) !== null).off;
  }

  // ---- Step 2: what a build would hold ----

  private showReview(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Look over the site");
    const { choice, hasInvalidPattern } = planSite(this.app, this.settings);
    if (hasInvalidPattern) {
      this.showChoose();
      return;
    }
    const place =
      this.settings.format === "zip" ? `the archive "${zipPath(normalizePath(this.settings.zip))}"` : `the folder "${normalizePath(this.settings.folder)}"`;

    contentEl.createEl("p", {
      cls: "vault-to-site-lead",
      text: `${count(choice.notes.length, "note")} and ${count(choice.files.length, "other file")} will be written to ${place}. Nothing else of the vault goes into the site.`,
    });

    // Said again here, right above the list it is about
    const gone = this.goneLeftOut();
    if (gone.length > 0) {
      contentEl.createEl("p", { cls: "vault-to-site-warning", text: goneWarning(gone) });
    }

    const list = (title: string, lines: string[], isOpen: boolean, note?: string): void => {
      const details = contentEl.createEl("details", { cls: "vault-to-site-details" });
      details.open = isOpen;
      details.createEl("summary", { text: `${title} (${String(lines.length)})` });
      if (note !== undefined) {
        details.createEl("p", { cls: "vault-to-site-muted", text: note });
      }
      const body = details.createDiv({ cls: "vault-to-site-list" });
      for (const line of lines) {
        body.createDiv({ text: line });
      }
    };

    list("Notes in the site", choice.notes, true);
    const pulled = new Set(choice.pulledIn);
    list(
      "Other files in the site",
      choice.files.map((path) => (pulled.has(path) ? path + "  (used by a note)" : path)),
      false,
    );
    if (choice.byProperty.length > 0) {
      list(
        "Kept out by a property",
        choice.byProperty.map((x) => `${x.path}  (${x.rule.key}: ${x.rule.value})`),
        true,
      );
    }
    if (choice.byPattern.length > 0) {
      list("Kept out by a pattern", choice.byPattern, false);
    }
    if (choice.unread.length > 0) {
      list(
        "Kept out because their properties are not known",
        choice.unread.map((x) => `${x.path}  (${x.why})`),
        true,
        "A rule may be meant for these notes, and it cannot be checked. A note that Obsidian has not read yet is read a moment later: go back and look again. Properties that cannot be read have a mistake in them.",
      );
    }
    if (choice.undrawn.length > 0) {
      list(
        "Kept out because the site cannot draw them",
        choice.undrawn,
        false,
        "A canvas or a base is drawn by Obsidian from what is in it. As a plain file it would only carry the paths and the text it holds.",
      );
    }
    if (choice.withNotes.length > 0) {
      list(
        "Kept out with the notes that use them",
        choice.withNotes,
        false,
        "These files are ticked, but only notes that are not in the site use them. So they stay out too.",
      );
    }
    if (choice.cut.length > 0) {
      list(
        "Links and embeds that are cut",
        cutLines(choice),
        true,
        "These notes of the site point to something that is not in it. An embed is emptied and a link leads nowhere. The words of a link stay as the note shows them.",
      );
    }

    contentEl.createEl("p", {
      cls: "vault-to-site-muted",
      text: "The site looks like this Obsidian because it holds a copy of the style sheets that are loaded here: those of Obsidian, of the theme, of the snippets and of the plugins. They belong to their authors. Keep that in mind before putting a site where everyone can see it.",
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Back").onClick(() => this.showChoose()))
      .addButton((button) =>
        button
          .setButtonText("Build")
          .setCta()
          .setDisabled(choice.notes.length + choice.files.length === 0)
          .onClick(() => void this.showBuild(signatureOf(choice))),
      );
  }

  // ---- Step 3: the build ----

  /** @param reviewed the sign of what was looked over: the build is that, or it is not done */
  private async showBuild(reviewed: string): Promise<void> {
    if (this.building) {
      return;
    }
    this.building = true;
    this.stop = { now: false };
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Building the site");
    const bar = contentEl.createEl("progress", { cls: "vault-to-site-progress" });
    bar.max = 1;
    bar.value = 0;
    const label = contentEl.createDiv({ cls: "vault-to-site-muted vault-to-site-label-line" });
    const buttons = new Setting(contentEl).addButton((button) =>
      button.setButtonText("Stop").onClick(() => {
        this.stop.now = true;
        button.setDisabled(true);
      }),
    );

    const done = (title: string, lines: string[], archive?: string): void => {
      this.building = false;
      this.setTitle(title);
      bar.remove();
      label.removeClass("vault-to-site-muted");
      label.empty();
      for (const line of lines) {
        label.createEl("p", { text: line });
      }
      buttons.clear();
      // Not part of the public API, so it is used only where it is there. On a phone it opens the sheet to share the file.
      const opener = (this.app as unknown as { openWithDefaultApp?: (path: string) => unknown }).openWithDefaultApp;
      if (archive !== undefined && typeof opener === "function") {
        buttons.addButton((button) =>
          button.setButtonText(Platform.isMobile ? "Share or open" : "Open the archive").onClick(() => {
            opener.call(this.app, archive);
          }),
        );
      }
      buttons
        .addButton((button) => button.setButtonText("Back").onClick(() => this.showChoose()))
        .addButton((button) =>
          button
            .setButtonText("Close")
            .setCta()
            .onClick(() => this.close()),
        );
    };

    // A phone that turns its screen off stops the app, and the build with it
    const awake = await keepAwake();
    try {
      const result = await buildSite(
        this.app,
        this.settings,
        this.host.version,
        reviewed,
        (finished, total, what) => {
          bar.max = total;
          bar.value = finished;
          label.setText(what === "" ? "" : `${String(Math.min(finished + 1, total))} of ${String(total)}: ${what}`);
        },
        this.stop,
      );
      const lines = [
        `${count(result.notes, "note")} and ${count(result.files, "other file")}, ${size(result.bytes)}, in ${(result.millis / 1000).toFixed(1)} seconds.`,
        this.settings.format === "zip"
          ? `The site is the archive "${result.place}" in the vault. Unpack it and open index.html with a browser.`
          : `The site is the folder "${result.place}" in the vault. Open index.html in it with a browser.`,
      ];
      // What a build wrote is never content of a later site, also after the name in the setting has changed
      if (!this.settings.written.includes(result.place)) {
        this.change((settings) => {
          settings.written = [...settings.written, result.place];
        });
      }
      if (result.unfinished.length > 0) {
        lines.push(`${count(result.unfinished.length, "note")} had a part that did not arrive in time, and went in without it: ${result.unfinished.join(", ")}`);
      }
      if (result.failed.length > 0) {
        lines.push(`${count(result.failed.length, "note")} could not be drawn, and the site says so in their place: ${result.failed.map((x) => x.path).join(", ")}`);
      }
      if (result.mentions.length > 0) {
        lines.push(
          `${count(result.mentions.length, "note")} that a rule is meant for ${result.mentions.length === 1 ? "has its" : "have their"} name on a page of the site. A name gets there with the words of a link, with a sentence, or with what another plugin lists:`,
          ...result.mentions.map((x) => `${x.path}  in  ${x.shownIn.join(", ")}`),
        );
      }
      done("The site is built", lines, this.settings.format === "zip" ? result.place : undefined);
    } catch (error) {
      if (error instanceof BuildStopped) {
        done("The build was stopped", ["No site was finished. Build again to have one."]);
      } else {
        console.error(error);
        done("The site could not be built", [error instanceof Error ? error.message : String(error)]);
      }
    } finally {
      void awake?.release().catch(() => undefined);
    }
  }
}

/** Asks the device to keep its screen on. Null where it cannot be asked or says no. */
async function keepAwake(): Promise<WakeLockSentinel | null> {
  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    return null;
  }
}

function goneWarning(gone: string[]): string {
  return `Left out before, and no longer in the vault: ${gone.join(", ")}. If one of them was renamed outside Obsidian, as by a sync, it is ticked again under its new name. Look at the list.`;
}

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** One line for each note that points outside the site, with what it points to */
function cutLines(choice: Choice): string[] {
  const byNote = new Map<string, string[]>();
  for (const { from, to } of choice.cut) {
    byNote.set(from, [...(byNote.get(from) ?? []), to]);
  }
  return [...byNote].map(([from, to]) => `${from}  →  ${to.join(", ")}`);
}

/** The folders of the vault, made from the paths of its files */
function toTree(paths: readonly string[]): Folder {
  const root: Folder = { path: "", name: "", folders: [], files: [], total: 0 };
  const folders = new Map<string, Folder>([["", root]]);
  const folderOf = (path: string): Folder => {
    const known = folders.get(path);
    if (known !== undefined) {
      return known;
    }
    const folder: Folder = { path, name: nameOf(path), folders: [], files: [], total: 0 };
    folders.set(path, folder);
    folderOf(parentOf(path) ?? "").folders.push(folder);
    return folder;
  };
  for (const path of paths) {
    folderOf(parentOf(path) ?? "").files.push(path);
    for (let at = parentOf(path); at !== null; at = parentOf(at)) {
      folderOf(at).total++;
    }
  }
  for (const folder of folders.values()) {
    folder.folders.sort((a, b) => byName(a.name, b.name));
    folder.files.sort((a, b) => byName(nameOf(a), nameOf(b)));
  }
  return root;
}
