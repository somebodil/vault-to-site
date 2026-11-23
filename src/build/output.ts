import { type DataAdapter, normalizePath, requireApiVersion } from "obsidian";
import { ZipWriter } from "./zip.ts";

/** A file in a site that says the plugin made it */
export const MARKER = "vault-to-site.json";

/** The version of Obsidian from which a plugin can add to the end of a file */
const APPENDS_FROM = "1.12.3";

/** How often a file is written before the build gives up */
const WRITE_ATTEMPTS = 3;

/** Where a site is written to: a folder, or one zip archive */
export interface SiteOutput {
  /** Makes the place ready. Throws when the place holds something that is not a site of the plugin. */
  prepare(): Promise<void>;
  text(path: string, content: string): Promise<void>;
  binary(path: string, content: ArrayBuffer): Promise<void>;
  /** Puts a file of the vault into the site */
  copy(from: string, path: string): Promise<void>;
  /** Ends the writing. Says where the site is, from the root of the vault, and how large. */
  finish(): Promise<{ place: string; bytes: number }>;
  /** How many writes had to be done a second time */
  rewritten: number;
}

/**
 * Writes, and looks whether the file has the size of what was written.
 * Obsidian on Android has been seen to say that a file was written and to
 * leave it empty, about once in a few hundred files. Such a file is written
 * again.
 */
async function checked(adapter: DataAdapter, full: string, size: number, write: () => Promise<void>, onRewrite: () => void): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await write();
    const written = (await adapter.stat(full))?.size;
    if (written === size) {
      return;
    }
    if (attempt === WRITE_ATTEMPTS) {
      throw new Error(`"${full}" could not be written: it has ${String(written ?? "no")} bytes of ${String(size)}.`);
    }
    onRewrite();
  }
}

/** Makes the folders above a path, the nearest to the root first */
async function makeFolders(adapter: DataAdapter, folder: string, made: Set<string>): Promise<void> {
  if (folder === "" || made.has(folder)) {
    return;
  }
  const above = folder.lastIndexOf("/");
  if (above > 0) {
    await makeFolders(adapter, folder.slice(0, above), made);
  }
  if (!(await adapter.exists(folder))) {
    await adapter.mkdir(folder);
  }
  made.add(folder);
}

function isVaultItself(path: string): boolean {
  return path === "" || path === "/" || path === ".";
}

/**
 * A site as a folder.
 *
 * A build starts by emptying the folder. So that a wrong setting never
 * empties a folder of notes, only a folder that holds the marker of an
 * earlier build is emptied. Any other folder that has something in it is
 * refused.
 */
export class FolderOutput implements SiteOutput {
  rewritten = 0;
  private bytes = 0;
  private readonly made = new Set<string>();
  private readonly adapter: DataAdapter;
  private readonly root: string;

  constructor(adapter: DataAdapter, root: string) {
    this.adapter = adapter;
    this.root = normalizePath(root);
  }

  async prepare(): Promise<void> {
    if (isVaultItself(this.root)) {
      throw new Error("The site needs a folder of its own, not the vault itself.");
    }
    const stat = await this.adapter.stat(this.root);
    if (stat?.type === "file") {
      throw new Error(`"${this.root}" is a file. Choose a folder for the site.`);
    }
    if (stat !== null) {
      const listed = await this.adapter.list(this.root);
      const isEmpty = listed.files.length === 0 && listed.folders.length === 0;
      if (!isEmpty && !(await this.adapter.exists(this.root + "/" + MARKER))) {
        throw new Error(`The folder "${this.root}" has files that are not a site of this plugin. Choose an empty folder or a new name.`);
      }
      if (!isEmpty) {
        await this.adapter.rmdir(this.root, true);
      }
    }
    await makeFolders(this.adapter, this.root, this.made);
  }

  async text(path: string, content: string): Promise<void> {
    await this.binary(path, new TextEncoder().encode(content).buffer);
  }

  async binary(path: string, content: ArrayBuffer): Promise<void> {
    const full = await this.place(path);
    await checked(this.adapter, full, content.byteLength, () => this.adapter.writeBinary(full, content), () => this.rewritten++);
    this.bytes += content.byteLength;
  }

  async copy(from: string, path: string): Promise<void> {
    const full = await this.place(path);
    const size = (await this.adapter.stat(from))?.size ?? -1;
    const write = async (): Promise<void> => {
      if (await this.adapter.exists(full)) {
        await this.adapter.remove(full);
      }
      await this.adapter.copy(from, full);
    };
    await checked(this.adapter, full, size, write, () => this.rewritten++);
    this.bytes += Math.max(0, size);
  }

