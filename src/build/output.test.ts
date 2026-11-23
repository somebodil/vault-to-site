import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inflateRawSync } from "node:zlib";
import type { DataAdapter } from "obsidian";
import { FolderOutput, MARKER, ZipOutput, zipPath } from "./output.ts";

/** What the outputs use of the adapter of Obsidian, kept in memory */
class MemoryAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly folders = new Set<string>();
  /** Paths whose next write leaves an empty file, as Obsidian on Android does now and then */
  readonly emptyOnce = new Set<string>();
  writes = 0;
  appends = 0;

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
    const isIn = (other: string): boolean => other.startsWith(path + "/") && !other.slice(path.length + 1).includes("/");
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

  rename(from: string, to: string): Promise<void> {
    const file = this.files.get(from);
    if (file === undefined) {
      return Promise.reject(new Error("no such file: " + from));
    }
    this.files.delete(from);
    this.files.set(to, file);
    return Promise.resolve();
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(path);
    if (file === undefined) {
      return Promise.reject(new Error("no such file: " + path));
    }
    return Promise.resolve(file.slice().buffer);
  }

  copy(from: string, to: string): Promise<void> {
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

describe("zipPath", () => {
  it("ends with .zip, once", () => {
    assert.equal(zipPath("site"), "site.zip");
    assert.equal(zipPath("out/Site.ZIP"), "out/Site.ZIP");
  });
});

describe("FolderOutput", () => {
  it("writes files into folders that it makes", async () => {
    const adapter = new MemoryAdapter();
    const output = new FolderOutput(adapter.asAdapter, "out/site");
    await output.prepare();
    await output.text("index.html", "<!doctype html>");
    await output.text("data/n/a.js", "한글");
    assert.equal(adapter.text("out/site/index.html"), "<!doctype html>");
    assert.equal(adapter.text("out/site/data/n/a.js"), "한글");
    assert.ok(adapter.folders.has("out") && adapter.folders.has("out/site/data/n"));
    assert.deepEqual(await output.finish(), { place: "out/site", bytes: 15 + 6 });
  });

  it("takes away the site of an earlier build, and nothing else in its folder", async () => {
    const adapter = new MemoryAdapter();
    for (const folder of ["site", "site/data", "site/data/n", "site/.git"]) {
      adapter.folders.add(folder);
    }
    adapter.files.set("site/" + MARKER, new Uint8Array(2));
    adapter.files.set("site/index.html", new Uint8Array(3));
    adapter.files.set("site/data/n/old.js", new Uint8Array(3));
    adapter.files.set("site/.git/config", new Uint8Array(4));
    adapter.files.set("site/CNAME", new Uint8Array(5));
    await new FolderOutput(adapter.asAdapter, "site").prepare();
    assert.deepEqual([...adapter.files.keys()].sort(), ["site/.git/config", "site/CNAME"]);

    adapter.folders.add("Notes");
    adapter.files.set("Notes/keep.md", new Uint8Array(3));
    await assert.rejects(new FolderOutput(adapter.asAdapter, "Notes").prepare(), /not a site of this plugin/);
    assert.equal(adapter.files.has("Notes/keep.md"), true);
  });

  it("refuses the vault itself, and a path that is a file", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set("note.md", new Uint8Array(1));
    await assert.rejects(new FolderOutput(adapter.asAdapter, "").prepare(), /folder of its own/);
    await assert.rejects(new FolderOutput(adapter.asAdapter, "/").prepare(), /folder of its own/);
    await assert.rejects(new FolderOutput(adapter.asAdapter, "note.md").prepare(), /is a file/);
  });

  it("makes a folder once when many files want it at the same time", async () => {
    const adapter = new MemoryAdapter();
    const output = new FolderOutput(adapter.asAdapter, "site");
    await output.prepare();
    await Promise.all(Array.from({ length: 32 }, (_, i) => output.text(`data/n/${String(i)}.js`, "x")));
    assert.equal(adapter.files.size, 32);
    assert.equal(adapter.mkdirs, 3, "site, site/data and site/data/n");
  });

  it("writes a file again that was left empty", async () => {
    const adapter = new MemoryAdapter();
    const output = new FolderOutput(adapter.asAdapter, "site");
    await output.prepare();
    adapter.emptyOnce.add("site/a.js");
    await output.text("a.js", "content");
    assert.equal(adapter.text("site/a.js"), "content");
    assert.equal(output.rewritten, 1);

    adapter.files.set("pic.png", new Uint8Array([1, 2, 3]));
    adapter.emptyOnce.add("site/assets/pic.png");
    await output.copy("pic.png", "assets/pic.png");
    assert.deepEqual([...(adapter.files.get("site/assets/pic.png") ?? [])], [1, 2, 3]);
    assert.equal(output.rewritten, 2);
  });
});

