import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { folderState, isAtOrUnder, NO_TICKS, parentOf, setTick, ticker, type Ticks } from "./ticks.ts";

describe("parentOf", () => {
  it("is the folder a path is in, and the root for a top-level path", () => {
    assert.equal(parentOf("a/b/c.md"), "a/b");
    assert.equal(parentOf("c.md"), "");
    assert.equal(parentOf(""), null);
  });
});

describe("isAtOrUnder", () => {
  it("does not take a folder for another one that starts with its name", () => {
    assert.equal(isAtOrUnder("Notes/a.md", "Notes"), true);
    assert.equal(isAtOrUnder("Notes", "Notes"), true);
    assert.equal(isAtOrUnder("Notes2/a.md", "Notes"), false);
    assert.equal(isAtOrUnder("anything", ""), true);
  });
});

describe("ticker", () => {
  it("ticks nothing to begin with", () => {
    assert.equal(ticker(NO_TICKS)("a.md"), false);
  });

  it("gives a path what the nearest listed folder above it has", () => {
    const ticks: Ticks = { on: ["Notes", "Notes/Private/keep.md"], off: ["Notes/Private"] };
    const isTicked = ticker(ticks);
    assert.equal(isTicked("Notes/a.md"), true);
    assert.equal(isTicked("Notes/deep/er/b.md"), true);
    assert.equal(isTicked("Notes/Private/secret.md"), false);
    assert.equal(isTicked("Notes/Private/keep.md"), true);
    assert.equal(isTicked("Other/c.md"), false);
  });

  it("ticks everything when the root is ticked", () => {
    const isTicked = ticker({ on: [""], off: ["Private"] });
    assert.equal(isTicked("a.md"), true);
    assert.equal(isTicked("x/y.md"), true);
    assert.equal(isTicked("Private/z.md"), false);
  });
});

describe("setTick", () => {
  it("keeps a decision only where it differs from the folder above", () => {
    let ticks = setTick(NO_TICKS, "Notes", true);
    assert.deepEqual(ticks, { on: ["Notes"], off: [] });
    ticks = setTick(ticks, "Notes/a.md", true);
    assert.deepEqual(ticks, { on: ["Notes"], off: [] });
    ticks = setTick(ticks, "Notes/a.md", false);
    assert.deepEqual(ticks, { on: ["Notes"], off: ["Notes/a.md"] });
    ticks = setTick(ticks, "Notes/a.md", true);
    assert.deepEqual(ticks, { on: ["Notes"], off: [] });
  });

  it("forgets what was decided inside a folder when the folder is set", () => {
    let ticks: Ticks = { on: ["Notes", "Notes/Private/keep.md"], off: ["Notes/Private"] };
    ticks = setTick(ticks, "Notes", false);
    assert.deepEqual(ticks, NO_TICKS);
    ticks = setTick({ on: ["Notes/a.md", "Notes2/b.md"], off: [] }, "Notes", true);
    assert.deepEqual(ticks, { on: ["Notes", "Notes2/b.md"], off: [] });
  });

  it("sets the whole vault from the root", () => {
    const ticks = setTick({ on: ["a.md"], off: [] }, "", true);
    assert.deepEqual(ticks, { on: [""], off: [] });
    assert.deepEqual(setTick(ticks, "", false), NO_TICKS);
  });
});

describe("folderState", () => {
  it("is on, off or some by the files inside", () => {
    const isTicked = ticker({ on: ["a.md", "b.md"], off: [] });
    assert.equal(folderState(["a.md", "b.md"], isTicked, false), "on");
    assert.equal(folderState(["a.md", "c.md"], isTicked, false), "some");
    assert.equal(folderState(["c.md"], isTicked, false), "off");
  });

  it("takes the tick of the folder itself when the folder is empty", () => {
    assert.equal(folderState([], () => false, true), "on");
    assert.equal(folderState([], () => false, false), "off");
  });
});
