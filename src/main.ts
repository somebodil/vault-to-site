import { Plugin } from "obsidian";
import { readSettings, type Settings, DEFAULT_SETTINGS } from "./settings.ts";
import { BuildModal } from "./ui/build-modal.ts";

const ICON = "book-open-check";

export default class VaultToSitePlugin extends Plugin {
  private readonly config: Settings = { ...DEFAULT_SETTINGS };

  override async onload(): Promise<void> {
    await this.readData();

    const open = (): void => {
      new BuildModal(this.app, {
        settings: this.config,
        version: this.manifest.version,
        save: () => this.saveData(this.config),
      }).open();
    };
    this.addCommand({ id: "build", name: "Build a site", icon: ICON, callback: open });
    this.addRibbonIcon(ICON, "Build a site", open);
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
