import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { choose, signatureOf, type ChoiceRules, type VaultFile } from "./choose.ts";
import { parseExcludeRules } from "./exclude.ts";
import { DEFAULT_PROPERTY_RULES, parsePropertyRules } from "./properties.ts";

const files: VaultFile[] = [
  { path: "Home.md", isNote: true, uses: ["Guide/Setup.md", "Private/Secrets.md", "Attachments/pic.png", "Attachments/scan.pdf"] },
  { path: "Guide/Setup.md", isNote: true, uses: ["Home.md", "Private/Ledger.md"] },
  { path: "Guide/Draft.md", isNote: true, properties: { publish: false } },
  { path: "Private/Secrets.md", isNote: true, properties: { type: "private" }, uses: ["Attachments/secret.png"] },
  { path: "Private/Ledger.md", isNote: true },
  { path: "Private/statement.csv", isNote: false },
  { path: "Attachments/pic.png", isNote: false },
  { path: "Attachments/scan.pdf", isNote: false },
  { path: "Attachments/secret.png", isNote: false },
  { path: "Attachments/unused.png", isNote: false },
];

function rules(on: string[], off: string[] = [], exclude = ""): ChoiceRules {
  return { ticks: { on, off }, exclude: parseExcludeRules(exclude), properties: parsePropertyRules(DEFAULT_PROPERTY_RULES) };
}

describe("choose", () => {
  it("holds nothing when nothing is ticked", () => {
    const choice = choose(files, rules([]));
    assert.deepEqual(choice.notes, []);
    assert.deepEqual(choice.files, []);
  });

  it("takes the ticked notes and the files they use", () => {
    const choice = choose(files, rules(["Home.md", "Guide"]));
    assert.deepEqual(choice.notes, ["Guide/Setup.md", "Home.md"]);
    assert.deepEqual(choice.files, ["Attachments/pic.png", "Attachments/scan.pdf"]);
  });

  it("keeps a note with a property of the rules out, whatever is ticked", () => {
    const choice = choose(files, rules([""]));
    assert.equal(choice.notes.includes("Private/Secrets.md"), false);
    assert.equal(choice.notes.includes("Guide/Draft.md"), false);
    assert.deepEqual(
      choice.byProperty.map((x) => [x.path, x.rule.key]),
      [
        ["Guide/Draft.md", "publish"],
        ["Private/Secrets.md", "type"],
      ],
    );
  });

  it("takes no file by a tick: with the whole vault ticked, only what a note of the site uses goes in", () => {
    const choice = choose(files, rules([""]));
    assert.deepEqual(choice.files, ["Attachments/pic.png", "Attachments/scan.pdf"]);
    // Not the picture of the private note, not the file in the folder of private notes, not the picture that no note uses
    for (const path of ["Attachments/secret.png", "Private/statement.csv", "Attachments/unused.png"]) {
      assert.equal(choice.files.includes(path), false, path);
    }
  });

  it("takes no file that is ticked by its own path either", () => {
    const choice = choose(files, rules(["Attachments/unused.png", "Private/statement.csv", "Attachments"]));
    assert.deepEqual(choice.notes, []);
    assert.deepEqual(choice.files, []);
  });

  it("does not take a file that only a note outside the site uses", () => {
    const choice = choose(files, rules(["Guide"]));
    assert.deepEqual(choice.notes, ["Guide/Setup.md"]);
    assert.deepEqual(choice.files, []);
  });

  it("never pulls in a note, and says which links are cut", () => {
    const choice = choose(files, rules(["Home.md", "Guide"]));
    assert.deepEqual(choice.cut, [
      { from: "Guide/Setup.md", to: "Private/Ledger.md" },
      { from: "Home.md", to: "Private/Secrets.md" },
    ]);
  });

  it("lets a pattern win over a tick, for notes and for files that are used", () => {
    const choice = choose(files, rules([""], [], "^Private/, \\.pdf$"));
    assert.deepEqual(choice.notes, ["Guide/Setup.md", "Home.md"]);
    assert.deepEqual(choice.files, ["Attachments/pic.png"]);
    assert.deepEqual(choice.byPattern, ["Attachments/scan.pdf", "Private/Ledger.md", "Private/Secrets.md"]);
    // A note kept out by a pattern is not also listed for its property
    assert.deepEqual(
      choice.byProperty.map((x) => x.path),
      ["Guide/Draft.md"],
    );
    assert.equal(
      choice.cut.some((x) => x.to === "Attachments/scan.pdf"),
      true,
    );
  });

  it("leaves a folder out of a ticked folder", () => {
    const choice = choose(files, rules([""], ["Private"]));
    assert.deepEqual(choice.notes, ["Guide/Setup.md", "Home.md"]);
    assert.deepEqual(choice.byProperty.map((x) => x.path), ["Guide/Draft.md"]);
  });

  it("keeps a note out whose properties are not known, and says why", () => {
    const some: VaultFile[] = [
      { path: "a.md", isNote: true },
      { path: "broken.md", isNote: true, unread: "its properties cannot be read" },
      { path: "pic.png", isNote: false },
      { path: "c.md", isNote: true, uses: ["pic.png"], unread: "Obsidian has not read it yet" },
    ];
    const choice = choose(some, rules([""]));
    assert.deepEqual(choice.notes, ["a.md"]);
    assert.deepEqual(choice.unread, [
      { path: "broken.md", why: "its properties cannot be read" },
      { path: "c.md", why: "Obsidian has not read it yet" },
    ]);
    // The picture that only such a note uses stays out with it
    assert.deepEqual(choice.files, []);
  });

  it("keeps a canvas or a base out, and cuts the link to it", () => {
    const some: VaultFile[] = [
      { path: "a.md", isNote: true, uses: ["Board.canvas", "pic.png"] },
      { path: "Board.canvas", isNote: false, undrawn: true },
      { path: "Rows.base", isNote: false, undrawn: true },
      { path: "pic.png", isNote: false },
    ];
    const choice = choose(some, rules([""]));
    assert.deepEqual(choice.files, ["pic.png"]);
    assert.deepEqual(choice.cut, [{ from: "a.md", to: "Board.canvas" }]);
  });

  it("names every note a rule is meant for, ticked or not", () => {
    const choice = choose(files, rules(["Home.md"], [], "^Drafts/"));
    assert.deepEqual(choice.guarded, ["Guide/Draft.md", "Private/Secrets.md"]);
    assert.deepEqual(choose([...files, { path: "Drafts/x.md", isNote: true }], rules(["Home.md"], [], "^Drafts/")).guarded, [
      "Drafts/x.md",
      "Guide/Draft.md",
      "Private/Secrets.md",
    ]);
  });

  it("matches a path whose letters are stored as their parts", () => {
    const stored = "비공개/메모.md".normalize("NFD");
    const choice = choose([{ path: stored, isNote: true }], rules([""], [], "^비공개/"));
    assert.deepEqual(choice.notes, []);
    assert.deepEqual(choice.byPattern, [stored]);
  });
});

describe("signatureOf", () => {
  it("is the same for the same notes and files, and another for others", () => {
    const one = choose(files, rules(["Home.md", "Guide"]));
    assert.equal(signatureOf(one), signatureOf(choose(files, rules(["Guide", "Home.md"]))));
    assert.notEqual(signatureOf(one), signatureOf(choose(files, rules(["Home.md"]))));
  });
});
