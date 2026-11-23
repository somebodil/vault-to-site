import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SiteIndex } from "../site-format.ts";
import { buildTree, firstNote } from "./tree.ts";

function index(notes: Record<string, string>, files: Record<string, string> = {}): SiteIndex {
  return {
    name: "Vault",
    notes: Object.fromEntries(Object.entries(notes).map(([id, p]) => [id, { p, h: [], l: [] }])),
    files: Object.fromEntries(Object.entries(files).map(([id, p]) => [id, { p, a: "assets/" + id }])),
    searchParts: 0,
    theme: "light",
    inlineTitle: true,
    bodyStyle: "",
    icons: {},
  };
}

describe("buildTree", () => {
  const site = index(
    { a: "Zeta.md", b: "Guide/Setup.md", c: "Guide/Deep/Nested.md", d: "Guide/10 ten.md", e: "Guide/2 two.md", f: "alpha.md" },
    { g: "Attachments/pic.png", h: "Guide/readme", i: "Guide/.hidden" },
  );
  const root = buildTree(site);

  it("puts folders first and sorts names without regard to case, numbers by their value", () => {
    assert.deepEqual(
      root.folders.map((folder) => folder.name),
      ["Attachments", "Guide"],
    );
    assert.deepEqual(
      root.items.map((item) => item.name),
      ["alpha", "Zeta"],
    );
    const guide = root.folders[1];
    assert.deepEqual(
      guide?.items.map((item) => item.name),
      [".hidden", "2 two", "10 ten", "readme", "Setup"],
    );
  });

  it("shows a note without .md, and a file with its ending as a tag", () => {
    assert.deepEqual(root.folders[0]?.items, [{ id: "g", name: "pic", tag: "PNG" }]);
    const guide = root.folders[1];
    assert.deepEqual(
      guide?.items.filter((item) => item.id === "h" || item.id === "i"),
      [
        { id: "i", name: ".hidden", tag: "" },
        { id: "h", name: "readme", tag: "" },
      ],
    );
  });

  it("makes the folders in between", () => {
    assert.equal(root.folders[1]?.folders[0]?.path, "Guide/Deep");
    assert.equal(root.folders[1]?.folders[0]?.items[0]?.id, "c");
  });
});

describe("firstNote", () => {
  it("is the first note at the top, before any folder", () => {
    const site = index({ a: "Zeta.md", b: "Guide/Setup.md", f: "alpha.md" });
    assert.equal(firstNote(buildTree(site), site), "f");
  });

  it("skips files that are not notes and goes into folders", () => {
    const site = index({ b: "Guide/Setup.md" }, { g: "a.png" });
    assert.equal(firstNote(buildTree(site), site), "b");
  });

  it("is null for a site without notes", () => {
    const site = index({}, { g: "a.png" });
    assert.equal(firstNote(buildTree(site), site), null);
  });
});
