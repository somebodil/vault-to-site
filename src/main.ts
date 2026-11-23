import { normalizePath, Plugin } from "obsidian";
import { followRename, readSettings, type Settings, DEFAULT_SETTINGS } from "./settings.ts";
import { BuildModal } from "./ui/build-modal.ts";

const ICON = "book-open-check";

export default class VaultToSitePlugin extends Plugin {
  private readonly config: Settings = { ...DEFAULT_SETTINGS };
  /** The dialog that is open, or was open last */
  private dialog: BuildModal | null = null;

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
        const next = followRename(this.config, oldPath, file.path, normalizePath);
        if (JSON.stringify(next) !== JSON.stringify(this.config)) {
          Object.assign(this.config, next);
          void this.saveData(this.config);
        }
      }),
    );
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
