import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMentions, mentionFinder } from "./mentions.ts";

describe("findMentions", () => {
  const pages = [
    { path: "Home.md", text: "See the Hidden Plan for more.\nAnd (hidden plan) again, and Budget 2026." },
    { path: "Guide.md", text: "Nothing here. A plan that is hidden." },
    { path: "List.md", text: "Notes: Budget 2026, __README__, 가계부 11월" },
  ];

  it("finds a name whatever its case, and says in which notes", () => {
    assert.deepEqual(findMentions(pages, ["Private/Hidden Plan.md"]), [{ path: "Private/Hidden Plan.md", shownIn: ["Home.md"] }]);
  });

  it("finds names with digits, with signs at their start, and in other scripts", () => {
    const found = findMentions(pages, ["Money/Budget 2026.md", "Docs/__README__.md", "Money/가계부 11월.md"]);
    assert.deepEqual(found, [
      { path: "Docs/__README__.md", shownIn: ["List.md"] },
      { path: "Money/Budget 2026.md", shownIn: ["Home.md", "List.md"] },
      { path: "Money/가계부 11월.md", shownIn: ["List.md"] },
    ]);
  });

  it("does not take the words of a name apart", () => {
    assert.deepEqual(findMentions(pages, ["Plan Hidden.md"]), []);
  });

  it("does not find a name inside a longer word of the Latin script", () => {
    assert.deepEqual(findMentions([{ path: "a.md", text: "unplanned planet plans" }], ["plan.md"]), []);
    assert.deepEqual(findMentions([{ path: "a.md", text: "the plan." }], ["plan.md"]), [{ path: "plan.md", shownIn: ["a.md"] }]);
  });

  it("finds a name that a word goes on after, where the script adds endings without a space", () => {
    assert.deepEqual(findMentions([{ path: "a.md", text: "가계부를 본다" }], ["Money/가계부.md"]), [{ path: "Money/가계부.md", shownIn: ["a.md"] }]);
    assert.deepEqual(findMentions([{ path: "a.md", text: "새가계부" }], ["Money/가계부.md"]), []);
  });

  it("leaves very short names alone", () => {
    assert.deepEqual(findMentions([{ path: "a.md", text: "to do or not" }], ["to.md", "or.md"]), []);
  });

  it("finds nothing without names or without pages", () => {
    assert.deepEqual(findMentions(pages, []), []);
    assert.deepEqual(findMentions([], ["Private/Hidden Plan.md"]), []);
  });
});

describe("mentionFinder", () => {
  it("finds the same, page by page", () => {
    const finder = mentionFinder(["Private/Hidden Plan.md", "Money/Budget 2026.md"]);
    finder.add("b.md", "the Budget 2026");
    assert.deepEqual(finder.found(), [{ path: "Money/Budget 2026.md", shownIn: ["b.md"] }]);
    finder.add("a.md", "a hidden plan, and Budget 2026 again");
    assert.deepEqual(finder.found(), [
      { path: "Money/Budget 2026.md", shownIn: ["a.md", "b.md"] },
      { path: "Private/Hidden Plan.md", shownIn: ["a.md"] },
    ]);
  });
});