  finish(): Promise<{ place: string; bytes: number }> {
    return Promise.resolve({ place: this.root, bytes: this.bytes });
  }

  private async place(path: string): Promise<string> {
    const full = this.root + "/" + path;
    await makeFolders(this.adapter, full.slice(0, full.lastIndexOf("/")), this.made);
    return full;
  }
}

/**
 * A site as one zip archive.
 *
 * A small archive is kept in memory and written at the end with one write,
 * which can be checked and done again. A large one is written in pieces as
 * it grows, so that it need not fit into the memory of a phone.
 */
export class ZipOutput implements SiteOutput {
  rewritten = 0;
  private readonly adapter: DataAdapter;
  private readonly path: string;
  private readonly zip: ZipWriter;
  private pieces: Uint8Array[] = [];
  /** Bytes in `pieces` */
  private held = 0;
  /** Bytes that are in the file already */
  private onDisk = 0;
  /** Adding to an archive is one thing at a time: this is the end of the line */
  private last: Promise<void> = Promise.resolve();
  /** An archive is written in pieces from this size on */
  private readonly pieceSize: number;

  constructor(adapter: DataAdapter, path: string, pieceSize = 32 * 1024 * 1024) {
    this.adapter = adapter;
    this.path = zipPath(path);
    this.pieceSize = pieceSize;
    this.zip = new ZipWriter((piece) => this.take(piece));
  }

  async prepare(): Promise<void> {
    if (isVaultItself(this.path.slice(0, -".zip".length))) {
      throw new Error("The archive of the site needs a name.");
    }
    if ((await this.adapter.stat(this.path))?.type === "folder") {
      throw new Error(`"${this.path}" is a folder. Choose another name for the archive.`);
    }
    await makeFolders(this.adapter, this.path.includes("/") ? this.path.slice(0, this.path.lastIndexOf("/")) : "", new Set());
  }

  text(path: string, content: string): Promise<void> {
    return this.inTurn(() => this.zip.add(path, new TextEncoder().encode(content)));
  }

  binary(path: string, content: ArrayBuffer): Promise<void> {
    return this.inTurn(() => this.zip.add(path, new Uint8Array(content)));
  }

  copy(from: string, path: string): Promise<void> {
    return this.inTurn(async () => this.zip.add(path, new Uint8Array(await this.adapter.readBinary(from))));
  }

  async finish(): Promise<{ place: string; bytes: number }> {
    await this.inTurn(async () => {
      await this.zip.finish();
      await this.flush();
    });
    return { place: this.path, bytes: this.onDisk };
  }

  private inTurn(work: () => Promise<void>): Promise<void> {
    const next = this.last.then(work);
    // A failure reaches who asked, and does not keep what comes after from running
    this.last = next.catch(() => undefined);
    return next;
  }

  private async take(piece: Uint8Array): Promise<void> {
    this.pieces.push(piece);
    this.held += piece.length;
    // Before 1.12.3 Obsidian cannot add to a file: the whole archive is then kept until the end
    if (this.held >= this.pieceSize && requireApiVersion(APPENDS_FROM)) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    const buffer = new Uint8Array(this.held);
    let at = 0;
    for (const piece of this.pieces) {
      buffer.set(piece, at);
      at += piece.length;
    }
    this.pieces = [];
    this.held = 0;
    if (this.onDisk === 0) {
      const write = async (): Promise<void> => {
        if (await this.adapter.exists(this.path)) {
          await this.adapter.remove(this.path);
        }
        await this.adapter.writeBinary(this.path, buffer.buffer);
      };
      await checked(this.adapter, this.path, buffer.length, write, () => this.rewritten++);
    } else if (buffer.length > 0 && requireApiVersion(APPENDS_FROM)) {
      await this.adapter.appendBinary(this.path, buffer.buffer);
      const size = (await this.adapter.stat(this.path))?.size;
      if (size !== this.onDisk + buffer.length) {
        // What was added cannot be taken back, so the archive is not repaired here
        throw new Error(`"${this.path}" could not be written: it has ${String(size ?? "no")} bytes of ${String(this.onDisk + buffer.length)}. Build again.`);
      }
    }
    this.onDisk += buffer.length;
  }
}

/** The path of an archive: as given, with `.zip` at its end */
export function zipPath(path: string): string {
  const normal = normalizePath(path);
  return normal.toLowerCase().endsWith(".zip") ? normal : normal + ".zip";
}
