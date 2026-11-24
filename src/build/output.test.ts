import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inflateRawSync } from "node:zlib";
import type { DataAdapter } from "obsidian";
import { FolderOutput, isOnTheWay, isSiteArchive, MARKER, markerText, readMarker, wayToken, WORK, ZipOutput, zipPath } from "./output.ts";

/** What the outputs use of the adapter of Obsidian, kept in memory */
class MemoryAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly folders = new Set<string>();
  /** Paths whose next write leaves an empty file, as Obsidian on Android does now and then */
  readonly emptyOnce = new Set<string>();
  writes = 0;
  appends = 0;
  copies = 0;

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path) || this.folders.has(path));
  }

  stat(path: string): Promise<{ type: "file" | "folder"; size: number } | null> {
    const file = this.files.get(path);
    if (file !== undefined) {
      return Promise.resolve({ type: "file", size: file.length });
    }
    return Promise.resolve(this.folders.has(path) ? { type: "folder", size: 0 } : null);
  }

  mkdirs = 0;

  async mkdir(path: string): Promise<void> {
    this.mkdirs++;
    // As a device does: time passes, and a folder that is there already is refused
    await Promise.resolve();
    if (this.folders.has(path)) {
      throw new Error("Folder already exists: " + path);
    }
    this.folders.add(path);
  }

  list(path: string): Promise<{ files: string[]; folders: string[] }> {
    // The top of the vault is asked for as a slash, and what lies there has no slash in its path
    const isIn = (other: string): boolean => (path === "/" ? !other.includes("/") : other.startsWith(path + "/") && !other.slice(path.length + 1).includes("/"));
    return Promise.resolve({ files: [...this.files.keys()].filter(isIn), folders: [...this.folders].filter(isIn) });
  }

  rmdir(path: string): Promise<void> {
    for (const other of [...this.files.keys()]) {
      if (other.startsWith(path + "/")) {
        this.files.delete(other);
      }
    }
    for (const other of [...this.folders]) {
      if (other === path || other.startsWith(path + "/")) {
        this.folders.delete(other);
      }
    }
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.writes++;
    this.files.set(path, this.emptyOnce.delete(path) ? new Uint8Array(0) : new Uint8Array(data).slice());
    return Promise.resolve();
  }

  appendBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.appends++;
    const before = this.files.get(path) ?? new Uint8Array(0);
    const after = new Uint8Array(before.length + data.byteLength);
    after.set(before);
    after.set(new Uint8Array(data), before.length);
    this.files.set(path, after);
    return Promise.resolve();
  }

  /** When set, the renames it says yes to fail, as when a file is held by another program */
  failRename: ((from: string, to: string) => boolean) | null = null;

  rename(from: string, to: string): Promise<void> {
    if (this.failRename?.(from, to) === true) {
      return Promise.reject(new Error("the file is busy"));
    }
    if (this.files.has(to) || this.folders.has(to)) {
      // As Obsidian does: nothing is written over by a rename
      return Promise.reject(new Error("Destination file already exists: " + to));
    }
    if (this.folders.has(from)) {
      // A folder goes with all it holds
      for (const folder of [...this.folders]) {
        if (folder === from || folder.startsWith(from + "/")) {
          this.folders.delete(folder);
          this.folders.add(to + folder.slice(from.length));
        }
      }
      for (const [path, content] of [...this.files]) {
        if (path.startsWith(from + "/")) {
          this.files.delete(path);
          this.files.set(to + path.slice(from.length), content);
        }
      }
      return Promise.resolve();
    }
    const file = this.files.get(from);
    if (file === undefined) {
      return Promise.reject(new Error("no such file: " + from));
    }
    this.files.delete(from);
    this.files.set(to, file);
    return Promise.resolve();
  }

  read(path: string): Promise<string> {
    const file = this.files.get(path);
    return file === undefined ? Promise.reject(new Error("No such file: " + path)) : Promise.resolve(new TextDecoder().decode(file));
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(path);
    if (file === undefined) {
      return Promise.reject(new Error("no such file: " + path));
    }
    return Promise.resolve(file.slice().buffer);
  }

  /** When true, no file is copied, as when a disk is full */
  failCopy = false;

  copy(from: string, to: string): Promise<void> {
    this.copies++;
    if (this.failCopy) {
      return Promise.reject(new Error("the disk is full"));
    }
    const file = this.files.get(from);
    if (file !== undefined) {
      this.files.set(to, this.emptyOnce.delete(to) ? new Uint8Array(0) : file.slice());
    }
    return Promise.resolve();
  }

  text(path: string): string {
    return new TextDecoder().decode(this.files.get(path));
  }

  get asAdapter(): DataAdapter {
    return this as unknown as DataAdapter;
  }
}

/** The files of an archive, by name */
function unzip(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, "the archive ends as an archive does");
  const files = new Map<string, string>();
  let at = view.getUint32(end + 16, true);
  for (let i = view.getUint16(end + 10, true); i > 0; i--) {
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    const bodyAt = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const body = zip.subarray(bodyAt, bodyAt + packed);
    files.set(name, new TextDecoder().decode(method === 8 ? inflateRawSync(body) : body));
    at += 46 + nameLength;
  }
  return files;
}

/** A marker as a build writes it */
const marker = (extra: string[] = []): Uint8Array => new TextEncoder().encode(markerText("0.1.0", extra));

