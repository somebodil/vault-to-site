import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hiddenBlocks } from "./fold.ts";

/** Blocks written as a string: a digit is a heading of that level, `p` is a paragraph, and `*` after a digit folds that heading */
function blocks(text: string): { level: number; isFolded: boolean }[] {
  const out: { level: number; isFolded: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === "*") {
      continue;
    }
    out.push({ level: char === "p" ? 0 : Number(char), isFolded: text.charAt(i + 1) === "*" });
  }
  return out;
}
const shown = (text: string): string =>
  hiddenBlocks(blocks(text))
    .map((hidden) => (hidden ? "-" : "+"))
    .join("");

describe("hiddenBlocks", () => {
  it("hides nothing when nothing is folded", () => {
    assert.equal(shown("1p2p3pp2p"), "+++++++++");
  });

  it("hides what follows a folded heading, up to the next heading of its level or above", () => {
    assert.equal(shown("1p2*p3pp2p"), "+++----++");
    assert.equal(shown("2*pp1p"), "+--++");
    assert.equal(shown("1*p2p3p"), "+-----");
  });

  it("keeps the heading itself in sight", () => {
    assert.equal(shown("2*"), "+");
    assert.equal(shown("2*2*2*"), "+++");
  });

  it("keeps what is folded inside a folded part folded when the part is opened", () => {
    assert.equal(shown("1*p2*pp"), "+----");
    assert.equal(shown("1p2*pp"), "+++--");
  });

  it("goes on after a folded part with a heading above its level", () => {
    assert.equal(shown("3*p2p"), "+-++");
    assert.equal(shown("2*p3*p1p"), "+---++");
  });
});
