import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findLines, nameScore } from "./find.ts";

describe("nameScore", () => {
  it("puts the whole name first, then the start, a word, the middle, and letters in order", () => {
    const scores = ["Setup", "Setup guide", "My setup", "Presetup", "S-e-t-u-p"].map((name) => nameScore("setup", name));
    assert.deepEqual(scores, [5, 4, 3, 2, 1]);
  });

  it("is 0 for a name without the letters, and for nothing typed", () => {
    assert.equal(nameScore("xyz", "Setup"), 0);
    assert.equal(nameScore("  ", "Setup"), 0);
  });

  it("finds a name in another script", () => {
    assert.equal(nameScore("한글", "한글 노트"), 4);
  });
});

describe("findLines", () => {
  const text = "# Setup\n\nCopy the files.\nTurn the plugin on.\n    Copy the FILES again and again.";

  it("gives the lines that hold what was typed, whatever the case", () => {
    const hits = findLines("the files", text, 5);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]?.text, "Copy the files.");
    assert.equal(hits[0]?.text.slice(hits[0].start, hits[0].end), "the files");
    assert.equal(hits[1]?.text.slice(hits[1].start, hits[1].end), "the FILES");
  });

  it("stops at the limit", () => {
    assert.equal(findLines("copy", text, 1).length, 1);
  });

  it("falls back to lines with all of the words", () => {
    const hits = findLines("plugin turn", text, 5);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.text, "Turn the plugin on.");
  });

  it("cuts a long line around the match", () => {
    const long = "x".repeat(300) + " needle " + "y".repeat(300);
    const hit = findLines("needle", long, 1)[0];
    assert.ok(hit !== undefined);
    assert.ok(hit.text.length <= 121);
    assert.equal(hit.text.slice(hit.start, hit.end), "needle");
  });

  it("finds nothing for nothing typed", () => {
    assert.deepEqual(findLines("", text, 5), []);
  });
});
