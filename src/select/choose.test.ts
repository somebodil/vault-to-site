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

describe("choose with only marked notes", () => {
  const some: VaultFile[] = [
    { path: "a.md", isNote: true, properties: { publish: true }, uses: ["pic.png", "b.md"] },
    { path: "b.md", isNote: true, uses: ["other.png"] },
    { path: "c.md", isNote: true, properties: { publish: "true", type: "private" } },
    { path: "d.md", isNote: true, properties: { publish: false } },
    { path: "e.md", isNote: true, unread: "its properties cannot be read" },
    { path: "pic.png", isNote: false },
    { path: "other.png", isNote: false },
  ];
  const marked = (only: string): ChoiceRules => ({ ...rules([""]), only: parsePropertyRules(only) });

  it("takes in a ticked note only when it has the mark", () => {
    const choice = choose(some, marked("publish: true"));
    assert.deepEqual(choice.notes, ["a.md"]);
    assert.deepEqual(choice.unmarked, ["b.md"]);
    // Only the files of the notes that go in
    assert.deepEqual(choice.files, ["pic.png"]);
    assert.deepEqual(choice.cut, [{ from: "a.md", to: "b.md" }]);
  });

  it("lets a rule that keeps out win over the mark", () => {
    const choice = choose(some, marked("publish: true"));
    assert.deepEqual(choice.byProperty.map((x) => x.path), ["c.md", "d.md"]);
    assert.deepEqual(choice.unread.map((x) => x.path), ["e.md"]);
  });

  it("takes a key alone for every note that has the property", () => {
    assert.deepEqual(choose(some, { ...rules([""]), properties: [], only: parsePropertyRules("publish:") }).notes, ["a.md", "c.md", "d.md"]);
  });

  it("takes every ticked note when there is no such rule", () => {
    const choice = choose(some, marked(""));
    assert.deepEqual(choice.notes, ["a.md", "b.md"]);
    assert.deepEqual(choice.unmarked, []);
  });
});

describe("choose with only the paths that are named", () => {
  const some: VaultFile[] = [
    { path: "Guide/Setup.md", isNote: true, uses: ["Attachments/pic.png", "Notes/Plan.md"] },
    { path: "Guide/Draft.md", isNote: true, properties: { publish: false } },
    { path: "Guide/Private/Key.md", isNote: true },
    { path: "Notes/Plan.md", isNote: true, uses: ["Attachments/plan.png"] },
    { path: "Notes/Unread.md", isNote: true, unread: "its properties cannot be read" },
    { path: "Guide/Unread.md", isNote: true, unread: "its properties cannot be read" },
    { path: "Attachments/pic.png", isNote: false },
    { path: "Attachments/plan.png", isNote: false },
  ];
  const named = (include: string, exclude = ""): ChoiceRules => ({ ...rules([""], [], exclude), include: parseExcludeRules(include) });

  it("takes in a ticked note only when a pattern matches its path", () => {
    const choice = choose(some, named("^guide/"));
    assert.deepEqual(choice.notes, ["Guide/Private/Key.md", "Guide/Setup.md"]);
    assert.deepEqual(choice.unnamed, ["Notes/Plan.md", "Notes/Unread.md"]);
    assert.deepEqual(choice.cut, [{ from: "Guide/Setup.md", to: "Notes/Plan.md" }]);
  });

  it("asks no pattern of a file that is not a note: it comes with the note that uses it", () => {
    const choice = choose(some, named("^Guide/"));
    assert.deepEqual(choice.files, ["Attachments/pic.png"]);
  });

  it("lets a rule that keeps out win over a pattern that takes in", () => {
    const choice = choose(some, named("^Guide/", "/Private/"));
    assert.deepEqual(choice.notes, ["Guide/Setup.md"]);
    assert.deepEqual(choice.byPattern, ["Guide/Private/Key.md"]);
    assert.deepEqual(choice.byProperty.map((x) => x.path), ["Guide/Draft.md"]);
    // A note that is named and whose properties are not known stays out, and is said to be so
    assert.deepEqual(choice.unread.map((x) => x.path), ["Guide/Unread.md"]);
  });

  it("does not take in what is not ticked", () => {
    const choice = choose(some, { ...rules(["Notes"]), include: parseExcludeRules("^Guide/, Plan") });
    assert.deepEqual(choice.notes, ["Notes/Plan.md"]);
    assert.deepEqual(choice.unnamed, ["Notes/Unread.md"]);
  });

  it("works together with the mark of a property", () => {
    const marked: VaultFile[] = [
      { path: "Guide/a.md", isNote: true, properties: { publish: true } },
      { path: "Guide/b.md", isNote: true },
      { path: "Notes/c.md", isNote: true, properties: { publish: true } },
    ];
    const choice = choose(marked, { ...named("^Guide/"), only: parsePropertyRules("publish: true") });
    assert.deepEqual(choice.notes, ["Guide/a.md"]);
    assert.deepEqual(choice.unnamed, ["Notes/c.md"]);
    assert.deepEqual(choice.unmarked, ["Guide/b.md"]);
  });

  it("takes every ticked note when there is no pattern", () => {
    assert.deepEqual(choose(some, named("")).unnamed, []);
    assert.deepEqual(choose(some, named("")).notes, choose(some, rules([""])).notes);
  });

  it("still guards the names of the notes a rule is meant for", () => {
    assert.deepEqual(choose(some, named("^Notes/")).guarded, ["Guide/Draft.md", "Guide/Unread.md", "Notes/Unread.md"]);
  });
});

