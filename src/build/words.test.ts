import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shownValue, shownWords } from "./words.ts";

describe("shownWords", () => {
  it("shows the words of a link and not where it leads", () => {
    assert.equal(shownWords("See [[10_Private/Secret|the plan]] now"), "See the plan now");
    assert.equal(shownWords("[the plan](10_Private/Secret.md)"), "the plan");
    assert.equal(shownWords("[the plan](<10_Private/Secret plan.md>)"), "the plan");
    assert.equal(shownWords('[the plan](10_Private/Secret.md "title")'), "the plan");
    assert.equal(shownWords("[a (b)](Folder/Note_(1).md) end"), "a (b) end");
  });

  it("shows the name of the note for a link without other words, without its folders", () => {
    assert.equal(shownWords("[[10_Private/Secret]]"), "Secret");
    assert.equal(shownWords("[[Secret]] and [[Guide/Setup#Install]]"), "Secret and Setup > Install");
    assert.equal(shownWords("[[#Only heading]]"), "Only heading");
    assert.equal(shownWords("![[Attachments/pic.png]]"), "pic.png");
    assert.equal(shownWords("[[10_Private/Secret|]]"), "Secret");
  });

  it("reads the forms of a link that are written less often", () => {
    const cases: [written: string, shown: string][] = [
      ["[[Private/Secret|a [b] c]]", "a [b] c"],
      ["[[Private/Secret\\|in a table]]", "in a table"],
      ["[x](Private/Secret.md 'hint')", "x"],
      ["[x](Private/Secret.md (hint))", "x"],
      ["[x]( Private/Secret.md )", "x"],
      ["[a \\] b](Private/Secret.md)", "a \\] b"],
      ["[![i](a.png)](Private/Secret.md)", "i"],
      ["[x][ref] and ![y][other]", "x and y"],
      ['<a href="Private/Secret.md">x</a>', "x"],
      ["<Private/Secret.md>", ""],
    ];
    for (const [written, shown] of cases) {
      assert.equal(shownWords(written), shown, written);
    }
  });

  it("takes out an address that opens Obsidian or a file of the device, wherever it stands", () => {
    assert.equal(shownWords("see obsidian://open?vault=Work&file=Private%2FSecret now"), "see  now");
    assert.equal(shownWords("[open](obsidian://open?vault=Work&file=Private%2FSecret)"), "open");
    assert.equal(shownWords("at file:///Users/me/Vault/Private/x.png."), "at ");
    assert.equal(shownWords("https://example.com/a stays"), "https://example.com/a stays");
  });

  it("leaves nothing of a path behind for any of these", () => {
    for (const written of [
      "[[Private/Secret|a [b] c]]",
      "[x](Private/Secret.md 'hint')",
      "[![i](a.png)](Private/Secret.md)",
      '<a href="Private/Secret.md">x</a>',
      "obsidian://open?file=Private%2FSecret",
      "![[Private/Secret#Part|shown]]",
    ]) {
      assert.doesNotMatch(shownWords(written), /Private|Secret\.md|%2F/, written);
    }
  });

  it("shows a tag that holds only its name as the text it is", () => {
    assert.equal(shownWords("<script>window.x=1</script>"), "<script>window.x=1</script>");
    assert.equal(shownWords("a <b>bold</b> word<br/>"), "a <b>bold</b> word<br/>");
    assert.equal(shownWords('<b>kept</b> <a href="Private/Secret.md">x</a> <span data-at="Private/x">y</span>'), "<b>kept</b> x y");
  });

  it("leaves text without links as it is", () => {
    assert.equal(shownWords("a [b] c (d) [[ e"), "a [b] c (d) [[ e");
    assert.equal(shownWords("1 < 2 and 3 > 2"), "1 < 2 and 3 > 2");
    assert.equal(shownWords(""), "");
  });
});

describe("shownValue", () => {
  it("goes into lists and nested values, and leaves numbers and the rest alone", () => {
    assert.deepEqual(shownValue(["[[A/B|x]]", 3, true, null, { related: "[[C/D]]", n: [1, "[y](z.md)"] }]), ["x", 3, true, null, { related: "D", n: [1, "y"] }]);
  });
});
