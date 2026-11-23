import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shownValue, shownWords } from "./words.ts";

describe("shownWords", () => {
  it("shows the words of a link and not where it leads", () => {
    assert.equal(shownWords("See [[10_Private/Secret|the plan]] now"), "See the plan now");
    assert.equal(shownWords("[the plan](10_Private/Secret.md)"), "the plan");
    assert.equal(shownWords("[the plan](<10_Private/Secret plan.md>)"), "the plan");
    assert.equal(shownWords('[the plan](obsidian://open?vault=V&file=10_Private%2FSecret "title")'), "the plan");
    assert.equal(shownWords("[a (b)](Folder/Note_(1).md) end"), "a (b) end");
  });

  it("shows the name of the note for a link without other words, without its folders", () => {
    assert.equal(shownWords("[[10_Private/Secret]]"), "Secret");
    assert.equal(shownWords("[[Secret]] and [[Guide/Setup#Install]]"), "Secret and Setup > Install");
    assert.equal(shownWords("[[#Only heading]]"), "Only heading");
    assert.equal(shownWords("![[Attachments/pic.png]]"), "pic.png");
    assert.equal(shownWords("[[10_Private/Secret|]]"), "Secret");
  });

  it("leaves text without links as it is", () => {
    assert.equal(shownWords("a [b] c (d) [[ e"), "a [b] c (d) [[ e");
    assert.equal(shownWords(""), "");
  });
});

describe("shownValue", () => {
  it("goes into lists and nested values, and leaves numbers and the rest alone", () => {
    assert.deepEqual(shownValue(["[[A/B|x]]", 3, true, null, { related: "[[C/D]]", n: [1, "[y](z.md)"] }]), ["x", 3, true, null, { related: "D", n: [1, "y"] }]);
  });
});
