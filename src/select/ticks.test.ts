import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAtOrUnder, missingLeftOut, movedPath, NO_TICKS, parentOf, renameTicks, setTick, ticker, type Ticks } from "./ticks.ts";

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

  it("leaves a path out that is in both lists, and lets the nearest one decide below it", () => {
    const isTicked = ticker({ on: ["", "Private", "Private/keep.md"], off: ["Private"] });
    assert.equal(isTicked("Private/z.md"), false);
    assert.equal(isTicked("Private/keep.md"), true);
    assert.equal(isTicked("a.md"), true);
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

describe("renameTicks", () => {
  const ticks: Ticks = { on: ["Notes", "Notes/Private/keep.md"], off: ["Notes/Private", "Notes/diary.md"] };

  it("keeps a renamed folder and a renamed note out of the site", () => {
    let renamed = renameTicks(ticks, "Notes/Private", "Notes/Personal");
    renamed = renameTicks(renamed, "Notes/diary.md", "Notes/journal.md");
    assert.deepEqual(renamed, { on: ["Notes", "Notes/Personal/keep.md"], off: ["Notes/Personal", "Notes/journal.md"] });
    const isTicked = ticker(renamed);
    assert.equal(isTicked("Notes/Personal/secret.md"), false);
    assert.equal(isTicked("Notes/journal.md"), false);
    assert.equal(isTicked("Notes/Personal/keep.md"), true);
  });

  it("follows a folder above the listed paths, and leaves other paths alone", () => {
    assert.deepEqual(renameTicks(ticks, "Notes", "Wiki"), { on: ["Wiki", "Wiki/Private/keep.md"], off: ["Wiki/Private", "Wiki/diary.md"] });
    assert.deepEqual(renameTicks(ticks, "Notes2", "Other"), ticks);
    assert.deepEqual(renameTicks(ticks, "Note", "Other"), ticks);
  });
});

describe("renameTicks onto a path that something was deleted from", () => {
  it("lets what moves there decide, so that a left-out note is not ticked by a tick of a note that is gone", () => {
    // Notes/old.md was ticked on its own and then deleted; a left-out note is moved onto its path
    const ticks: Ticks = { on: ["Notes", "Notes/old.md"], off: ["Notes/diary.md"] };
    const renamed = renameTicks(ticks, "Notes/diary.md", "Notes/old.md", true);
    assert.deepEqual(renamed, { on: ["Notes"], off: ["Notes/old.md"] });
    assert.equal(ticker(renamed)("Notes/old.md"), false);
  });

  it("does the same for a folder", () => {
    const ticks: Ticks = { on: ["", "Old/keep.md"], off: ["Private"] };
    assert.deepEqual(renameTicks(ticks, "Private", "Old", true), { on: [""], off: ["Old"] });
  });

  it("leaves what is decided for the new path alone when nothing was deleted there: it was moved there a moment ago", () => {
    // Obsidian has told of the folder, and tells of the note in it now
    const moved = renameTicks({ on: [""], off: ["Notes/diary.md"] }, "Notes", "Wiki");
    assert.deepEqual(renameTicks(moved, "Notes/diary.md", "Wiki/diary.md"), { on: [""], off: ["Wiki/diary.md"] });
  });
});

describe("missingLeftOut", () => {
  it("names the listed paths that are not in the vault", () => {
    const ticks: Ticks = { on: ["", "Gone"], off: ["Notes/Private", "Notes/old.md"] };
    const exists = (path: string): boolean => path === "Notes/Private";
    assert.deepEqual(missingLeftOut(ticks, exists), ["Notes/old.md"]);
  });
});

describe("movedPath", () => {
  it("is the new path for what was renamed and for what is inside it, else the same", () => {
    assert.equal(movedPath("site.zip", "site.zip", "old/site.zip"), "old/site.zip");
    assert.equal(movedPath("out/site.zip", "out", "public"), "public/site.zip");
    assert.equal(movedPath("outside/site.zip", "out", "public"), "outside/site.zip");
    assert.equal(movedPath("a.md", "", "x"), "a.md");
  });
});
