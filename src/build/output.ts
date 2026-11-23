import { type DataAdapter, normalizePath } from "obsidian";

/** A file in the folder of a site that says the plugin made the folder */
export const MARKER = "vault-to-site.json";

/**
 * The folder a site is written to.
 *
 * A build starts by emptying the folder. So that a wrong setting never
 * empties a folder of notes, only a folder that holds the marker of an
 * earlier build is emptied. Any other folder that has something in it is
 * refused.
 */
export class Output {
  private readonly made = new Set<string>();
  private readonly adapter: DataAdapter;
  readonly root: string;

  constructor(adapter: DataAdapter, root: string) {
    this.adapter = adapter;
    this.root = normalizePath(root);
  }

  async prepare(): Promise<void> {
    if (this.root === "" || this.root === "/" || this.root === ".") {
      throw new Error("The site needs a folder of its own, not the vault itself.");
    }
    if (await this.adapter.exists(this.root)) {
      const listed = await this.adapter.list(this.root);
      const isEmpty = listed.files.length === 0 && listed.folders.length === 0;
      if (!isEmpty && !(await this.adapter.exists(this.root + "/" + MARKER))) {
        throw new Error(`The folder "${this.root}" has files that are not a site of this plugin. Choose an empty folder or a new name.`);
      }
      if (!isEmpty) {
        await this.adapter.rmdir(this.root, true);
      }
    }
    await this.folder(this.root);
  }

  async text(path: string, content: string): Promise<void> {
    await this.adapter.write(await this.place(path), content);
  }

  async binary(path: string, content: ArrayBuffer): Promise<void> {
    await this.adapter.writeBinary(await this.place(path), content);
  }

  /** Copies a file of the vault into the site */
  async copy(from: string, path: string): Promise<void> {
    await this.adapter.copy(from, await this.place(path));
  }

  private async place(path: string): Promise<string> {
    const full = this.root + "/" + path;
    await this.folder(full.slice(0, full.lastIndexOf("/")));
    return full;
  }

  private async folder(path: string): Promise<void> {
    if (this.made.has(path)) {
      return;
    }
    const above = path.lastIndexOf("/");
    if (above > 0) {
      await this.folder(path.slice(0, above));
    }
    if (!(await this.adapter.exists(path))) {
      await this.adapter.mkdir(path);
    }
    this.made.add(path);
  }
}
