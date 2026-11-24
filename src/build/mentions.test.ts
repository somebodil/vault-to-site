import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mentionFinder, type Mention } from "./mentions.ts";

/** What a finder finds in pages that are all there */
function findMentions(pages: readonly { path: string; text: string }[], keptOut: readonly string[]): Mention[] {
  const finder = mentionFinder(keptOut);
  for (const page of pages) {
    finder.add(page.path, page.text);
  }
  return finder.found();
}

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

  it("finds a name in Latin letters or a date that an ending of another script follows", () => {
    const keptOut = ["Daily/2026-11-24.md", "Money/Budget.md"];
    assert.deepEqual(findMentions([{ path: "a.md", text: "2026-11-24에 정리했고 Budget를 본다" }], keptOut), [
      { path: "Daily/2026-11-24.md", shownIn: ["a.md"] },
      { path: "Money/Budget.md", shownIn: ["a.md"] },
    ]);
    // A longer word of the Latin script, or a longer number, is still another word
    assert.deepEqual(findMentions([{ path: "a.md", text: "Budgets and 2026-11-245" }], keptOut), []);
  });

  it("looks through each text from its start, also after a look that ended early", () => {
    const finder = mentionFinder(["Private/Plan.md"]);
    assert.equal(finder.names("the plan of a long text that goes on"), true);
    assert.equal(finder.names("plan"), true);
    finder.add("a.md", "plan");
    assert.deepEqual(finder.found(), [{ path: "Private/Plan.md", shownIn: ["a.md"] }]);
  });

  it("leaves very short names alone", () => {
    assert.deepEqual(findMentions([{ path: "a.md", text: "to do or not" }], ["to.md", "or.md"]), []);
  });

  it("finds nothing without names or without pages", () => {
    assert.deepEqual(findMentions(pages, []), []);
    assert.deepEqual(findMentions([], ["Private/Hidden Plan.md"]), []);
  });
});

describe("names written in other ways", () => {
  it("finds a name whose letters are stored as their parts", () => {
    const stored = "Private/비밀계획.md".normalize("NFD");
    assert.deepEqual(findMentions([{ path: "a.md", text: "오늘 비밀계획 회의" }], [stored]), [{ path: stored, shownIn: ["a.md"] }]);
  });

  it("finds a name with two spaces or a space that does not break", () => {
    assert.deepEqual(findMentions([{ path: "a.md", text: "the Hidden Plan" }], ["Hidden  Plan.md", "Hidden\u00a0Plan.md"]), [
      { path: "Hidden  Plan.md", shownIn: ["a.md"] },
      { path: "Hidden\u00a0Plan.md", shownIn: ["a.md"] },
    ]);
  });

  it("finds one of many names that start with the same word, as the notes of the days of a year", () => {
    const days = Array.from({ length: 365 }, (_, i) => `Daily/2024-${String(1 + Math.floor(i / 31)).padStart(2, "0")}-${String(1 + (i % 31)).padStart(2, "0")}.md`);
    const found = findMentions([{ path: "a.md", text: "in 2024 and 2023, see 2024-03-07 and 2024-13-01." }], days);
    assert.deepEqual(found, [{ path: "Daily/2024-03-07.md", shownIn: ["a.md"] }]);
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

describe("mentionFinder.names", () => {
  it("says whether a text holds one of the names, and keeps nothing of it", () => {
    const finder = mentionFinder(["Private/Diary 2026.md", "Private/Plan.md"]);
    assert.equal(finder.names("Diary 2026"), true);
    assert.equal(finder.names("the diary 2026 of mine"), true);
    assert.equal(finder.names("Settings"), false);
    assert.equal(finder.names("planet"), false);
    assert.deepEqual(finder.found(), []);
  });
});
