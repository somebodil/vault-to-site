import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileAddress } from "../site-format.ts";
import { layOutFiles } from "./files.ts";

describe("layOutFiles", () => {
  it("copies a file the notes use into assets, and lists it at its path in the vault", () => {
    const layout = layOutFiles(["Note.md"], ["Pictures/a b.PNG"], []);
    const id = layout.ids.get("Pictures/a b.PNG") ?? "";
    assert.deepEqual(layout.copies, [["Pictures/a b.PNG", `assets/${id}.png`]]);
    assert.equal(layout.addresses.get("Pictures/a b.PNG"), `assets/${id}.png`);
    assert.deepEqual(layout.entries, { [id]: { p: "Pictures/a b.PNG", a: `assets/${id}.png` } });
  });

  it("lists a file at a path of its own at that path, and does not copy it into assets", () => {
    const layout = layOutFiles(["Note.md"], [], [{ to: "Resume.pdf", from: "Private/CV.pdf" }]);
    assert.deepEqual(layout.copies, []);
    assert.deepEqual(Object.values(layout.entries), [{ p: "Resume.pdf", a: "Resume.pdf" }]);
    // The path in the vault does not show in the site
    assert.equal(JSON.stringify(layout.entries).includes("Private"), false);
    // Only the notes and the files the notes use are named by their path in the vault
    assert.deepEqual([...layout.ids.keys()], ["Note.md"]);
  });

  it("gives a file at a path of its own an id of its own, also when a file the notes use has that path in the vault", () => {
    const layout = layOutFiles(["Resume.md"], ["Resume.pdf"], [{ to: "Resume.pdf", from: "Papers/Resume.pdf" }]);
    const ids = Object.keys(layout.entries);
    assert.equal(ids.length, 2);
    assert.equal(ids.includes(layout.ids.get("Resume.md") ?? ""), false);
    assert.deepEqual(layout.copies.map(([from]) => from), ["Resume.pdf"]);
  });

  it("has a file at a path of its own that the notes use as well once in the site, at that path", () => {
    const layout = layOutFiles(["Note.md"], ["Papers/My CV #2.pdf", "pic.png"], [{ to: "CV/My CV #2.pdf", from: "Papers/My CV #2.pdf" }]);
    const id = layout.ids.get("Papers/My CV #2.pdf") ?? "";
    assert.deepEqual(layout.copies.map(([from]) => from), ["pic.png"]);
    assert.equal(layout.addresses.get("Papers/My CV #2.pdf"), "CV/My%20CV%20%232.pdf");
    assert.deepEqual(layout.entries[id], { p: "CV/My CV #2.pdf", a: "CV/My CV #2.pdf" });
    assert.equal(Object.keys(layout.entries).length, 2);
  });

  it("puts a file named at two paths of its own at both, and the notes lead to the first", () => {
    const extra = [
      { to: "Resume.pdf", from: "CV.pdf" },
      { to: "old/Resume.pdf", from: "CV.pdf" },
    ];
    const layout = layOutFiles(["Note.md"], ["CV.pdf"], extra);
    assert.equal(layout.addresses.get("CV.pdf"), "Resume.pdf");
    assert.deepEqual(layout.copies, []);
    assert.deepEqual(Object.values(layout.entries).map((entry) => entry.p).sort(), ["Resume.pdf", "old/Resume.pdf"]);
  });

  it("gives the same ids in every build", () => {
    const one = layOutFiles(["b.md", "a.md"], ["x.png"], [{ to: "Resume.pdf", from: "CV.pdf" }]);
    const other = layOutFiles(["a.md", "b.md"], ["x.png"], [{ to: "Resume.pdf", from: "CV.pdf" }]);
    assert.deepEqual(one.entries, other.entries);
    assert.deepEqual([...one.ids].sort(), [...other.ids].sort());
  });
});

describe("fileAddress", () => {
  it("leaves a path of the site's own as it is", () => {
    assert.equal(fileAddress("assets/1abc.png"), "assets/1abc.png");
  });

  it("makes each part of a path fit for an address, and keeps the folders", () => {
    assert.equal(fileAddress("이력서/My CV #1 100%.pdf"), "%EC%9D%B4%EB%A0%A5%EC%84%9C/My%20CV%20%231%20100%25.pdf");
  });
});