describe("choose with a property rule that is a regular expression", () => {
  const some: VaultFile[] = [
    { path: "a.md", isNote: true, properties: { type: "knowledge" } },
    { path: "b.md", isNote: true, properties: { type: "private" } },
    { path: "c.md", isNote: true, properties: { type: "meta" } },
    { path: "d.md", isNote: true },
  ];

  it("keeps out by it, and takes in only by it", () => {
    const out = choose(some, { ...rules([""]), properties: parsePropertyRules("type: /^(private|meta)$/") });
    assert.deepEqual(out.notes, ["a.md", "d.md"]);
    assert.deepEqual(out.byProperty.map((x) => [x.path, x.rule.value]), [
      ["b.md", "/^(private|meta)$/"],
      ["c.md", "/^(private|meta)$/"],
    ]);
    const only = choose(some, { ...rules([""]), properties: [], only: parsePropertyRules("type: /^know/") });
    assert.deepEqual(only.notes, ["a.md"]);
    assert.deepEqual(only.unmarked, ["b.md", "c.md", "d.md"]);
  });
});

describe("signatureOf", () => {
  it("is the same for the same notes and files, and another for others", () => {
    const one = choose(files, rules(["Home.md", "Guide"]));
    assert.equal(signatureOf(one), signatureOf(choose(files, rules(["Guide", "Home.md"]))));
    assert.notEqual(signatureOf(one), signatureOf(choose(files, rules(["Home.md"]))));
  });

  it("is another when a file goes in at a path of its own, or another one does", () => {
    const one = choose(files, rules(["Home.md"]));
    const withExtra = { ...one, extra: [{ to: "Resume.pdf", from: "Private/Resume.pdf" }] };
    assert.notEqual(signatureOf(one), signatureOf(withExtra));
    assert.notEqual(signatureOf(withExtra), signatureOf({ ...one, extra: [{ to: "Resume.pdf", from: "Private/Other.pdf" }] }));
    assert.equal(signatureOf(one), signatureOf({ ...one, extra: [] }));
  });

  /** What a sign looks like: 16 digits to the base of 16 */
  const SIGNATURE = /^[0-9a-f]{16}$/;

  it("is short, however many notes there are", () => {
    const many = Array.from({ length: 5000 }, (_, i) => `Notes/A folder of some length/Note number ${String(i)} with a name.md`);
    const large = { ...choose(files, rules([""])), notes: many };
    assert.match(signatureOf(large), SIGNATURE);
    assert.equal(signatureOf(large).length, 16);
    assert.match(signatureOf(choose([], rules([]))), SIGNATURE);
    // One note more, one less, one with another name, and two that changed places
    const others = [[...many, "Z.md"], many.slice(1), ["Notes/Other.md", ...many.slice(1)], [many[1] ?? "", many[0] ?? "", ...many.slice(2)]];
    const signs = new Set([signatureOf(large), ...others.map((notes) => signatureOf({ ...large, notes }))]);
    assert.equal(signs.size, 5);
    // A note is not a file: the same path in the other list is another site
    assert.notEqual(signatureOf({ ...large, notes: [], files: ["a"] }), signatureOf({ ...large, notes: ["a"], files: [] }));
  });
});