describe("ZipOutput", () => {
  const long = "A line that repeats. ".repeat(500);

  it("writes one archive with everything in it", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set("Attachments/pic.png", new TextEncoder().encode("picture"));
    const output = new ZipOutput(adapter.asAdapter, "out/site");
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
    const output = new ZipOutput(adapter.asAdapter, "site.zip");
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
    const output = new ZipOutput(adapter.asAdapter, "site.zip", 4000);
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
    const output = new ZipOutput(adapter.asAdapter, "site.zip");
    await output.prepare();
    await output.text("index.html", "new");
    await output.finish();
    assert.deepEqual([...unzip(adapter.files.get("site.zip") ?? new Uint8Array(0))], [["index.html", "new"]]);
  });

  it("writes the archive again when it was left empty", async () => {
    const adapter = new MemoryAdapter();
    adapter.emptyOnce.add("site.zip.part");
    const output = new ZipOutput(adapter.asAdapter, "site.zip");
    await output.prepare();
    await output.text("index.html", "content");
    await output.finish();
    assert.equal(output.rewritten, 1);
    assert.deepEqual([...unzip(adapter.files.get("site.zip") ?? new Uint8Array(0))], [["index.html", "content"]]);
  });

  it("refuses a name that is a folder, and no name at all", async () => {
    const adapter = new MemoryAdapter();
    adapter.folders.add("Notes.zip");
    await assert.rejects(new ZipOutput(adapter.asAdapter, "Notes.zip").prepare(), /is a folder/);
    await assert.rejects(new ZipOutput(adapter.asAdapter, "").prepare(), /needs a name/);
  });

  it("keeps the archive of the build before until the new one is whole", async () => {
    const adapter = new MemoryAdapter();
    const before = new TextEncoder().encode("the archive of before");
    adapter.files.set("site.zip", before);
    const output = new ZipOutput(adapter.asAdapter, "site.zip", 1000);
    await output.prepare();
    await output.text("data/n/a.js", "x".repeat(50));
    await output.binary("assets/noise.png", new Uint8Array(5000).map((_, i) => (i * 7919) & 0xff).buffer);
    assert.deepEqual(adapter.files.get("site.zip"), before, "still there while the new one is written");
    assert.ok(adapter.files.has("site.zip.part"));
    await output.abort();
    assert.deepEqual(adapter.files.get("site.zip"), before, "and after the build was given up");
    assert.equal(adapter.files.has("site.zip.part"), false);
  });

  it("adds nothing after a failure, and does not end as an archive", async () => {
    const adapter = new MemoryAdapter();
    const output = new ZipOutput(adapter.asAdapter, "site.zip");
    await output.prepare();
    await output.text("index.html", "first");
    await assert.rejects(output.copy("missing.png", "assets/missing.png"), /no such file/);
    await assert.rejects(output.text("data/n/a.js", "after the failure"), /no such file/);
    await assert.rejects(output.finish(), /no such file/);
    await output.abort();
    assert.equal(adapter.files.has("site.zip"), false);
    assert.equal(adapter.files.has("site.zip.part"), false);
  });

  it("takes away what a build that broke off left behind", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set("site.zip.part", new Uint8Array(100));
    const output = new ZipOutput(adapter.asAdapter, "site.zip");
    await output.prepare();
    assert.equal(adapter.files.has("site.zip.part"), false);
  });
});