describe("the marker", () => {
  it("is read back as it was written", () => {
    assert.equal(markerText("0.1.0", []), '{\n  "plugin": "vault-to-site",\n  "version": "0.1.0"\n}\n');
    assert.deepEqual(readMarker(markerText("0.1.0", [])), { extra: [] });
    assert.deepEqual(readMarker(markerText("0.1.0", ["Resume.pdf", "docs/a.pdf"])), { extra: ["Resume.pdf", "docs/a.pdf"] });
  });

  it("is none when it does not say that this plugin wrote it", () => {
    // The settings of a run by a program have the name of the marker
    assert.equal(readMarker('{"ticks": {"on": [""]}, "only": "publish: true", "format": "folder", "folder": "_site"}'), null);
    for (const text of ["", "\u0000\u0000", "not JSON", "null", "[]", '"vault-to-site"', "{}", '{"plugin": "another"}', '{"plugin": ["vault-to-site"]}', '{"version": "0.1.0"}']) {
      assert.equal(readMarker(text), null, text);
    }
    assert.deepEqual(readMarker('{"plugin": "vault-to-site", "extra": "Resume.pdf"}'), { extra: [] });
  });
});

describe("zipPath", () => {
  it("ends with .zip, once", () => {
    assert.equal(zipPath("site"), "site.zip");
    assert.equal(zipPath("out/Site.ZIP"), "out/Site.ZIP");
  });
});

/** What tells the things a build of a test has on the way: a build draws its own by chance */
const TOKEN = "t0k3n";
/** Where a build of a test writes until the site is whole */
const MINE = WORK + "/" + TOKEN;

describe("the names of a build on the way", () => {
  it("are known with the letters a build draws by chance, without them, and for what lies inside", () => {
    // An archive that is set aside, and what builds up to 0.1.2 had beside the place while they wrote
    for (const path of ["site.zip.v2s-part-k3j9x2a1", "out/site.zip.v2s-old-0a1b2c3d", "_site.v2s-part-t0k3n", "_site.v2s-part-t0k3n/data/n/a.js", "site.zip.v2s-part-t0k3n", "site.zip.v2s-old"]) {
      assert.equal(isOnTheWay(path), true, path);
    }
    for (const path of ["site.zip", "_site/data/n/a.js", "Notes/v2s-part.md", "a.v2s-partner", "a.v2s-part-Not Lower"]) {
      assert.equal(isOnTheWay(path), false, path);
    }
  });

  it("differ from build to build", () => {
    const drawn = new Set(Array.from({ length: 50 }, () => wayToken()));
    assert.equal(drawn.size, 50);
    assert.ok([...drawn].every((token) => /^[a-z0-9]{8}$/.test(token)));
  });
});

