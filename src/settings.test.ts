import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS, outputOf, readSettings } from "./settings.ts";

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
    });
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
