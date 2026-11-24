import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findLines, foldedNameScore, foldName, haystack, inOrder, missingParts, nameScore } from "./find.ts";

describe("the parts of the texts", () => {
  it("names the parts that are not there, also behind the last one that is", () => {
    const parts: unknown[] = [];
    assert.deepEqual(missingParts(parts, 3), [0, 1, 2]);
    parts[2] = [];
    assert.deepEqual(missingParts(parts, 3), [0, 1]);
    parts[0] = [];
    parts[1] = [];
    assert.deepEqual(missingParts(parts, 3), []);
    assert.deepEqual(missingParts([], 0), []);
  });

  it("gives the texts in the order of the parts, whichever came first", () => {
    const parts: ReturnType<typeof haystack>[][] = [];
    parts[2] = [haystack("e", "five")];
    parts[0] = [haystack("a", "one"), haystack("b", "two")];
    assert.deepEqual(
      inOrder(parts).map((hay) => hay.id),
      ["a", "b", "e"],
    );
    parts[1] = [haystack("c", "three")];
    assert.deepEqual(
      inOrder(parts).map((hay) => hay.id),
      ["a", "b", "c", "e"],
    );
  });
});

describe("nameScore", () => {
  it("puts the whole name first, then the start, a word, the middle, and letters in order", () => {
    const scores = ["Setup", "Setup guide", "My setup", "Presetup", "S-e-t-u-p"].map((name) => nameScore("setup", name));
    assert.deepEqual(scores, [5, 4, 3, 2, 1]);
  });

  it("is the same for a name and what was typed that were put in lower case before", () => {
    for (const name of ["Setup", "Setup guide", "My setup", "Presetup", "S-e-t-u-p", "Other"]) {
      assert.equal(foldedNameScore(foldName("SetUp"), foldName(name)), nameScore(" SetUp ", name), name);
    }
  });

  it("is 0 for a name without the letters, and for nothing typed", () => {
    assert.equal(nameScore("xyz", "Setup"), 0);
    assert.equal(nameScore("  ", "Setup"), 0);
  });

  it("finds a name in another script", () => {
    assert.equal(nameScore("한글", "한글 노트"), 4);
  });
});

describe("haystack", () => {
  it("keeps the text as it is shown when lower case has the same length", () => {
    const hay = haystack("a", "Hello World");
    assert.equal(hay.text, "Hello World");
    assert.equal(hay.folded, "hello world");
  });

  it("shows the lower case where a letter changes its length", () => {
    const hay = haystack("a", "İstanbul");
    assert.equal(hay.text.length, hay.folded.length);
  });
});

describe("findLines", () => {
  const hay = haystack("n", "# Setup\n\nCopy the files.\nTurn the plugin on.\n    Copy the FILES again and again.");
  const found = (query: string, limit = 5): string[] => findLines(query, hay, limit).map((hit) => hit.text.slice(hit.start, hit.end));

  it("gives the lines that hold what was typed, whatever the case", () => {
    const hits = findLines("the files", hay, 5);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]?.text, "Copy the files.");
    assert.deepEqual(found("the files"), ["the files", "the FILES"]);
  });

  it("gives a line once, however often it holds the word", () => {
    assert.deepEqual(found("again"), ["again"]);
  });

  it("finds a match in the first and in the last line", () => {
    assert.deepEqual(found("# setup"), ["# Setup"]);
    assert.deepEqual(found("and again."), ["and again."]);
  });

  it("stops at the limit", () => {
    assert.equal(findLines("copy", hay, 1).length, 1);
  });

  it("falls back to lines with all of the words", () => {
    const hits = findLines("plugin turn", hay, 5);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.text, "Turn the plugin on.");
    assert.deepEqual(findLines("plugin nowhere", hay, 5), []);
  });

  it("marks the longest of the words in such a line, in whatever order they were typed", () => {
    for (const typed of ["turn plugin", "plugin turn"]) {
      const hit = findLines(typed, hay, 5)[0];
      assert.ok(hit !== undefined, typed);
      assert.equal(hit.text.slice(hit.start, hit.end), "plugin", typed);
    }
  });

  it("cuts a long line around the match", () => {
    const long = haystack("l", "x".repeat(300) + " needle " + "y".repeat(300));
    const hit = findLines("needle", long, 1)[0];
    assert.ok(hit !== undefined);
    assert.ok(hit.text.length <= 121);
    assert.equal(hit.text.slice(hit.start, hit.end), "needle");
  });

  it("shows the whole match at the very end of a long line", () => {
    const long = haystack("l", "x".repeat(200) + "NEEDLE");
    const hit = findLines("needle", long, 1)[0];
    assert.ok(hit !== undefined);
    assert.equal(hit.text.slice(hit.start, hit.end), "NEEDLE");
    assert.ok(hit.text.endsWith("NEEDLE"));
  });

  it("finds nothing for nothing typed, and in an empty text", () => {
    assert.deepEqual(findLines("", hay, 5), []);
    assert.deepEqual(findLines("x", haystack("e", ""), 5), []);
  });
});