describe("FolderOutput", () => {
  /** A whole build of a small site: the marker first and the page last, as a build writes them, and between them what a test adds */
  const build = async (output: FolderOutput, between: () => Promise<void> = () => Promise.resolve()): Promise<void> => {
    await output.prepare();
    await output.text(MARKER, markerText("0.2.0", []));
    await between();
    await output.text("index.html", "<!doctype html>");
    await output.finish();
  };

  it("writes in a folder of its own, away from its place, and moves the site to its place at the end", async () => {
    const adapter = new MemoryAdapter();
    const output = new FolderOutput(adapter.asAdapter, "out/site", [], TOKEN);
    await output.prepare();
    await output.text("index.html", "<!doctype html>");
    await output.text("data/n/a.js", "한글");
    assert.deepEqual([...adapter.files.keys()].sort(), [MINE + "/data/n/a.js", MINE + "/index.html"]);
    assert.equal(MINE, ".vault-to-site-cache/t0k3n", "in a folder that Obsidian does not show");
    assert.deepEqual(await output.finish(), { place: "out/site", bytes: 15 + 6 });
    assert.equal(adapter.text("out/site/index.html"), "<!doctype html>");
    assert.equal(adapter.text("out/site/data/n/a.js"), "한글");
    assert.deepEqual([...adapter.files.keys()].sort(), ["out/site/data/n/a.js", "out/site/index.html"]);
    assert.deepEqual([...adapter.folders].sort(), ["out", "out/site", "out/site/data", "out/site/data/n"]);
  });

  it("leaves the site of the build before as it was when the build is given up", async () => {
    const adapter = new MemoryAdapter();
    for (const folder of ["site", "site/data", "site/data/n"]) {
      adapter.folders.add(folder);
    }
    adapter.files.set("site/" + MARKER, marker());
    adapter.files.set("site/index.html", new TextEncoder().encode("the page of before"));
    adapter.files.set("site/data/n/old.js", new Uint8Array(3));
    const before = new Map(adapter.files);
    const output = new FolderOutput(adapter.asAdapter, "site", [], TOKEN);
    await output.prepare();
    await output.text(MARKER, markerText("0.2.0", []));
    await output.text("data/n/new.js", "x");
    assert.deepEqual([...before.keys()].every((path) => adapter.files.get(path) === before.get(path)), true, "while the new one is written");
    await output.abort();
    assert.deepEqual([...adapter.files], [...before], "and after the build was given up");
    assert.deepEqual([...adapter.folders].sort(), ["site", "site/data", "site/data/n"]);
  });

  it("calls for the claim right before the site of before gives way", async () => {
    const adapter = new MemoryAdapter();
    adapter.folders.add("site");
    adapter.files.set("site/" + MARKER, marker());
    adapter.files.set("site/index.html", new TextEncoder().encode("the page of before"));
    const output = new FolderOutput(adapter.asAdapter, "site", [], TOKEN);
    await output.prepare();
    await output.text(MARKER, markerText("0.2.0", []));
    await output.text("index.html", "new");
    let seen = "";
    await output.finish(() => {
      seen = adapter.text("site/index.html");
      return Promise.resolve();
    });
    assert.equal(seen, "the page of before");
    assert.equal(adapter.text("site/index.html"), "new");
  });

  it("takes away the site of an earlier build, and nothing else in its folder", async () => {
    const adapter = new MemoryAdapter();
    for (const folder of ["site", "site/data", "site/data/n", "site/.git"]) {
      adapter.folders.add(folder);
    }
    adapter.files.set("site/" + MARKER, marker());
    adapter.files.set("site/index.html", new Uint8Array(3));
    adapter.files.set("site/data/n/old.js", new Uint8Array(3));
    adapter.files.set("site/.git/config", new Uint8Array(4));
    adapter.files.set("site/CNAME", new Uint8Array(5));
    await build(new FolderOutput(adapter.asAdapter, "site"));
    assert.deepEqual([...adapter.files.keys()].sort(), ["site/.git/config", "site/CNAME", "site/index.html", "site/" + MARKER]);
    assert.equal(adapter.text("site/" + MARKER), markerText("0.2.0", []));
    assert.equal(adapter.text("site/index.html"), "<!doctype html>");

    adapter.folders.add("Notes");
    adapter.files.set("Notes/keep.md", new Uint8Array(3));
    await assert.rejects(new FolderOutput(adapter.asAdapter, "Notes").prepare(), /not a site of this plugin/);
    assert.equal(adapter.files.has("Notes/keep.md"), true);
  });

  it("takes away the extra files the marker of the build before names, and their empty folders", async () => {
    const adapter = new MemoryAdapter();
    for (const folder of ["site", "site/papers", "site/papers/old", "site/docs", "site/.git"]) {
      adapter.folders.add(folder);
    }
    const marker = { plugin: "vault-to-site", extra: ["Resume.pdf", "papers/old/a.pdf", "docs/b.pdf", "../outside.pdf", ".git/config", "index.html/x", 7, "gone.pdf"] };
    adapter.files.set("site/" + MARKER, new TextEncoder().encode(JSON.stringify(marker)));
    for (const file of ["site/Resume.pdf", "site/papers/old/a.pdf", "site/docs/b.pdf", "site/docs/mine.txt", "site/.git/config", "site/CNAME", "outside.pdf"]) {
      adapter.files.set(file, new Uint8Array(3));
    }
    await build(new FolderOutput(adapter.asAdapter, "site"));
    assert.deepEqual([...adapter.files.keys()].sort(), ["outside.pdf", "site/.git/config", "site/CNAME", "site/docs/mine.txt", "site/index.html", "site/" + MARKER]);
    assert.deepEqual([...adapter.folders].sort(), ["site", "site/.git", "site/docs"]);
  });

  it("refuses the vault itself, and a path that is a file", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set("note.md", new Uint8Array(1));
    await assert.rejects(new FolderOutput(adapter.asAdapter, "").prepare(), /folder of its own/);
    await assert.rejects(new FolderOutput(adapter.asAdapter, "/").prepare(), /folder of its own/);
    await assert.rejects(new FolderOutput(adapter.asAdapter, "note.md").prepare(), /is a file/);
  });

  it("takes a folder for a site by what its marker says, not by a file of that name", async () => {
    // A vault with the settings of a run at its top, and folders that have the names of those of a site
    const vault = (settings: Uint8Array): MemoryAdapter => {
      const adapter = new MemoryAdapter();
      for (const folder of ["Vault", "Vault/assets", "Vault/data", "Vault/app"]) {
        adapter.folders.add(folder);
      }
      adapter.files.set("Vault/" + MARKER, settings);
      for (const file of ["Vault/assets/photo.png", "Vault/data/table.csv", "Vault/app/notes.md", "Vault/index.html", "Vault/README.txt"]) {
        adapter.files.set(file, new Uint8Array(3));
      }
      return adapter;
    };
    const texts = ['{"ticks": {"on": [""]}, "format": "folder", "folder": "Vault"}', "", "not JSON", '{"plugin": "another"}'];
    for (const text of texts) {
      const adapter = vault(new TextEncoder().encode(text));
      const before = [...adapter.files.keys()];
      const folders = [...adapter.folders];
      await assert.rejects(new FolderOutput(adapter.asAdapter, "Vault").prepare(), /not a site of this plugin/, text);
      assert.deepEqual([...adapter.files.keys()], before, text);
      assert.deepEqual([...adapter.folders], folders, text);
    }
    // With a marker of the plugin, the same folder is the site of the build before
    const site = vault(marker());
    await build(new FolderOutput(site.asAdapter, "Vault"));
    assert.deepEqual([...site.files.keys()].sort(), ["Vault/index.html", "Vault/" + MARKER]);
  });

  it("refuses a place with a part that is . or ..", async () => {
    const adapter = new MemoryAdapter();
    for (const place of ["Notes/..", "../site", "a/../b", "./site", "site/.", "a/./b"]) {
      await assert.rejects(new FolderOutput(adapter.asAdapter, place).prepare(), /"\." or "\.\."/, place);
    }
    // An archive has a name with .zip at its end, so only a folder above it can be such a part
    for (const place of ["../site", "a/../b", "./site", "a/./b.zip"]) {
      await assert.rejects(new ZipOutput(adapter.asAdapter, place, true).prepare(), /"\." or "\.\."/, place);
    }
    assert.deepEqual([...adapter.folders], []);
    // A name that only starts with dots is a name
    await new FolderOutput(adapter.asAdapter, ".vault-to-site/..site", [], TOKEN).prepare();
    await new ZipOutput(adapter.asAdapter, ".out/..", false, undefined, TOKEN).prepare();
    assert.deepEqual([...adapter.folders].sort(), [".out", WORK, MINE]);
  });

  it("empties the folder that builds write in, whatever a build that broke off left there", async () => {
    const adapter = new MemoryAdapter();
    for (const folder of [WORK, WORK + "/0ld0ne00", WORK + "/0ld0ne00/data", WORK + "/an0ther0"]) {
      adapter.folders.add(folder);
    }
    for (const file of [WORK + "/0ld0ne00/index.html", WORK + "/0ld0ne00/data/index.js", WORK + "/an0ther0/site.zip", WORK + "/stray.txt", "site.v2s-part-0ld0ne00", "notes.md"]) {
      adapter.files.set(file, new Uint8Array(100));
    }
    await new FolderOutput(adapter.asAdapter, "site", [], TOKEN).prepare();
    assert.deepEqual([...adapter.folders].sort(), [WORK, MINE]);
    // Nothing outside that folder is looked for by its name
    assert.deepEqual([...adapter.files.keys()].sort(), ["notes.md", "site.v2s-part-0ld0ne00"]);
    await new ZipOutput(adapter.asAdapter, "site.zip", false, undefined, "sec0nd").prepare();
    assert.deepEqual([...adapter.folders].sort(), [WORK, WORK + "/sec0nd"]);
  });

  it("does not take for a site what is left after another build emptied the folder under it", async () => {
    const adapter = new MemoryAdapter();
    adapter.folders.add("site");
    adapter.files.set("site/" + MARKER, marker());
    adapter.files.set("site/index.html", new TextEncoder().encode("the page of before"));
    const output = new FolderOutput(adapter.asAdapter, "site", [], TOKEN);
    await output.prepare();
    await output.text(MARKER, markerText("0.2.0", []));
    await output.text("data/n/a.js", "a");
    // Another Obsidian starts a build in the same vault
    await new FolderOutput(adapter.asAdapter, "other", [], "an0ther0").prepare();
    assert.equal(adapter.folders.has(MINE), false);
    // Where a device makes the folders of a file as it writes it, the rest of the site is written all the same
    for (const folder of [MINE, MINE + "/data", MINE + "/data/n"]) {
      adapter.folders.add(folder);
    }
    await output.text("data/n/b.js", "b");
    await output.text("index.html", "new");
    await assert.rejects(output.finish(), /was emptied while the site was built/);
    await output.abort();
    assert.equal(adapter.text("site/index.html"), "the page of before");
    assert.deepEqual([...adapter.files.keys()].sort(), ["site/index.html", "site/" + MARKER]);
    assert.deepEqual([...adapter.folders].sort(), [WORK, WORK + "/an0ther0", "site"], "what the other build writes in stays");
  });

  it("refuses a place in the folder that builds write in, and a file with the name of that folder", async () => {
    const adapter = new MemoryAdapter();
    for (const place of [WORK, WORK + "/site", ".Vault-To-Site-Cache/site"]) {
      await assert.rejects(new FolderOutput(adapter.asAdapter, place).prepare(), /emptied by every build/, place);
    }
    // An archive has .zip at its end, so it is never that folder itself
    for (const place of [WORK + "/site", ".Vault-To-Site-Cache/site.zip"]) {
      await assert.rejects(new ZipOutput(adapter.asAdapter, place, true).prepare(), /emptied by every build/, place);
    }
    assert.deepEqual([...adapter.folders], []);
    // A name that only starts like it is a name
    await new FolderOutput(adapter.asAdapter, WORK + "-of-mine", [], TOKEN).prepare();

    const taken = new MemoryAdapter();
    taken.files.set(WORK, new TextEncoder().encode("of the person"));
    await assert.rejects(new FolderOutput(taken.asAdapter, "site").prepare(), /is a file/);
    await assert.rejects(new ZipOutput(taken.asAdapter, "site.zip", false).prepare(), /is a file/);
    assert.equal(taken.text(WORK), "of the person");
  });

  it("copies what cannot be moved, as onto another disk, and the site is the same", async () => {
    const adapter = new MemoryAdapter();
    for (const folder of ["site", "site/data", "site/.git"]) {
      adapter.folders.add(folder);
    }
    adapter.files.set("site/" + MARKER, marker());
    adapter.files.set("site/index.html", new TextEncoder().encode("the page of before"));
    adapter.files.set("site/data/old.js", new Uint8Array(3));
    adapter.files.set("site/.git/config", new Uint8Array(4));
    adapter.failRename = () => true;
    const output = new FolderOutput(adapter.asAdapter, "site", [], TOKEN);
    await build(output, async () => {
      await output.text("data/n/a.js", "한글");
      await output.text("app/viewer.js", "viewer");
    });
    assert.deepEqual([...adapter.files.keys()].sort(), ["site/.git/config", "site/app/viewer.js", "site/data/n/a.js", "site/index.html", "site/" + MARKER]);
    assert.equal(adapter.text("site/data/n/a.js"), "한글");
    assert.equal(adapter.text("site/index.html"), "<!doctype html>");
    assert.deepEqual([...adapter.folders].sort(), ["site", "site/.git", "site/app", "site/data", "site/data/n"]);

    // Something at the place is no reason to copy: nothing is written over
    const taken = new MemoryAdapter();
    const second = new FolderOutput(taken.asAdapter, "site", [], TOKEN);
    await second.prepare();
    await second.text("index.html", "new");
    const rename = taken.rename.bind(taken);
    taken.rename = async (from: string, to: string): Promise<void> => {
      if (to === "site/index.html") {
        taken.files.set(to, new TextEncoder().encode("put there in the meantime"));
      }
      await rename(from, to);
    };
    await assert.rejects(second.finish(), /already exists/);
    assert.equal(taken.text("site/index.html"), "put there in the meantime");
    assert.equal(taken.copies, 0);
  });

  describe("with a file of someone else where an extra file is to go", () => {
    /** A site that is also something else: a file of the person lies beside it */
    const site = (extraBefore: string[], others: string[]): MemoryAdapter => {
      const adapter = new MemoryAdapter();
      adapter.folders.add("site");
      adapter.folders.add("site/data");
      adapter.files.set("site/" + MARKER, marker(extraBefore));
      adapter.files.set("site/index.html", new Uint8Array(3));
      adapter.files.set("site/data/index.js", new Uint8Array(3));
      for (const path of [...extraBefore, ...others]) {
        for (let at = path.indexOf("/"); at > 0; at = path.indexOf("/", at + 1)) {
          adapter.folders.add("site/" + path.slice(0, at));
        }
        adapter.files.set("site/" + path, new TextEncoder().encode("of the person"));
      }
      return adapter;
    };

    it("stops before anything is written or taken away, and names the file", async () => {
      const adapter = site([], ["Resume.pdf"]);
      const before = [...adapter.files.keys()];
      const folders = [...adapter.folders];
      await assert.rejects(new FolderOutput(adapter.asAdapter, "site", ["Resume.pdf"]).prepare(), /"site\/Resume\.pdf" is there already, and this plugin did not write it/);
      assert.deepEqual([...adapter.files.keys()], before);
      assert.deepEqual([...adapter.folders], folders);
      assert.equal(adapter.text("site/Resume.pdf"), "of the person");
    });

    it("stops as well for a file that came to the place while the site was built, and the site of before stays", async () => {
      const adapter = site([], []);
      const output = new FolderOutput(adapter.asAdapter, "site", ["Resume.pdf"], TOKEN);
      await output.prepare();
      await output.text(MARKER, markerText("0.2.0", ["Resume.pdf"]));
      await output.text("index.html", "new");
      adapter.files.set("site/Resume.pdf", new TextEncoder().encode("of the person"));
      await assert.rejects(output.finish(), /"site\/Resume\.pdf" is there already/);
      await output.abort();
      assert.deepEqual([...adapter.files.keys()].sort(), ["site/Resume.pdf", "site/data/index.js", "site/index.html", "site/" + MARKER]);
      assert.equal(adapter.files.get("site/index.html")?.length, 3, "the page of before");
    });

    it("takes the file for the site's own when the marker of the build before names it", async () => {
      const adapter = site(["Resume.pdf", "old/a.pdf"], ["CNAME"]);
      adapter.files.set("Papers/Resume.pdf", new Uint8Array([1, 2, 3]));
      const output = new FolderOutput(adapter.asAdapter, "site", ["Resume.pdf", "docs/b.pdf"]);
      await build(output, () => output.copy("Papers/Resume.pdf", "Resume.pdf"));
      assert.deepEqual([...adapter.files.keys()].sort(), ["Papers/Resume.pdf", "site/CNAME", "site/Resume.pdf", "site/index.html", "site/" + MARKER]);
      assert.deepEqual([...(adapter.files.get("site/Resume.pdf") ?? [])], [1, 2, 3]);
      assert.deepEqual([...adapter.folders].sort(), ["site"]);
    });

    it("stops for a folder at the path, and for a file where a folder of the path has to be", async () => {
      const withFolder = site([], ["docs/mine.txt"]);
      await assert.rejects(new FolderOutput(withFolder.asAdapter, "site", ["docs"]).prepare(), /"site\/docs" is there already/);
      const withFile = site([], ["docs"]);
      await assert.rejects(new FolderOutput(withFile.asAdapter, "site", ["docs/2026/a.pdf"]).prepare(), /"site\/docs" is there already.*"docs\/2026\/a\.pdf" cannot be put/);
      assert.equal(withFile.files.has("site/index.html"), true);
    });

    it("puts a file beside what is in the folders of its path, and where an extra file of before was a folder's name", async () => {
      const adapter = site(["docs"], ["papers/mine.txt"]);
      adapter.files.set("a.pdf", new Uint8Array([1]));
      adapter.files.set("b.pdf", new Uint8Array([2]));
      const output = new FolderOutput(adapter.asAdapter, "site", ["docs/a.pdf", "papers/b.pdf"]);
      await build(output, async () => {
        await output.copy("a.pdf", "docs/a.pdf");
        await output.copy("b.pdf", "papers/b.pdf");
      });
      assert.deepEqual([...adapter.files.keys()].sort(), ["a.pdf", "b.pdf", "site/docs/a.pdf", "site/index.html", "site/papers/b.pdf", "site/papers/mine.txt", "site/" + MARKER]);
      assert.equal(adapter.text("site/papers/mine.txt"), "of the person");
      assert.deepEqual([...adapter.folders].sort(), ["site", "site/docs", "site/papers"]);
    });

    it("finds nothing in the way in a folder that is new or empty", async () => {
      const adapter = new MemoryAdapter();
      await new FolderOutput(adapter.asAdapter, "site", ["Resume.pdf", "docs/a.pdf"], "first").prepare();
      // The folder of a build that broke off is taken away by the next one
      await new FolderOutput(adapter.asAdapter, "site", ["Resume.pdf", "docs/a.pdf"], "second").prepare();
      assert.deepEqual([...adapter.folders], [WORK, WORK + "/second"]);
    });
  });

  it("makes a folder once when many files want it at the same time", async () => {
    const adapter = new MemoryAdapter();
    const output = new FolderOutput(adapter.asAdapter, "site");
    await output.prepare();
    await Promise.all(Array.from({ length: 32 }, (_, i) => output.text(`data/n/${String(i)}.js`, "x")));
    assert.equal(adapter.files.size, 32);
    assert.equal(adapter.mkdirs, 4, "the folder that builds write in, the one of this build, and data and data/n in it");
  });

  it("writes a file again that was left empty", async () => {
    const adapter = new MemoryAdapter();
    const output = new FolderOutput(adapter.asAdapter, "site", [], TOKEN);
    await output.prepare();
    adapter.emptyOnce.add(MINE + "/a.js");
    await output.text("a.js", "content");
    assert.equal(adapter.text(MINE + "/a.js"), "content");
    assert.equal(adapter.writes, 2, "written, and written again");

    adapter.files.set("pic.png", new Uint8Array([1, 2, 3]));
    adapter.emptyOnce.add(MINE + "/assets/pic.png");
    await output.copy("pic.png", "assets/pic.png");
    assert.deepEqual([...(adapter.files.get(MINE + "/assets/pic.png") ?? [])], [1, 2, 3]);
    assert.equal(adapter.copies, 2, "copied, and copied again");
  });

  it("takes the page away first and never the marker, so that a folder half changed is no site and is still the plugin's", async () => {
    const adapter = new MemoryAdapter();
    for (const folder of ["site", "site/app", "site/data", "site/.git"]) {
      adapter.folders.add(folder);
    }
    adapter.files.set("site/" + MARKER, marker(["Resume.pdf"]));
    for (const file of ["site/index.html", "site/app/viewer.js", "site/data/index.js", "site/README.txt", "site/Resume.pdf", "site/.git/config"]) {
      adapter.files.set(file, new Uint8Array(3));
    }
    const broken = new FolderOutput(adapter.asAdapter, "site", [], "broken");
    await broken.prepare();
    await broken.text(MARKER, markerText("0.2.0", []));
    await broken.text("app/viewer.js", "new");
    await broken.text("index.html", "new");
    // Taking the folders of before away breaks off, as when the app is closed or a file is held by another program
    const rmdir = adapter.rmdir.bind(adapter);
    adapter.rmdir = () => Promise.reject(new Error("the folder is busy"));
    await assert.rejects(broken.finish(), /busy/);
    await broken.abort().catch(() => undefined);
    assert.equal(adapter.files.has("site/index.html"), false);
    assert.equal(readMarker(adapter.text("site/" + MARKER)) !== null, true);

    // The next build takes the folder for the site it is, and takes away what the one before left where it wrote
    adapter.rmdir = rmdir;
    await build(new FolderOutput(adapter.asAdapter, "site"));
    assert.deepEqual([...adapter.files.keys()].sort(), ["site/.git/config", "site/index.html", "site/" + MARKER]);
    assert.equal(adapter.text("site/" + MARKER), markerText("0.2.0", []));
    assert.deepEqual([...adapter.folders].sort(), ["site", "site/.git"]);
  });
});

