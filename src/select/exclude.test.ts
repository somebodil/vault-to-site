import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExcludeRules, splitPatterns } from "./exclude.ts";

describe("splitPatterns", () => {
  const cases: [input: string, expected: string[]][] = [
    ["", []],
    [" , ,", []],
    ["^Archive/", ["^Archive/"]],
    ["^Archive/,\\.png$", ["^Archive/", "\\.png$"]],
    [" ^Archive/ , png$ ", ["^Archive/", "png$"]],
    ["a\\,b, c", ["a\\,b", "c"]],
    ["[a,b]c, d", ["[a,b]c", "d"]],
    ["[\\],], x", ["[\\],]", "x"]],
    ["\\d{1,3}, x{2,}, y", ["\\d{1,3}", "x{2,}", "y"]],
    ["a{,b", ["a{", "b"]],
    ["a{x,3}", ["a{x", "3}"]],
  ];
  for (const [input, expected] of cases) {
    it(`splits ${JSON.stringify(input)}`, () => {
      assert.deepEqual(splitPatterns(input), expected);
    });
  }
});

describe("parseExcludeRules", () => {
  const hides = (input: string, path: string): boolean =>
    parseExcludeRules(input).patterns.some((pattern) => pattern.test(path));

  it("has no patterns for an empty input", () => {
    assert.deepEqual(parseExcludeRules("  "), { patterns: [], hasInvalid: false });
  });

  it("matches a path with any of the patterns, ignoring case", () => {
    assert.equal(hides("^Archive/, png$", "Archive/a.md"), true);
    assert.equal(hides("^archive/, png$", "Archive/a.md"), true);
    assert.equal(hides("^Archive/, png$", "img/a.PNG"), true);
    assert.equal(hides("^Archive/, png$", "Notes/png.md"), false);
    assert.equal(hides("^Archive/", "Notes/Archive/a.md"), false);
    assert.equal(hides("(^|/)_templates/", "a/_templates/b.md"), true);
  });

  it("reports an invalid pattern and keeps the valid ones", () => {
    const rules = parseExcludeRules("^a/, (unclosed");
    assert.equal(rules.hasInvalid, true);
    assert.deepEqual(
      rules.patterns.map((pattern) => pattern.source),
      ["^a\\/"],
    );
  });
});

describe("patterns with groups, and names written in two ways", () => {
  it("does not split at a comma inside a group", () => {
    assert.deepEqual(splitPatterns("^(Private,Secret)/, \\.pdf$"), ["^(Private,Secret)/", "\\.pdf$"]);
    assert.deepEqual(splitPatterns("^(a|(b,c))d, e"), ["^(a|(b,c))d", "e"]);
    assert.deepEqual(splitPatterns("[(],x"), ["[(]", "x"]);
  });

  it("matches a name whose letters are stored as their parts", () => {
    const rules = parseExcludeRules("^비공개/".normalize("NFD"));
    assert.equal(rules.patterns[0]?.test("비공개/a.md".normalize("NFC")), true);
  });
});

