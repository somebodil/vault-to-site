import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { inflateRawSync } from "node:zlib";
import { crc32, isPackedAlready, ZipWriter, type Deflate } from "./zip.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function archive(files: [name: string, data: Uint8Array][], deflate?: Deflate): Promise<Uint8Array> {
  const pieces: Uint8Array[] = [];
  const zip = new ZipWriter(
    async (piece) => {
      pieces.push(piece.slice());
    },
    deflate,
    new Date(2026, 10, 24, 12, 30, 40),
  );
  for (const [name, data] of files) {
    await zip.add(name, data);
  }
  await zip.finish();
  const whole = Buffer.concat(pieces);
  return whole;
}

/** Reads an archive back by its list of files, as a program that opens it does */
function read(zip: Uint8Array): Map<string, { data: Uint8Array; method: number }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, { data: Uint8Array; method: number }>();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const bodyAt = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const body = zip.subarray(bodyAt, bodyAt + packed);
    const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body;
    assert.equal(data.length, size, name);
    assert.equal(crc32(data), crc, name);
    files.set(name, { data, method });
    at += 46 + nameLength;
  }
  return files;
}

describe("crc32", () => {
  it("is the checksum that every zip program computes", () => {
    assert.equal(crc32(bytes("")), 0);
    assert.equal(crc32(bytes("123456789")), 0xcbf43926);
    assert.equal(crc32(bytes("The quick brown fox jumps over the lazy dog")), 0x414fa339);
  });
});

describe("isPackedAlready", () => {
  it("knows pictures, fonts and archives by their ending", () => {
    assert.equal(isPackedAlready("assets/a.PNG"), true);
    assert.equal(isPackedAlready("app/res/x.woff2"), true);
    assert.equal(isPackedAlready("data/index.js"), false);
    assert.equal(isPackedAlready("noending"), false);
  });
});

describe("ZipWriter", () => {
  const text = "A line that repeats. ".repeat(200);

  it("writes files that read back as they were", async () => {
    const zip = await archive([
      ["index.html", bytes("<!doctype html>")],
      ["data/n/abc.js", bytes(text)],
      [".nojekyll", new Uint8Array(0)],
      ["assets/한글 이름.txt", bytes("한글")],
    ]);
    const files = read(zip);
    assert.deepEqual([...files.keys()], ["index.html", "data/n/abc.js", ".nojekyll", "assets/한글 이름.txt"]);
    assert.equal(new TextDecoder().decode(files.get("data/n/abc.js")?.data), text);
    assert.equal(new TextDecoder().decode(files.get("assets/한글 이름.txt")?.data), "한글");
    assert.equal(files.get(".nojekyll")?.data.length, 0);
  });

  it("makes text smaller, and leaves alone what would not get smaller", async () => {
    const noise = new Uint8Array(2000).map((_, i) => (i * 7919 + (i >> 3) * 104729) & 0xff);
    const zip = await archive([
      ["text.js", bytes(text)],
      ["tiny.js", bytes("x")],
      ["picture.png", bytes(text)],
      ["noise.bin", noise],
    ]);
    const files = read(zip);
    assert.equal(files.get("text.js")?.method, 8);
    assert.equal(files.get("tiny.js")?.method, 0);
    assert.equal(files.get("picture.png")?.method, 0);
    assert.ok(zip.length < text.length * 2);
  });

  it("stores everything where the browser cannot deflate", async () => {
    const zip = await archive([["text.js", bytes(text)]], () => Promise.resolve(null));
    const files = read(zip);
    assert.equal(files.get("text.js")?.method, 0);
    assert.equal(new TextDecoder().decode(files.get("text.js")?.data), text);
  });

  it("takes files that were made ready side by side, in the order they are put", async () => {
    const pieces: Uint8Array[] = [];
    const zip = new ZipWriter(async (piece) => {
      pieces.push(piece.slice());
    });
    const ready = await Promise.all([zip.pack("b.js", bytes(text)), zip.pack("a.js", bytes("short")), zip.pack("c.png", bytes(text))]);
    for (const file of ready) {
      await zip.put(file);
    }
    await zip.finish();
    const files = read(Buffer.concat(pieces));
    assert.deepEqual([...files.keys()], ["b.js", "a.js", "c.png"]);
    assert.equal(new TextDecoder().decode(files.get("b.js")?.data), text);
    assert.equal(files.get("c.png")?.method, 0);
  });

  it("is an archive that other programs open", async () => {
    const zip = await archive([
      ["index.html", bytes("<!doctype html>")],
      ["data/n/abc.js", bytes(text)],
      ["assets/한글 이름.txt", bytes("한글")],
      [".nojekyll", new Uint8Array(0)],
    ]);
    const dir = mkdtempSync(join(tmpdir(), "v2s-zip-"));
    const file = join(dir, "site.zip");
    writeFileSync(file, zip);
    let unzip: string;
    try {
      unzip = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return; // No unzip on this machine: the reading above has to do
      }
      throw error;
    }
    assert.match(unzip, /No errors detected/);
    execFileSync("unzip", ["-q", file, "-d", join(dir, "out")]);
    assert.equal(readFileSync(join(dir, "out", "data/n/abc.js"), "utf8"), text);
    assert.equal(readFileSync(join(dir, "out", "assets/한글 이름.txt"), "utf8"), "한글");
  });
});
