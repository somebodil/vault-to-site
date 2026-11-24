import { normalizePath, Plugin, TFolder } from "obsidian";
import { isAtOrUnder } from "./select/ticks.ts";
import { followDelete, followRename, readSettings, type Settings, DEFAULT_SETTINGS } from "./settings.ts";
import { buildForProgram } from "./build/program.ts";
import { BuildModal } from "./ui/build-modal.ts";

const ICON = "book-open-check";

export default class VaultToSitePlugin extends Plugin {
  private readonly config: Settings = { ...DEFAULT_SETTINGS };
  /** The dialog that is open, or was open last */
  private dialog: BuildModal | null = null;
  /** The paths that something was deleted from since the plugin was turned on, and that are still empty */
  private readonly gone = new Set<string>();
  /** Stops a build a program has started, which has no dialog to stop it from. Set when the plugin is turned off. */
  private readonly stop = { now: false };

  override async onload(): Promise<void> {
    await this.readData();

    const open = (): void => {
      this.dialog?.close();
      this.dialog = new BuildModal(this.app, {
        settings: this.config,
        version: this.manifest.version,
        save: () => this.saveData(this.config),
      });
      this.dialog.open();
    };
    // A program that runs the command has nobody to look at a dialog: the site is built at once, with the settings the run is given
    const build = (): void =>
      void buildForProgram(this.app, this.config, this.manifest.version, this.stop).then((built) => {
        if (!built) {
          open();
        }
      });
    this.addCommand({ id: "build", name: "Build a site", icon: ICON, callback: build });
    this.addRibbonIcon(ICON, "Build a site", open);

    // What is ticked and what was written is kept by path. A folder or file that gets another name is followed.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const next = followRename(this.config, oldPath, file.path, this.gone.has(file.path), normalizePath);
        // What has come to a path makes it one that is not empty any more. Only a folder covers other paths.
        this.gone.delete(file.path);
        if (file instanceof TFolder) {
          for (const path of [...this.gone]) {
            if (isAtOrUnder(path, file.path)) {
              this.gone.delete(path);
            }
          }
        }
        // The same object when nothing has changed: Obsidian tells of every file in a folder that is moved
        if (next !== this.config) {
          Object.assign(this.config, next);
          void this.saveData(this.config);
        }
      }),
    );
    // A path that something was deleted from, until something is made there again: a sync deletes a
    // note and makes it again, and its tick is still meant for it. What is renamed onto such a path is another thing.
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.gone.add(file.path);
        // What a build wrote and is deleted is the plugin's no longer: the path may be a folder of notes later
        const next = followDelete(this.config, file.path);
        if (next !== this.config) {
          Object.assign(this.config, next);
          void this.saveData(this.config);
        }
      }),
    );
    this.registerEvent(this.app.vault.on("create", (file) => this.gone.delete(file.path)));
  }

  /**
   * Closing the dialog stops a build that runs, and so does the flag of a
   * build without the dialog: nothing of the plugin goes on working after
   * it is turned off. A plugin that is turned on again could else start a
   * second build that writes to the same place.
   */
  override onunload(): void {
    this.dialog?.close();
    this.dialog = null;
    this.stop.now = true;
  }

  /** Called by Obsidian when data.json is changed by something else: a sync, a version control tool, an editor */
  override async onExternalSettingsChange(): Promise<void> {
    await this.readData();
  }

  private async readData(): Promise<void> {
    const saved: unknown = await this.loadData();
    if (saved === undefined) {
      // The file is there but cannot be read, as when it is caught half written
      return;
    }
    // The same object stays in use, so that an open dialog sees the new values
    Object.assign(this.config, readSettings(saved));
  }
}
