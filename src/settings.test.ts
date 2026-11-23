import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS, followRename, outputOf, readSettings, type Settings } from "./settings.ts";

describe("readSettings", () => {
  it("gives the defaults for nothing saved", () => {
    assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(readSettings("nonsense"), DEFAULT_SETTINGS);
  });

  it("keeps what is of the right kind and drops the rest", () => {
    const read = readSettings({
      ticks: { on: ["Notes", 7, null], off: "no list" },
      exclude: "^Archive/",
      properties: 5,
      format: "folder",
      zip: "   ",
      folder: " out/site ",
      written: ["old.zip", 5],
    });
    assert.deepEqual(read.written, ["old.zip"]);
    assert.deepEqual(read.ticks, { on: ["Notes"], off: [] });
    assert.equal(read.exclude, "^Archive/");
    assert.equal(read.properties, DEFAULT_SETTINGS.properties);
    assert.equal(read.format, "folder");
    assert.equal(read.zip, DEFAULT_SETTINGS.zip);
    assert.equal(read.folder, "out/site");
  });

  it("writes an archive unless a folder was asked for", () => {
    assert.equal(readSettings({ format: "tar" }).format, "zip");
    assert.equal(readSettings({}).format, "zip");
  });

  it("keeps an empty list of property rules: no rule is a choice", () => {
    assert.equal(readSettings({ properties: "" }).properties, "");
  });
});

describe("outputOf", () => {
  it("is the archive or the folder, by the format", () => {
    assert.equal(outputOf({ ...DEFAULT_SETTINGS, format: "zip", zip: "a.zip", folder: "b" }), "a.zip");
    assert.equal(outputOf({ ...DEFAULT_SETTINGS, format: "folder", zip: "a.zip", folder: "b" }), "b");
  });
});

describe("followRename", () => {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ticks: { on: ["Guide"], off: ["Guide/Draft.md"] },
    zip: "out/site",
    folder: "out/web",
    written: ["out/site.zip", "out/web"],
  };

  it("moves the ticks, the record of what was written and the place of the next build with a folder above them", () => {
    const next = followRename(settings, "out", "public");
    assert.deepEqual(next.written, ["public/site.zip", "public/web"]);
    assert.equal(next.zip, "public/site.zip");
    assert.equal(next.folder, "public/web");
    assert.deepEqual(followRename(settings, "Guide", "Manual").ticks, { on: ["Manual"], off: ["Manual/Draft.md"] });
  });

  it("keeps an archive that was put aside the plugin's, and writes the next one where the setting says", () => {
    const next = followRename(settings, "out/site.zip", "backup/site of May.zip");
    assert.deepEqual(next.written, ["backup/site of May.zip", "out/web"]);
    assert.equal(next.zip, "out/site");
    assert.equal(followRename(settings, "out/web", "out/web of May").folder, "out/web");
  });

  it("is not moved by the names a build gives its archive on the way", () => {
    assert.equal(followRename(settings, "out/site.zip", "out/site.zip.v2s-old"), settings);
    assert.equal(followRename(settings, "out/site.zip.v2s-part", "out/site.zip"), settings);
    assert.equal(followRename(settings, "out/site.zip.v2s-old", "out/site.zip"), settings);
  });

  it("follows a rename to a name that only looks like one of those", () => {
    const some: Settings = { ...settings, ticks: { on: [""], off: ["Drafts"] } };
    assert.deepEqual(followRename(some, "Drafts", "Drafts.old").ticks, { on: [""], off: ["Drafts.old"] });
    assert.deepEqual(followRename({ ...some, ticks: { on: [""], off: ["Notes.old"] } }, "Notes.old", "Notes").ticks, { on: [""], off: ["Notes"] });
    assert.deepEqual(followRename(settings, "out/site.zip", "out/site.zip.old").written, ["out/site.zip.old", "out/web"]);
  });

  it("keeps what was decided inside a folder when Obsidian tells of the folder and of each thing in it", () => {
    const some: Settings = { ...settings, ticks: { on: ["", "Notes/Private/open.md"], off: ["Notes/Private", "Notes/diary.md"] } };
    const told: [string, string][] = [
      ["Notes", "Wiki"],
      ["Notes/Private", "Wiki/Private"],
      ["Notes/Private/open.md", "Wiki/Private/open.md"],
      ["Notes/Private/secret.md", "Wiki/Private/secret.md"],
      ["Notes/diary.md", "Wiki/diary.md"],
    ];
    const after = { on: ["", "Wiki/Private/open.md"], off: ["Wiki/Private", "Wiki/diary.md"] };
    // In the order from the folder down, and in the order from the notes up
    for (const order of [told, [...told].reverse()]) {
      const next = order.reduce((now, [from, to]) => followRename(now, from, to), some);
      assert.deepEqual(next.ticks, after);
    }
  });

  it("leaves the settings as they are for a rename elsewhere", () => {
    assert.deepEqual(followRename(settings, "Notes/a.md", "Notes/b.md"), settings);
  });
});
