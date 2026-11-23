import type { DataAdapter } from "obsidian";
import { ZipWriter } from "./zip.ts";

/** A file in a site that says the plugin made it */
export const MARKER = "vault-to-site.json";

/** What a build puts at the top of a site: only these are removed before a build */
/**
 * The names an archive has on the way: while it is written, and while the
 * one before gives way to it. Nobody gives a file of their own such a name,
 * so a file with one is a rest of a build, and a rename to or from one is a
 * step of a build.
 */
export const PART = ".v2s-part";
export const OLD = ".v2s-old";

const SITE_FILES = [MARKER, "index.html", ".nojekyll", "README.txt"];
const SITE_FOLDERS = ["app", "data", "assets"];

/** How often a file is written before the build gives up */
const WRITE_ATTEMPTS = 3;

/**
 * Where a site is written to: a folder, or one zip archive. Paths are from
 * the root of the vault and are given as Obsidian writes them (`normalizePath`).
 */
export interface SiteOutput {
  /** Makes the place ready. Throws when the place holds something that is not a site of the plugin. */
  prepare(): Promise<void>;
  text(path: string, content: string): Promise<void>;
  binary(path: string, content: ArrayBuffer): Promise<void>;
  /** Puts a file of the vault into the site */
  copy(from: string, path: string): Promise<void>;
  /** Ends the writing. Says where the site is, from the root of the vault, and how large. */
  finish(): Promise<{ place: string; bytes: number }>;
  /** Gives up: what was written so far is not left behind as if it were a site */
  abort(): Promise<void>;
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

/**
 * Makes folders, each once. Several notes are written at the same time, and
 * all of them want the same folder first: they wait for the one that makes it.
 */
class Folders {
  private readonly made = new Map<string, Promise<void>>();
  private readonly adapter: DataAdapter;

  constructor(adapter: DataAdapter) {
    this.adapter = adapter;
  }

  make(folder: string): Promise<void> {
    if (folder === "") {
      return Promise.resolve();
    }
    let making = this.made.get(folder);
    if (making === undefined) {
      making = this.create(folder);
      this.made.set(folder, making);
    }
    return making;
  }

  private async create(folder: string): Promise<void> {
    const above = folder.lastIndexOf("/");
    if (above > 0) {
      await this.make(folder.slice(0, above));
    }
    if (await this.adapter.exists(folder)) {
      return;
    }
    try {
      await this.adapter.mkdir(folder);
    } catch (error) {
      // Made by something else in the meantime: that is as good
      if (!(await this.adapter.exists(folder))) {
        throw error;
      }
    }
  }
}

function isVaultItself(path: string): boolean {
  return path === "" || path === "/" || path === ".";
}

function folderOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/**
 * A site as a folder.
 *
 * A build takes away the site of the build before. So that a wrong setting
 * never empties a folder of notes, a folder with something in it is only
 * written to when it holds the marker of an earlier build, and even then
 * only what a build writes is removed. A folder that is also something
 * else, as a copy of a repository with its `.git`, keeps the rest.
 */
export class FolderOutput implements SiteOutput {
  rewritten = 0;
  private bytes = 0;
  private readonly folders: Folders;
  private readonly adapter: DataAdapter;
  private readonly root: string;

  constructor(adapter: DataAdapter, root: string) {
    this.adapter = adapter;
    this.root = root;
    this.folders = new Folders(adapter);
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
      for (const name of SITE_FOLDERS) {
        if ((await this.adapter.stat(this.root + "/" + name))?.type === "folder") {
          await this.adapter.rmdir(this.root + "/" + name, true);
        }
      }
      for (const name of SITE_FILES) {
        if (await this.adapter.exists(this.root + "/" + name)) {
          await this.adapter.remove(this.root + "/" + name);
        }
      }
    }
    await this.folders.make(this.root);
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

  /** What was written stays, with its marker: the next build takes it away. Without index.html it does not pass for a site. */
  async abort(): Promise<void> {
    const index = this.root + "/index.html";
    if (await this.adapter.exists(index)) {
      await this.adapter.remove(index);
    }
  }

  private async place(path: string): Promise<string> {
    const full = this.root + "/" + path;
    await this.folders.make(folderOf(full));
    return full;
  }
}

/**
 * A site as one zip archive.
 *
 * The archive is written under another name and gets its own at the very
 * end. So the archive of the build before is there until the new one is
 * whole, and a build that is stopped or fails leaves no half archive that
 * looks like a site.
 *
 * A small archive is kept in memory and written with one write, which can be
 * checked and done again. A large one is written in pieces as it grows, so
 * that it need not fit into the memory of a phone.
 */
export class ZipOutput implements SiteOutput {
  rewritten = 0;
  private readonly adapter: DataAdapter;
  private readonly path: string;
  /** Where the archive is written until it is whole */
  private readonly part: string;
  private readonly zip: ZipWriter;
  private pieces: Uint8Array[] = [];
  /** Bytes in `pieces` */
  private held = 0;
  /** Bytes that are in the file already */
  private onDisk = 0;
  /** Adding to an archive is one thing at a time: this is the end of the line */
  private last: Promise<void> = Promise.resolve();
  /** Set when a write failed: the archive is not whole, and nothing more is added to it */
  private broken: Error | null = null;
  /** An archive is written in pieces from this size on */
  private readonly pieceSize: number;
  /** True when a build has written to this path before: what is there may give way */
  private readonly mayReplace: boolean;

