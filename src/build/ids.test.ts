import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignIds, extensionOf, hashOf } from "./ids.ts";

describe("hashOf", () => {
  it("gives the same name for the same path, made of letters and digits only", () => {
    assert.equal(hashOf("Guide/한글 노트.md"), hashOf("Guide/한글 노트.md"));
    assert.match(hashOf("Guide/한글 노트.md"), /^[0-9a-z]+$/);
    assert.notEqual(hashOf("a.md"), hashOf("b.md"));
  });
});

describe("assignIds", () => {
  it("names every path, whatever the order they come in", () => {
    const one = assignIds(["b.md", "a.md", "c/d.png"]);
    const other = assignIds(["c/d.png", "a.md", "b.md"]);
    assert.equal(one.size, 3);
    assert.deepEqual([...one].sort(), [...other].sort());
    assert.equal(new Set(one.values()).size, 3);
  });
});

describe("extensionOf", () => {
  it("is the ending in lower case", () => {
    assert.equal(extensionOf("a/b.PNG"), "png");
    assert.equal(extensionOf("a.b/c"), "");
    assert.equal(extensionOf(".hidden"), "");
    assert.equal(extensionOf("x.tar.gz"), "gz");
  });
});