describe("ZipOutput", () => {
  const long = "A line that repeats. ".repeat(500);

  it("writes one archive with everything in it", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set("Attachments/pic.png", new TextEncoder().encode("picture"));
    const output = new ZipOutput(adapter.asAdapter, "out/site", false);
    await output.prepare();
    await output.text("index.html", "<!doctype html>");
    await output.binary("data/n/a.js", new TextEncoder().encode(long).buffer);
    await output.copy("Attachments/pic.png", "assets/pic.png");
    const written = await output.finish();
    assert.equal(written.place, "out/site.zip");
    assert.equal(written.bytes, adapter.files.get("out/site.zip")?.length);
    assert.deepEqual(
      [...unzip(adapter.files.get("out/site.zip") ?? new Uint8Array(0))],
      [
        ["index.html", "<!doctype html>"],
        ["data/n/a.js", long],
        ["assets/pic.png", "picture"],
      ],
    );
    assert.equal(adapter.writes, 1, "a small archive is one write");
    assert.equal(adapter.appends, 0);
  });

  it("keeps every file whole when many are added at the same time", async () => {
    const adapter = new MemoryAdapter();
    const output = new ZipOutput(adapter.asAdapter, "site.zip", true, undefined, TOKEN);
    await output.prepare();
    const texts = Array.from({ length: 60 }, (_, i) => `note ${String(i)} ` + "x".repeat(i * 37));
    await Promise.all(texts.map((text, i) => output.text(`data/n/${String(i)}.js`, text)));
    await output.finish();
    const files = unzip(adapter.files.get("site.zip") ?? new Uint8Array(0));
    assert.equal(files.size, 60);
    for (const [i, text] of texts.entries()) {
      assert.equal(files.get(`data/n/${String(i)}.js`), text);
    }
  });

  it("writes a large archive in pieces, and it is the same archive", async () => {
    const adapter = new MemoryAdapter();
    const output = new ZipOutput(adapter.asAdapter, "site.zip", false, 4000, TOKEN);
    await output.prepare();
    // Text that does not get much smaller, so that the archive really grows past the size of a piece
    const noise = (seed: number): string => {
      let state = seed * 2654435761 + 1;
      return Array.from({ length: 3000 }, () => {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        return String.fromCharCode(33 + ((state >>> 16) % 90));
      }).join("");
    };
    for (let i = 0; i < 8; i++) {
      await output.text(`data/n/${String(i)}.js`, noise(i));
    }
    const written = await output.finish();
    assert.ok(adapter.appends >= 3, "the archive grew by appends");
    const zip = adapter.files.get("site.zip") ?? new Uint8Array(0);
    assert.equal(written.bytes, zip.length);
    const files = unzip(zip);
    assert.equal(files.size, 8);
    assert.equal(files.get("data/n/5.js"), noise(5));
  });

  it("writes over the archive of the build before", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set("site.zip", new Uint8Array(50_000));
    const output = new ZipOutput(adapter.asAdapter, "site.zip", true, undefined, TOKEN);
    await output.prepare();
    await output.text("index.html", "new");
    await output.finish();
    assert.deepEqual([...unzip(adapter.files.get("site.zip") ?? new Uint8Array(0))], [["index.html", "new"]]);
  });

  it("writes the archive again when it was left empty", async () => {
    const adapter = new MemoryAdapter();
    adapter.emptyOnce.add(MINE + "/site.zip");
    const output = new ZipOutput(adapter.asAdapter, "site.zip", true, undefined, TOKEN);
    await output.prepare();
    await output.text("index.html", "content");
    await output.finish();
    assert.equal(adapter.writes, 2, "written, and written again");
    assert.deepEqual([...unzip(adapter.files.get("site.zip") ?? new Uint8Array(0))], [["index.html", "content"]]);
  });

  it("refuses a name that is a folder, and no name at all", async () => {
    const adapter = new MemoryAdapter();
    adapter.folders.add("Notes.zip");
    await assert.rejects(new ZipOutput(adapter.asAdapter, "Notes.zip", true).prepare(), /is a folder/);
    await assert.rejects(new ZipOutput(adapter.asAdapter, "", true).prepare(), /needs a name/);
  });

  it("keeps the archive of the build before until the new one is whole", async () => {
    const adapter = new MemoryAdapter();
    const before = new TextEncoder().encode("the archive of before");
    adapter.files.set("site.zip", before);
    const output = new ZipOutput(adapter.asAdapter, "site.zip", true, 1000, TOKEN);
    await output.prepare();
    await output.text("data/n/a.js", "x".repeat(50));
    await output.binary("assets/noise.png", new Uint8Array(5000).map((_, i) => (i * 7919) & 0xff).buffer);
    assert.deepEqual(adapter.files.get("site.zip"), before, "still there while the new one is written");
    assert.ok(adapter.files.has(MINE + "/site.zip"));
    await output.abort();
    assert.deepEqual(adapter.files.get("site.zip"), before, "and after the build was given up");
    assert.deepEqual([...adapter.files.keys()], ["site.zip"]);
    assert.deepEqual([...adapter.folders], [], "the folder that builds write in is gone as well");
  });

  it("adds nothing after a failure, and does not end as an archive", async () => {
    const adapter = new MemoryAdapter();
    const output = new ZipOutput(adapter.asAdapter, "site.zip", true, undefined, TOKEN);
    await output.prepare();
    await output.text("index.html", "first");
    await assert.rejects(output.copy("missing.png", "assets/missing.png"), /no such file/);
    await assert.rejects(output.text("data/n/a.js", "after the failure"), /no such file/);
    await assert.rejects(output.finish(), /no such file/);
    await output.abort();
    assert.deepEqual([...adapter.files.keys()], []);
  });

  it("does not write over a file that no build of the plugin wrote", async () => {
    const adapter = new MemoryAdapter();
    const backup = new TextEncoder().encode("a backup of the person");
    adapter.files.set("Backups/vault.zip", backup);
    adapter.folders.add("Backups");
    await assert.rejects(new ZipOutput(adapter.asAdapter, "Backups/vault", false).prepare(), /did not write/);
    assert.deepEqual(adapter.files.get("Backups/vault.zip"), backup);
  });

  it("does not write over a file that came to its place while the site was built", async () => {
    const adapter = new MemoryAdapter();
    const output = new ZipOutput(adapter.asAdapter, "site.zip", false, undefined, TOKEN);
    await output.prepare();
    await output.text("index.html", "new");
    const theirs = new TextEncoder().encode("put there in the meantime");
    adapter.files.set("site.zip", theirs);
    let claims = 0;
    const claim = (): Promise<void> => {
      claims++;
      return Promise.resolve();
    };
    await assert.rejects(output.finish(claim), /did not write/);
    await output.abort();
    assert.equal(claims, 0, "the place is not claimed");
    assert.deepEqual([...adapter.files], [["site.zip", theirs]]);
  });

  it("claims its place right before the archive stands there", async () => {
    const adapter = new MemoryAdapter();
    const seen: string[][] = [];
    const claim = (): Promise<void> => {
      seen.push([...adapter.files.keys()]);
      return Promise.resolve();
    };
    // A new archive, and one over the archive of a build before
    for (const mayReplace of [false, true]) {
      const output = new ZipOutput(adapter.asAdapter, "site.zip", mayReplace, undefined, TOKEN);
      await output.prepare();
      await output.text("index.html", mayReplace ? "second" : "first");
      await output.finish(claim);
    }
    assert.deepEqual(seen, [[MINE + "/site.zip"], ["site.zip", MINE + "/site.zip"]]);
    assert.deepEqual([...adapter.folders], []);
    assert.deepEqual([...unzip(adapter.files.get("site.zip") ?? new Uint8Array(0))], [["index.html", "second"]]);
  });

  it("puts the archive of before back when the new one cannot get its name", async () => {
    const adapter = new MemoryAdapter();
    const before = new TextEncoder().encode("the archive of before");
    adapter.files.set("site.zip", before);
    const output = new ZipOutput(adapter.asAdapter, "site.zip", true, undefined, TOKEN);
    await output.prepare();
    await output.text("index.html", "new");
    // It can be neither moved nor copied there
    adapter.failRename = (from) => from === MINE + "/site.zip";
    adapter.failCopy = true;
    await assert.rejects(output.finish(), /busy/);
    await output.abort();
    assert.deepEqual(adapter.files.get("site.zip"), before);
    assert.deepEqual([...adapter.files.keys()], ["site.zip"]);
  });

  it("copies the archive to its place when it cannot be moved there, as onto another disk", async () => {
    const adapter = new MemoryAdapter();
    adapter.folders.add("out");
    adapter.files.set("out/site.zip", new TextEncoder().encode("the archive of before"));
    const output = new ZipOutput(adapter.asAdapter, "out/site.zip", true, undefined, TOKEN);
    await output.prepare();
    await output.text("index.html", "new");
    adapter.failRename = (from) => from === MINE + "/site.zip";
    const written = await output.finish();
    assert.deepEqual([...adapter.files.keys()], ["out/site.zip"]);
    assert.equal(written.bytes, adapter.files.get("out/site.zip")?.length);
    assert.deepEqual([...unzip(adapter.files.get("out/site.zip") ?? new Uint8Array(0))], [["index.html", "new"]]);
    assert.deepEqual([...adapter.folders], ["out"]);
  });

  it("takes away an archive that a build set aside and broke off, whatever it drew by chance, and no file of the person", async () => {
    const adapter = new MemoryAdapter();
    for (const rest of ["site.zip.v2s-old-0ld0ne00", "site.zip.v2s-old", "site.zip.v2s-older", "other.zip.v2s-old-0ld0ne00", "notes.md"]) {
      adapter.files.set(rest, new Uint8Array(100));
    }
    const output = new ZipOutput(adapter.asAdapter, "site.zip", true, undefined, TOKEN);
    await output.prepare();
    // An archive that was set aside may be the only one there is: it stays until the new one stands
    assert.equal(adapter.files.size, 5);
    await output.text("index.html", "new");
    await output.finish();
    assert.deepEqual([...adapter.files.keys()].sort(), ["notes.md", "other.zip.v2s-old-0ld0ne00", "site.zip", "site.zip.v2s-older"]);
  });
});

