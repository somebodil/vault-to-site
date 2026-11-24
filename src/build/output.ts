import type { DataAdapter } from "obsidian";
import { sitePath } from "../select/extra.ts";
import { readFirst, ZipWriter } from "./zip.ts";

/** A file in a site that says the plugin made it */
export const MARKER = "vault-to-site.json";

/** What the marker says of who made the site */
const MADE_BY = "vault-to-site";

/**
 * What a build writes into the marker.
 *
 * @param extra the paths of the extra files in the site: the next build takes away those it does not write again
 */
export function markerText(version: string, extra: readonly string[]): string {
  const marker = { plugin: MADE_BY, version, ...(extra.length > 0 ? { extra } : {}) };
  return JSON.stringify(marker, null, 2) + "\n";
}

/**
 * What a marker says, or null for a file that is not a marker of this plugin.
 *
 * A file that only has the name of the marker is not one. The settings of a
 * run by a program are kept under the same name, at the top of a vault: by
 * the name alone, that vault would pass for a site, and a build would take
 * away the folders in it that have the names of the folders of a site.
 */
export function readMarker(text: string): { extra: unknown[] } | null {
  let marker: unknown;
  try {
    marker = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof marker !== "object" || marker === null || (marker as { plugin?: unknown }).plugin !== MADE_BY) {
    return null;
  }
  const extra = (marker as { extra?: unknown }).extra;
  return { extra: Array.isArray(extra) ? extra : [] };
}

/**
 * The folder at the top of the vault where a site lies while it is built.
 *
 * Its name starts with a dot: Obsidian shows no such folder and does not
 * read what is in it, so a site on the way never turns up among the files
 * of the vault. It is the plugin's alone. Every build empties it before it
 * starts, so what a build that broke off left there is gone with the next
 * one. In it, a build writes to a folder of its own, named
 * by a few letters and digits that are drawn by chance (`wayToken`): a
 * build that another one emptied the folder under fails, and never writes
 * into the site of the other.
 *
 * It lies in the vault because a plugin reaches nothing else on a phone,
 * and because a site that is whole is moved to its place, which is one
 * step only on the same disk.
 */
export const WORK = ".vault-to-site-cache";

/** Eight letters and digits, drawn by chance: what tells the things one build has on the way from those of every other */
export function wayToken(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

/** True for the folder builds write in, and for every path inside it. A disk may take capital letters for small ones. */
function isInWork(path: string): boolean {
  const small = path.toLowerCase();
  return small === WORK || small.startsWith(WORK + "/");
}

/**
 * Empties the folder builds write in. What cannot be taken away now, as a
 * file that another program holds, stays for the next build: this one
 * writes to a folder of its own beside it.
 */
async function emptyWork(adapter: DataAdapter): Promise<void> {
  const there = await adapter.stat(WORK);
  if (there?.type === "file") {
    throw new Error(`"${WORK}" is a file. A site lies in a folder of that name while it is built: remove the file, or give it another name.`);
  }
  if (there !== null) {
    await adapter.rmdir(WORK, true).catch(() => undefined);
  }
}

/** Takes away the folder a build wrote in, and the folder above it when nothing else is in it */
async function leaveWork(adapter: DataAdapter, mine: string): Promise<void> {
  if ((await adapter.stat(mine))?.type === "folder") {
    await adapter.rmdir(mine, true);
  }
  if ((await adapter.stat(WORK))?.type !== "folder") {
    return;
  }
  const listed = await adapter.list(WORK);
  if (listed.files.length === 0 && listed.folders.length === 0) {
    // Empty, and still asked to go with what it holds: see `removeExtra`
    await adapter.rmdir(WORK, true);
  }
}

/**
 * Moves a file to a place where nothing is. A file that cannot be moved, as
 * one that would go onto another disk through a link, is copied there, and
 * the first one is taken away.
 */
async function move(adapter: DataAdapter, from: string, to: string): Promise<void> {
  try {
    await adapter.rename(from, to);
  } catch (error) {
    // Something is at the place: that is why, and a copy would not be the answer
    if (await adapter.exists(to)) {
      throw error;
    }
    try {
      const size = (await adapter.stat(from))?.size;
      await adapter.copy(from, to);
      if ((await adapter.stat(to))?.size !== size) {
        throw new Error("the copy is not whole");
      }
    } catch {
      // Half a copy is this build's: nothing was there. The first failure is the one to tell of.
      if (await adapter.exists(to).catch(() => false)) {
        await adapter.remove(to).catch(() => undefined);
      }
      throw error;
    }
    await adapter.remove(from);
  }
}

/** What a build puts at the top of a site: only these, and the extra files the marker names, are removed before a build */
const SITE_FILES = [MARKER, "index.html", ".nojekyll", "README.txt"];
const SITE_FOLDERS = ["app", "data", "assets"];
/** The names a site has at its top: an extra file cannot have one of them */
export const SITE_NAMES: readonly string[] = [...SITE_FILES, ...SITE_FOLDERS];

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
  /** Ends the writing: the site takes its place. Says where the site is, from the root of the vault, and how large. */
  finish(): Promise<{ place: string; bytes: number }>;
  /** Gives up: what was written so far is taken away, and the site of the build before stays as it was */
  abort(): Promise<void>;
  /** How many files of the vault may be copied at a time */
  readonly copiesAtATime: number;
}

