import { Plugin } from "obsidian";
import { renameTicks } from "./select/ticks.ts";
import { readSettings, type Settings, DEFAULT_SETTINGS } from "./settings.ts";
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

    // What is ticked is kept by path. A folder or note that gets another name keeps its tick, or its lack of one.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const ticks = renameTicks(this.config.ticks, oldPath, file.path);
        if (JSON.stringify(ticks) !== JSON.stringify(this.config.ticks)) {
          this.config.ticks = ticks;
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
