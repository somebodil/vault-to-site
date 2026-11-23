import { type App, Modal, Setting } from "obsidian";
import { planSite, readVault } from "../build/plan.ts";
import { BuildStopped, buildSite } from "../build/site.ts";
import type { Choice } from "../select/choose.ts";
import { parseExcludeRules } from "../select/exclude.ts";
import { folderState, isAtOrUnder, parentOf, setTick, ticker } from "../select/ticks.ts";
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
  /** Every file inside, however deep */
  all: string[];
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

    const files = readVault(this.app, this.settings.output).map((file) => file.path);
    const root = toTree(files);
    const summary = contentEl.createDiv({ cls: "vault-to-site-summary" });
    const treeEl = contentEl.createDiv({ cls: "vault-to-site-tree" });

    const drawSummary = (): void => {
      const { choice, hasInvalidPattern } = planSite(this.app, this.settings);
      summary.empty();
      summary.createSpan({ text: `${count(choice.notes.length, "note")} and ${count(choice.files.length, "other file")} go in.` });
      const out = choice.byProperty.length + choice.byPattern.length;
      if (out > 0) {
        summary.createSpan({ cls: "vault-to-site-muted", text: ` ${String(out)} kept out by a rule.` });
      }
      if (hasInvalidPattern) {
        summary.createSpan({ cls: "vault-to-site-warning", text: " A pattern is not a valid regular expression and is not used." });
      }
      review.setDisabled(choice.notes.length + choice.files.length === 0);
    };

    const drawTree = (): void => {
      const isTicked = ticker(this.settings.ticks);
      const scroll = treeEl.scrollTop;
      treeEl.empty();
      const row = (parent: HTMLElement, path: string, name: string, state: "on" | "off" | "some", folder: Folder | null): HTMLElement => {
        const line = parent.createDiv({ cls: "vault-to-site-row" });
        const arrow = line.createSpan({ cls: "vault-to-site-arrow" });
        if (folder !== null) {
          arrow.setText(this.openFolders.has(path) ? "▾" : "▸");
          arrow.addClass("is-folder");
        }
        const label = line.createEl("label", { cls: "vault-to-site-label" });
        const box = label.createEl("input", { type: "checkbox" });
        box.checked = state === "on";
        box.indeterminate = state === "some";
        box.addEventListener("change", () => {
          this.change((settings) => {
            settings.ticks = setTick(settings.ticks, path, state !== "on");
          });
          drawTree();
          drawSummary();
        });
        label.createSpan({ cls: folder !== null ? "vault-to-site-folder-name" : "vault-to-site-file-name", text: name });
        if (folder !== null) {
          const ticked = folder.all.filter(isTicked).length;
          line.createSpan({ cls: "vault-to-site-count", text: `${String(ticked)} / ${String(folder.all.length)}` });
          const toggle = (): void => {
            if (this.openFolders.has(path)) {
              this.openFolders.delete(path);
            } else {
              this.openFolders.add(path);
            }
            drawTree();
          };
          arrow.addEventListener("click", toggle);
          line.querySelector(".vault-to-site-count")?.addEventListener("click", toggle);
        }
        return line;
      };
      const draw = (parent: HTMLElement, folder: Folder): void => {
        for (const inner of folder.folders) {
          row(parent, inner.path, inner.name, folderState(inner.all, isTicked, isTicked(inner.path)), inner);
          if (this.openFolders.has(inner.path)) {
            draw(parent.createDiv({ cls: "vault-to-site-children" }), inner);
          }
        }
        for (const file of folder.files) {
          row(parent, file, nameOf(file), isTicked(file) ? "on" : "off", null);
        }
      };
      row(treeEl, "", this.app.vault.getName(), folderState(root.all, isTicked, isTicked("")), root).addClass("is-root");
      if (this.openFolders.has("")) {
        draw(treeEl.createDiv({ cls: "vault-to-site-children" }), root);
      }
      treeEl.scrollTop = scroll;
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
          drawSummary();
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
          drawSummary();
        });
      });

    new Setting(contentEl)
      .setName("Folder of the site")
      .setDesc("Where the site is written, from the root of the vault. A build empties this folder first.")
      .addText((text) => {
        text.setValue(this.settings.output);
        text.onChange((value) => {
          this.change((settings) => {
            settings.output = value.trim();
          });
        });
      });

    let review!: { setDisabled(disabled: boolean): unknown };
    new Setting(contentEl).addButton((button) => {
      review = button;
      button
        .setButtonText("Look over")
        .setCta()
        .onClick(() => this.showReview());
    });

    drawTree();
    drawSummary();
  }

  // ---- Step 2: what a build would hold ----

  private showReview(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Look over the site");
    const { choice } = planSite(this.app, this.settings);
    const folder = this.settings.output === "" ? ".vault-to-site" : this.settings.output;

    contentEl.createEl("p", {
      cls: "vault-to-site-lead",
      text: `${count(choice.notes.length, "note")} and ${count(choice.files.length, "other file")} will be written to the folder "${folder}". Nothing else of the vault goes into the site.`,
    });

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
    if (choice.cut.length > 0) {
      list(
        "Links and embeds that are cut",
        cutLines(choice),
        true,
        "These notes of the site point to something that is not in it. An embed is emptied and a link leads nowhere, but the words of a link stay as they are written in the note.",
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
          .onClick(() => void this.showBuild()),
      );
  }

  // ---- Step 3: the build ----

  private async showBuild(): Promise<void> {
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

    const done = (title: string, text: string): void => {
      this.building = false;
      this.setTitle(title);
      bar.remove();
      label.removeClass("vault-to-site-muted");
      label.setText(text);
      buttons.clear();
      buttons
        .addButton((button) => button.setButtonText("Back").onClick(() => this.showChoose()))
        .addButton((button) =>
          button
            .setButtonText("Close")
            .setCta()
            .onClick(() => this.close()),
        );
    };

    try {
      const result = await buildSite(
        this.app,
        this.settings,
        this.host.version,
        (finished, total, what) => {
          bar.max = total;
          bar.value = finished;
          label.setText(what === "" ? "" : `${String(finished + 1)} of ${String(total)}: ${what}`);
        },
        this.stop,
      );
      done(
        "The site is built",
        `${count(result.notes, "note")} and ${count(result.files, "other file")} in ${(result.millis / 1000).toFixed(1)} seconds. Open index.html in the folder "${result.folder}" of the vault with a browser.`,
      );
    } catch (error) {
      if (error instanceof BuildStopped) {
        done("The build was stopped", "The folder of the site holds an unfinished build. Build again to finish it.");
      } else {
        console.error(error);
        done("The site could not be built", error instanceof Error ? error.message : String(error));
      }
    }
  }
}

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
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
  const root: Folder = { path: "", name: "", folders: [], files: [], all: [] };
  const folders = new Map<string, Folder>([["", root]]);
  const folderOf = (path: string): Folder => {
    const known = folders.get(path);
    if (known !== undefined) {
      return known;
    }
    const folder: Folder = { path, name: nameOf(path), folders: [], files: [], all: [] };
    folders.set(path, folder);
    folderOf(parentOf(path) ?? "").folders.push(folder);
    return folder;
  };
  for (const path of paths) {
    folderOf(parentOf(path) ?? "").files.push(path);
  }
  for (const folder of folders.values()) {
    folder.folders.sort((a, b) => byName(a.name, b.name));
    folder.files.sort((a, b) => byName(nameOf(a), nameOf(b)));
    folder.all = paths.filter((path) => isAtOrUnder(path, folder.path));
  }
  return root;
}
