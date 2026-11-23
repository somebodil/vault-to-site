import { normalizePath, Plugin } from "obsidian";
import { isAtOrUnder } from "./select/ticks.ts";
import { followRename, readSettings, type Settings, DEFAULT_SETTINGS } from "./settings.ts";
import { BuildModal } from "./ui/build-modal.ts";

const ICON = "book-open-check";

export default class VaultToSitePlugin extends Plugin {
  private readonly config: Settings = { ...DEFAULT_SETTINGS };
  /** The dialog that is open, or was open last */
  private dialog: BuildModal | null = null;
  /** The paths that something was deleted from since the plugin was turned on, and that are still empty */
  private readonly gone = new Set<string>();

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
    this.addCommand({ id: "build", name: "Build a site", icon: ICON, callback: open });
    this.addRibbonIcon(ICON, "Build a site", open);

    // What is ticked and what was written is kept by path. A folder or file that gets another name is followed.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const next = followRename(this.config, oldPath, file.path, this.gone.has(file.path), normalizePath);
        for (const path of [...this.gone]) {
          if (isAtOrUnder(path, file.path)) {
            this.gone.delete(path);
          }
        }
        if (JSON.stringify(next) !== JSON.stringify(this.config)) {
          Object.assign(this.config, next);
          void this.saveData(this.config);
        }
      }),
    );
    // A path that something was deleted from, until something is made there again: a sync deletes a
    // note and makes it again, and its tick is still meant for it. What is renamed onto such a path is another thing.
    this.registerEvent(this.app.vault.on("delete", (file) => this.gone.add(file.path)));
    this.registerEvent(this.app.vault.on("create", (file) => this.gone.delete(file.path)));
  }

  /** Closing the dialog stops a build that runs: nothing of the plugin goes on working after it is turned off */
  override onunload(): void {
    this.dialog?.close();
    this.dialog = null;
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