describe("isSiteArchive", () => {
  /** An archive as a build writes it: the marker first */
  const built = async (adapter: MemoryAdapter, path: string, first: [string, string]): Promise<void> => {
    const output = new ZipOutput(adapter.asAdapter, path, false);
    await output.prepare();
    await output.text(first[0], first[1]);
    await output.text("index.html", "<!doctype html>");
    await output.finish();
  };

  it("knows an archive that a build of this plugin wrote by its marker", async () => {
    const adapter = new MemoryAdapter();
    await built(adapter, "site.zip", [MARKER, markerText("0.1.0", [])]);
    assert.equal(await isSiteArchive(adapter.asAdapter, "site.zip"), true);
    await built(adapter, "out/long.zip", [MARKER, markerText("0.1.0", Array.from({ length: 40 }, (_, i) => `papers/paper ${String(i)}.pdf`))]);
    assert.equal(await isSiteArchive(adapter.asAdapter, "out/long.zip"), true);
  });

  it("takes no other file for one", async () => {
    const adapter = new MemoryAdapter();
    assert.equal(await isSiteArchive(adapter.asAdapter, "none.zip"), false);
    adapter.folders.add("folder.zip");
    assert.equal(await isSiteArchive(adapter.asAdapter, "folder.zip"), false);
    adapter.files.set("backup.zip", new TextEncoder().encode("a backup of the person, which is no archive at all"));
    assert.equal(await isSiteArchive(adapter.asAdapter, "backup.zip"), false);
    adapter.files.set("empty.zip", new Uint8Array(0));
    assert.equal(await isSiteArchive(adapter.asAdapter, "empty.zip"), false);
    // An archive of something else, one with the marker not at its start, and one of a vault with the settings of a run
    await built(adapter, "other.zip", ["notes.txt", "notes"]);
    assert.equal(await isSiteArchive(adapter.asAdapter, "other.zip"), false);
    await built(adapter, "later.zip", ["index.html", markerText("0.1.0", [])]);
    assert.equal(await isSiteArchive(adapter.asAdapter, "later.zip"), false);
    await built(adapter, "vault.zip", [MARKER, '{"ticks": {"on": [""]}, "format": "zip"}']);
    assert.equal(await isSiteArchive(adapter.asAdapter, "vault.zip"), false);
  });
});