  /** @param mayReplace true when the file at the path, if there is one, was written by a build of this plugin */
  constructor(adapter: DataAdapter, path: string, mayReplace: boolean, pieceSize = 32 * 1024 * 1024) {
    this.adapter = adapter;
    this.path = zipPath(path);
    this.part = this.path + PART;
    this.mayReplace = mayReplace;
    this.pieceSize = pieceSize;
    this.zip = new ZipWriter((piece) => this.take(piece));
  }

  async prepare(): Promise<void> {
    if (isVaultItself(this.path.slice(0, -".zip".length))) {
      throw new Error("The archive of the site needs a name.");
    }
    const there = await this.adapter.stat(this.path);
    if (there?.type === "folder") {
      throw new Error(`"${this.path}" is a folder. Choose another name for the archive.`);
    }
    if (there !== null && !this.mayReplace) {
      // An archive of this name that a build did not write is somebody's file, as a backup
      throw new Error(`"${this.path}" is a file that this plugin did not write. Choose another name for the archive, or remove the file.`);
    }
    await new Folders(this.adapter).make(folderOf(this.path));
    await this.removePart();
  }

  text(path: string, content: string): Promise<void> {
    return this.add(path, new TextEncoder().encode(content));
  }

  binary(path: string, content: ArrayBuffer): Promise<void> {
    return this.add(path, new Uint8Array(content));
  }

  copy(from: string, path: string): Promise<void> {
    // A file of the vault is read when its turn comes, so that only one of them is in memory
    return this.inTurn(async () => this.zip.add(path, new Uint8Array(await this.adapter.readBinary(from))));
  }

  async finish(): Promise<{ place: string; bytes: number }> {
    await this.inTurn(async () => {
      await this.zip.finish();
      await this.flush();
      // Only now does the archive of the build before give way. It is set aside, not removed, until the
      // new one has its name: should that fail, the old one is put back.
      const before = this.path + OLD;
      const hadOne = await this.adapter.exists(this.path);
      if (hadOne) {
        if (await this.adapter.exists(before)) {
          await this.adapter.remove(before);
        }
        await this.adapter.rename(this.path, before);
      }
      try {
        await this.adapter.rename(this.part, this.path);
        const size = (await this.adapter.stat(this.path))?.size;
        if (size !== this.onDisk) {
          throw new Error(`"${this.path}" could not be written: it has ${String(size ?? "no")} bytes of ${String(this.onDisk)}. Build again.`);
        }
      } catch (error) {
        if (hadOne) {
          if (await this.adapter.exists(this.path)) {
            await this.adapter.remove(this.path);
          }
          await this.adapter.rename(before, this.path);
        }
        throw error;
      }
      if (hadOne) {
        await this.adapter.remove(before);
      }
    });
    return { place: this.path, bytes: this.onDisk };
  }

  async abort(): Promise<void> {
    this.broken ??= new Error("The build was given up.");
    await this.last;
    await this.removePart();
  }

  private async removePart(): Promise<void> {
    if (await this.adapter.exists(this.part)) {
      await this.adapter.remove(this.part);
    }
  }

  /** What is in memory already is made smaller right away, next to the others, and waits in line only to be written */
  private async add(path: string, data: Uint8Array): Promise<void> {
    const packed = await this.zip.pack(path, data);
    await this.inTurn(() => this.zip.put(packed));
  }

  /**
   * Does one thing after the other. After a failure nothing more is done:
   * the place in the archive where the failed piece belongs is lost, and
   * what came after it would make an archive that looks whole and is not.
   */
  private inTurn(work: () => Promise<void>): Promise<void> {
    const next = this.last.then(async () => {
      if (this.broken !== null) {
        throw this.broken;
      }
      try {
        await work();
      } catch (error) {
        this.broken = error instanceof Error ? error : new Error(String(error));
        throw this.broken;
      }
    });
    this.last = next.catch(() => undefined);
    return next;
  }

  private async take(piece: Uint8Array): Promise<void> {
    this.pieces.push(piece);
    this.held += piece.length;
    if (this.held >= this.pieceSize) {
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
        await this.removePart();
        await this.adapter.writeBinary(this.part, buffer.buffer);
      };
      await checked(this.adapter, this.part, buffer.length, write, () => this.rewritten++);
    } else if (buffer.length > 0) {
      await this.adapter.appendBinary(this.part, buffer.buffer);
      const size = (await this.adapter.stat(this.part))?.size;
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
  return path.toLowerCase().endsWith(".zip") ? path : path + ".zip";
}