/**
 * Writes, and looks whether the file has the size of what was written.
 * Obsidian on Android has been seen to say that a file was written and to
 * leave it empty, about once in a few hundred files. Such a file is written
 * again.
 */
async function checked(adapter: DataAdapter, full: string, size: number, write: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await write();
    const written = (await adapter.stat(full))?.size;
    if (written === size) {
      return;
    }
    if (attempt === WRITE_ATTEMPTS) {
      throw new Error(`"${full}" could not be written: it has ${String(written ?? "no")} bytes of ${String(size)}.`);
    }
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

/**
 * True for a path with a part that is `.` or `..`. Such a path is another
 * place than it reads: `Notes/..` is the vault itself, and `../site` is
 * outside it. What is asked of a place by its path, as whether it is a site
 * of the plugin, would be asked of the wrong one.
 */
function hasDotPart(path: string): boolean {
  return path.split("/").some((part) => part === "." || part === "..");
}

function folderOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * A site as a folder.
 *
 * The site is written into a folder in `WORK` and takes its place at
 * the very end. So the site of the build before is there until the new one
 * is whole, and a build that is stopped or fails leaves it as it was.
 *
 * Taking its place, a build takes away the site of the build before. So
 * that a wrong setting never empties a folder of notes, a folder with
 * something in it is only written to when it holds the marker of an earlier
 * build, and even then only what a build writes is removed. A folder that
 * is also something else, as a copy of a repository with its `.git`, keeps
 * the rest: also a file at the path of an extra file, which stops the build
 * before anything is taken away. That is why the new site is moved in piece
 * by piece, and the folder is not changed for another as a whole.
 */
export class FolderOutput implements SiteOutput {
  /** Each copy is a file of its own, and nothing of it is held in memory */
  readonly copiesAtATime = 6;
  private bytes = 0;
  private readonly folders: Folders;
  private readonly adapter: DataAdapter;
  private readonly root: string;
  /** Where the site is written until it is whole: a folder of this build in `WORK` */
  private readonly work: string;
  private readonly extra: readonly string[];
  /** The first file this build wrote: as long as it is there, the folder the site is written to is still the one of this build */
  private first: string | null = null;

  /**
   * @param extra the paths in the site of the extra files this build will copy
   * @param token what the folder the site is written to is told by: see `wayToken`
   */
  constructor(adapter: DataAdapter, root: string, extra: readonly string[] = [], token = wayToken()) {
    this.adapter = adapter;
    this.root = root;
    this.work = WORK + "/" + token;
    this.extra = extra;
    this.folders = new Folders(adapter);
  }

  /** Nothing of the place is touched here: it is only asked whether the site may go there */
  async prepare(): Promise<void> {
    await this.mayGoThere();
    await emptyWork(this.adapter);
    await this.folders.make(this.work);
  }

  /**
   * Throws when the place holds something that is not a site of the plugin.
   *
   * @returns the extra files of the build before, which its marker names: they give way with the site
   */
  private async mayGoThere(): Promise<string[]> {
    if (isVaultItself(this.root)) {
      throw new Error("The site needs a folder of its own, not the vault itself.");
    }
    if (hasDotPart(this.root)) {
      throw new Error(`"${this.root}" has a part that is "." or "..". Write the folder of the site as a plain path from the root of the vault.`);
    }
    if (isInWork(this.root)) {
      throw new Error(`"${WORK}" is where a site lies while it is built, and it is emptied by every build. Choose another folder for the site.`);
    }
    const stat = await this.adapter.stat(this.root);
    if (stat?.type === "file") {
      throw new Error(`"${this.root}" is a file. Choose a folder for the site.`);
    }
    if (stat === null) {
      return [];
    }
    const listed = await this.adapter.list(this.root);
    const isEmpty = listed.files.length === 0 && listed.folders.length === 0;
    const marker = await this.marker();
    if (!isEmpty && marker === null) {
      throw new Error(`The folder "${this.root}" has files that are not a site of this plugin. Choose an empty folder or a new name.`);
    }
    // The extra files of the build before, which its marker names. A path that could not have been an
    // extra file is left alone, whoever wrote it into the marker.
    const before = (marker?.extra ?? []).map((written) => (typeof written === "string" ? sitePath(written, SITE_NAMES) : null)).filter((path) => path !== null);
    await this.refuseTaken(new Set(before));
    return before;
  }

  async text(path: string, content: string): Promise<void> {
    await this.binary(path, new TextEncoder().encode(content).buffer);
  }

  async binary(path: string, content: ArrayBuffer): Promise<void> {
    const full = await this.place(path);
    await checked(this.adapter, full, content.byteLength, () => this.adapter.writeBinary(full, content));
    this.bytes += content.byteLength;
  }

  async copy(from: string, path: string): Promise<void> {
    const full = await this.place(path);
    const size = (await this.adapter.stat(from))?.size ?? -1;
    // The folder the site is written to is new, and every file has a name of its own: only a second
    // attempt finds something at the place
    let attempts = 0;
    const write = async (): Promise<void> => {
      if (attempts++ > 0 && (await this.adapter.exists(full))) {
        await this.adapter.remove(full);
      }
      await this.adapter.copy(from, full);
    };
    await checked(this.adapter, full, size, write);
    this.bytes += Math.max(0, size);
  }

  /**
   * The site is whole: only now does the site of the build before give way,
   * and the new one is moved to its place.
   *
   * The page goes first and comes last. Without it a folder does not pass
   * for a site, so what a build that breaks off in these few steps leaves
   * is no site, and with the marker in it, which is written over and never
   * taken away, the next build takes the folder for the plugin's.
   */
  async finish(): Promise<{ place: string; bytes: number }> {
    // Another Obsidian that builds in the same vault empties the folder under this build. What was written
    // after that may well be there, and would be half a site.
    if (this.first !== null && !(await this.adapter.exists(this.first))) {
      throw new Error(`"${WORK}" was emptied while the site was built, as by another build in this vault that started later. Build again.`);
    }
    // Asked again: something may have come to the place while the site was built, and it is somebody's as well
    const before = await this.mayGoThere();
    await this.folders.make(this.root);
    if (await this.adapter.exists(this.root + "/index.html")) {
      await this.adapter.remove(this.root + "/index.html");
    }
    await this.removeExtra(before);
    for (const name of SITE_FOLDERS) {
      if ((await this.adapter.stat(this.root + "/" + name))?.type === "folder") {
        await this.adapter.rmdir(this.root + "/" + name, true);
      }
    }
    for (const name of SITE_FILES) {
      if (name !== MARKER && (await this.adapter.exists(this.root + "/" + name))) {
        await this.adapter.remove(this.root + "/" + name);
      }
    }
    // The marker is written over the one that is there: moved, the folder would be without one for a moment
    if (await this.adapter.exists(this.work + "/" + MARKER)) {
      const marker = await this.adapter.readBinary(this.work + "/" + MARKER);
      const full = this.root + "/" + MARKER;
      await checked(this.adapter, full, marker.byteLength, () => this.adapter.writeBinary(full, marker));
    }
    await this.moveIn(this.work, this.root, new Set([MARKER, "index.html"]));
    if (await this.adapter.exists(this.work + "/index.html")) {
      await move(this.adapter, this.work + "/index.html", this.root + "/index.html");
    }
    // What is left of the folder the site was written to. Should it stay, the next build takes it away.
    await leaveWork(this.adapter, this.work).catch(() => undefined);
    return { place: this.root, bytes: this.bytes };
  }

  /**
   * Moves what a folder holds into another. A folder that is not there yet
   * is moved as a whole, which is one step however much it holds. One that
   * is there, as a folder of the person that an extra file goes into, gets
   * what is inside, piece by piece: so does one that cannot be moved as a
   * whole, as onto another disk through a link.
   *
   * @param skip names of files at the top that are not moved here
   */
  private async moveIn(from: string, to: string, skip: ReadonlySet<string> = new Set()): Promise<void> {
    const listed = await this.adapter.list(from);
    for (const folder of listed.folders) {
      const name = nameOf(folder);
      const target = to + "/" + name;
      if ((await this.adapter.stat(target)) === null) {
        const isMoved = await this.adapter.rename(from + "/" + name, target).then(
          () => true,
          () => false,
        );
        if (isMoved) {
          continue;
        }
        await this.folders.make(target);
      }
      await this.moveIn(from + "/" + name, target);
    }
    for (const file of listed.files) {
      const name = nameOf(file);
      if (!skip.has(name)) {
        await move(this.adapter, from + "/" + name, to + "/" + name);
      }
    }
  }

  /**
   * Gives up. What was written is taken away, and the site of the build
   * before stays as it was. A site that was on its way in already is
   * without its page, which `finish` takes away first: it does not pass for
   * a site, and with its marker the next build takes it.
   */
  async abort(): Promise<void> {
    await leaveWork(this.adapter, this.work);
  }

  private async place(path: string): Promise<string> {
    const full = this.work + "/" + path;
    this.first ??= full;
    await this.folders.make(folderOf(full));
    return full;
  }

  /** What the marker in the folder says, or null when there is none that this plugin wrote */
  private async marker(): Promise<{ extra: unknown[] } | null> {
    try {
      return readMarker(await this.adapter.read(this.root + "/" + MARKER));
    } catch {
      return null;
    }
  }

  /**
   * Stops the build when something that this plugin did not write is where
   * an extra file is to go. Asked before anything is taken away or drawn: a
   * copy onto a file that is there fails on a computer, after all the notes
   * are drawn and with the words of the file system, and it is not known to
   * fail on a phone.
   *
   * @param before the extra files of the build before: they are taken away, so they are not in the way
   */
  private async refuseTaken(before: ReadonlySet<string>): Promise<void> {
    for (const path of this.extra) {
      // The path itself, and each folder it lies in: a file where a folder has to be is in the way as well
      const upTo = path.split("/").map((_part, at, parts) => parts.slice(0, at + 1).join("/"));
      for (const at of upTo) {
        const there = await this.adapter.stat(this.root + "/" + at);
        if (there !== null && (there.type === "file" ? !before.has(at) : at === path)) {
          throw new Error(
            `"${this.root}/${at}" is there already, and this plugin did not write it: the file "${path}" cannot be put into the site. Remove it, or give the file another path in the site.`,
          );
        }
      }
    }
  }

  /** Takes away the extra files of the build before, and the folders that held nothing else */
  private async removeExtra(before: readonly string[]): Promise<void> {
    for (const path of before) {
      if ((await this.adapter.stat(this.root + "/" + path))?.type !== "file") {
        continue;
      }
      await this.adapter.remove(this.root + "/" + path);
      for (let folder = folderOf(path); folder !== ""; folder = folderOf(folder)) {
        const listed = await this.adapter.list(this.root + "/" + folder);
        if (listed.files.length > 0 || listed.folders.length > 0) {
          break;
        }
        // Empty, as was just seen, and still asked to go with what it holds: asked the other way, Obsidian
        // 1.15 on a computer takes no folder away and fails ("rm returned EISDIR")
        await this.adapter.rmdir(this.root + "/" + folder, true);
      }
    }
  }
}

/**
 * A site as one zip archive.
 *
 * The archive is written in `WORK` and is moved to its place at the very
 * end. So the archive of the build before is there until the new one is
 * whole, and a build that is stopped or fails leaves no half archive that
 * looks like a site.
 *
 * A small archive is kept in memory and written with one write, which can be
 * checked and done again. A large one is written in pieces as it grows, so
 * that it need not fit into the memory of a phone.
 */
export class ZipOutput implements SiteOutput {
  /** A file is read whole to go into the archive: one at a time, so that only one is in memory */
  readonly copiesAtATime = 1;
  private readonly adapter: DataAdapter;
  private readonly path: string;
  /** The folder of this build in `WORK` */
  private readonly work: string;
  /** Where the archive is written until it is whole: in that folder */
  private readonly part: string;
  /** Where the archive of the build before is set aside while the new one takes its place: in that folder as well */
  private readonly before: string;
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
  /** True when the file at the path is an archive of this plugin: it may give way */
  private readonly mayReplace: boolean;

  /** @param mayReplace true when the file at the path, if there is one, was written by a build of this plugin: see `isSiteArchive` */
  constructor(adapter: DataAdapter, path: string, mayReplace: boolean, pieceSize = 32 * 1024 * 1024, token = wayToken()) {
    this.adapter = adapter;
    this.path = zipPath(path);
    this.work = WORK + "/" + token;
    this.part = this.work + "/new.zip";
    this.before = this.work + "/old.zip";
    this.mayReplace = mayReplace;
    this.pieceSize = pieceSize;
    this.zip = new ZipWriter((piece) => this.take(piece));
  }

  async prepare(): Promise<void> {
    if (isVaultItself(this.path.slice(0, -".zip".length))) {
      throw new Error("The archive of the site needs a name.");
    }
    if (hasDotPart(this.path)) {
      throw new Error(`"${this.path}" has a part that is "." or "..". Write the archive of the site as a plain path from the root of the vault.`);
    }
    if (isInWork(this.path)) {
      throw new Error(`"${WORK}" is where a site lies while it is built, and it is emptied by every build. Choose another place for the archive.`);
    }
    const there = await this.adapter.stat(this.path);
    if (there?.type === "folder") {
      throw new Error(`"${this.path}" is a folder. Choose another name for the archive.`);
    }
    if (there !== null) {
      this.refuseForeign();
    }
    const folders = new Folders(this.adapter);
    await folders.make(folderOf(this.path));
    await emptyWork(this.adapter);
    await folders.make(this.work);
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
      // Only now does the archive of the build before give way
      const before = this.before;
      const hadOne = await this.adapter.exists(this.path);
      if (hadOne) {
        // Asked again: a file that came to the place while the site was built is somebody's as well
        this.refuseForeign();
      }
      // It is set aside, not removed, until the new one stands: should that fail, the old one is put back.
      // One that cannot be set aside, as from another disk, is removed: what is in the way has to go.
      let isAside = false;
      if (hadOne) {
        isAside = await this.adapter.rename(this.path, before).then(
          () => true,
          () => false,
        );
        if (!isAside) {
          await this.adapter.remove(this.path);
        }
      }
      try {
        await move(this.adapter, this.part, this.path);
      } catch (error) {
        if (isAside) {
          if (await this.adapter.exists(this.path)) {
            await this.adapter.remove(this.path);
          }
          await this.adapter.rename(before, this.path);
        }
        throw error;
      }
      // With the folder goes the archive that was set aside
      await leaveWork(this.adapter, this.work).catch(() => undefined);
    });
    return { place: this.path, bytes: this.onDisk };
  }

  async abort(): Promise<void> {
    this.broken ??= new Error("The build was given up.");
    await this.last;
    await leaveWork(this.adapter, this.work);
  }

  /** Stops the build when the file at the place of the archive is not one that may give way */
  private refuseForeign(): void {
    if (!this.mayReplace) {
      // A file of this name that is no archive of this plugin is somebody's, as a backup
      throw new Error(`"${this.path}" is a file that this plugin did not write. Choose another name for the archive, or remove the file.`);
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
    if (piece.length >= this.pieceSize) {
      // A large file is written as it is, after what is held: put together with the rest, it would be in memory twice
      await this.flush();
      await this.write(piece);
      return;
    }
    this.pieces.push(piece);
    this.held += piece.length;
    if (this.held >= this.pieceSize) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.pieces.length === 1 && this.pieces[0] !== undefined) {
      const only = this.pieces[0];
      this.pieces = [];
      this.held = 0;
      await this.write(only);
      return;
    }
    const buffer = new Uint8Array(this.held);
    let at = 0;
    for (const piece of this.pieces) {
      buffer.set(piece, at);
      at += piece.length;
    }
    this.pieces = [];
    this.held = 0;
    await this.write(buffer);
  }

  /** Puts bytes at the end of the file of the archive */
  private async write(piece: Uint8Array): Promise<void> {
    // The bytes as a buffer of their own: the ones of a file that was read are that already
    const whole = piece.byteOffset === 0 && piece.byteLength === piece.buffer.byteLength ? piece : piece.slice();
    const buffer = { length: whole.length, buffer: whole.buffer as ArrayBuffer };
    if (this.onDisk === 0) {
      await checked(this.adapter, this.part, buffer.length, () => this.adapter.writeBinary(this.part, buffer.buffer));
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

/**
 * True when the file at a path is an archive that a build of this plugin
 * wrote: one that starts with the marker, as every such archive does.
 *
 * This is how the archive of the build before is known, as a folder is by
 * the marker in it. The file is read whole to look at its start, since
 * Obsidian reads no part of a file.
 */
export async function isSiteArchive(adapter: DataAdapter, path: string): Promise<boolean> {
  try {
    if ((await adapter.stat(path))?.type !== "file") {
      return false;
    }
    const marker = await readFirst(new Uint8Array(await adapter.readBinary(path)), MARKER);
    return marker !== null && readMarker(new TextDecoder().decode(marker)) !== null;
  } catch {
    return false;
  }
}

/** The path of an archive: as given, with `.zip` at its end */
export function zipPath(path: string): string {
  return path.toLowerCase().endsWith(".zip") ? path : path + ".zip";
}
