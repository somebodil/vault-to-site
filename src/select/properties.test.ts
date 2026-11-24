import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PROPERTY_RULES, invalidPropertyLines, matchingRule, parsePropertyRules, propertyProblems } from "./properties.ts";

describe("parsePropertyRules", () => {
  it("reads one rule a line and skips what is not a rule", () => {
    assert.deepEqual(parsePropertyRules("type: private\n\n  publish :false \nnot a rule\n: no key"), [
      { key: "type", value: "private" },
      { key: "publish", value: "false" },
    ]);
  });

  it("keeps a colon in the value", () => {
    assert.deepEqual(parsePropertyRules("url: http://x"), [{ key: "url", value: "http://x" }]);
  });

  it("starts with the rules for private notes and for notes not to publish", () => {
    assert.deepEqual(parsePropertyRules(DEFAULT_PROPERTY_RULES), [
      { key: "type", value: "private" },
      { key: "publish", value: "false" },
    ]);
  });
});

describe("invalidPropertyLines", () => {
  it("names the lines that were meant as a rule and are not one", () => {
    assert.deepEqual(invalidPropertyLines("type: private\n\n  type = private \nprivate\n: x\ndraft:"), ["type = private", "private", ": x"]);
    assert.deepEqual(invalidPropertyLines(DEFAULT_PROPERTY_RULES), []);
    assert.deepEqual(invalidPropertyLines(""), []);
  });
});

describe("matchingRule", () => {
  it("takes a key with no value as every note that has the property", () => {
    const rules = parsePropertyRules("draft:");
    assert.deepEqual(matchingRule({ draft: null }, rules), { key: "draft", value: "" });
    assert.deepEqual(matchingRule({ Draft: "yes" }, rules), { key: "draft", value: "" });
    assert.deepEqual(matchingRule({ draft: [] }, rules), { key: "draft", value: "" });
    assert.equal(matchingRule({ type: "draft" }, rules), null);
  });

  const rules = parsePropertyRules(DEFAULT_PROPERTY_RULES);

  it("finds a note with the property", () => {
    assert.deepEqual(matchingRule({ type: "private" }, rules), { key: "type", value: "private" });
    assert.deepEqual(matchingRule({ publish: false }, rules), { key: "publish", value: "false" });
  });

  it("does not care about upper and lower case or about spaces around", () => {
    assert.notEqual(matchingRule({ Type: " Private " }, rules), null);
  });

  it("looks into a property that is a list", () => {
    assert.notEqual(matchingRule({ type: ["knowledge", "private"] }, rules), null);
  });

  it("finds a plain value and a key whose letters are stored as their parts", () => {
    const written = parsePropertyRules("종류: 비공개");
    assert.notEqual(matchingRule({ 종류: "비공개".normalize("NFD") }, written), null);
    assert.notEqual(matchingRule({ ["종류".normalize("NFD")]: "비공개" }, written), null);
    assert.notEqual(matchingRule({ 종류: "비공개" }, parsePropertyRules("종류: 비공개".normalize("NFD"))), null);
    assert.equal(matchingRule({ 종류: "공개".normalize("NFD") }, written), null);
  });

  it("lets other notes through", () => {
    assert.equal(matchingRule(undefined, rules), null);
    assert.equal(matchingRule({}, rules), null);
    assert.equal(matchingRule({ type: "knowledge", publish: true }, rules), null);
    assert.equal(matchingRule({ type: "privately" }, rules), null);
  });
});

describe("a value that is a regular expression", () => {
  it("is one when it is written between slashes", () => {
    const [rule, plain, empty] = parsePropertyRules("type: /^(private|meta)$/\npath: /a\nnote: //");
    assert.equal(rule?.value, "/^(private|meta)$/");
    assert.equal(rule?.pattern?.source, "^(private|meta)$");
    assert.equal(rule?.pattern?.flags, "i");
    // One slash, or two with nothing between them, are plain text
    assert.deepEqual(plain, { key: "path", value: "/a" });
    assert.deepEqual(empty, { key: "note", value: "//" });
  });

  it("meets a property when the expression finds something in what it holds", () => {
    const rules = parsePropertyRules("type: /^(private|meta)$/");
    assert.notEqual(matchingRule({ type: "private" }, rules), null);
    assert.notEqual(matchingRule({ Type: " META " }, rules), null);
    assert.equal(matchingRule({ type: "privately" }, rules), null);
    assert.equal(matchingRule({ type: "knowledge" }, rules), null);
    assert.equal(matchingRule({ kind: "private" }, rules), null);
    // Without anchors, a part is enough
    assert.notEqual(matchingRule({ type: "privately" }, parsePropertyRules("type: /private/")), null);
  });

  it("is tried on each item of a list by itself", () => {
    const rules = parsePropertyRules("tags: /^draft/");
    assert.notEqual(matchingRule({ tags: ["idea", "draft/2026"] }, rules), null);
    assert.equal(matchingRule({ tags: ["idea", "not-draft"] }, rules), null);
    assert.equal(matchingRule({ tags: [] }, rules), null);
  });

  it("reads what is not text as it is written", () => {
    assert.notEqual(matchingRule({ year: 2026 }, parsePropertyRules("year: /^20\\d\\d$/")), null);
    assert.notEqual(matchingRule({ publish: false }, parsePropertyRules("publish: /^(false|no)$/")), null);
  });

  it("matches letters that are stored as their parts", () => {
    const rules = parsePropertyRules("kind: /^비공개/".normalize("NFD"));
    assert.notEqual(matchingRule({ kind: "비공개 메모".normalize("NFD") }, rules), null);
    assert.notEqual(matchingRule({ kind: "비공개 메모".normalize("NFC") }, rules), null);
  });

  it("is no rule when the expression is not valid, and the line is named", () => {
    const input = "type: /(/\npublish: false\ntags: /[a-/\nkind: /ok/";
    assert.deepEqual(
      parsePropertyRules(input).map((rule) => rule.key),
      ["publish", "kind"],
    );
    assert.deepEqual(propertyProblems(input), ['"type: /(/" does not hold a valid regular expression.', '"tags: /[a-/" does not hold a valid regular expression.']);
    assert.deepEqual(invalidPropertyLines(input), []);
  });
});

describe("a regular expression with flags", () => {
  it("takes the flags i, m, s and u after the last slash", () => {
    const [same, dot, all] = parsePropertyRules("type: /^(private|meta)$/i\nnote: /a.b/s\nkind: /^\\p{Lu}/msu");
    assert.equal(same?.pattern?.source, "^(private|meta)$");
    assert.equal(same?.pattern?.flags, "i");
    assert.equal(dot?.pattern?.flags, "is");
    assert.equal(all?.pattern?.flags, "imsu");
    assert.equal(same?.value, "/^(private|meta)$/i");
    assert.deepEqual(propertyProblems("type: /^(private|meta)$/i\nnote: /a.b/s\nkind: /^\\p{Lu}/msu"), []);
  });

  it("keeps out with them as without them", () => {
    const rules = parsePropertyRules("type: /^(private|meta)$/i");
    assert.notEqual(matchingRule({ type: "private" }, rules), null);
    assert.notEqual(matchingRule({ Type: " META " }, rules), null);
    assert.equal(matchingRule({ type: "knowledge" }, rules), null);
    // With `s` a dot is also the end of a line, and with `m` a line of a value has its own start
    assert.notEqual(matchingRule({ note: "a\nb" }, parsePropertyRules("note: /a.b/s")), null);
    assert.equal(matchingRule({ note: "a\nb" }, parsePropertyRules("note: /a.b/")), null);
    assert.notEqual(matchingRule({ note: "one\ntwo" }, parsePropertyRules("note: /^two/m")), null);
  });

  it("is no rule with any other letter after the last slash, and the line is named", () => {
    const input = "type: /private/g\ntags: /^draft/y\nkind: /x/I\nstate: /a/ii\npath: /usr/bin\npublish: false";
    assert.deepEqual(parsePropertyRules(input), [{ key: "publish", value: "false" }]);
    const notFlags = (line: string): string => `"${line}" has letters after its last slash that are not flags of a rule: only i, m, s and u are.`;
    assert.deepEqual(propertyProblems(input), [
      notFlags("type: /private/g"),
      notFlags("tags: /^draft/y"),
      notFlags("kind: /x/I"),
      // A flag that is given twice is not a valid expression, as in JavaScript
      '"state: /a/ii" does not hold a valid regular expression.',
      notFlags("path: /usr/bin"),
    ]);
  });

  it("leaves a value that only has slashes in it plain text", () => {
    assert.deepEqual(parsePropertyRules("a: /x\nb: //\nc: //i\nd: x/y/i\ne: /2026/11\nf: /a/b.c"), [
      { key: "a", value: "/x" },
      { key: "b", value: "//" },
      { key: "c", value: "//i" },
      { key: "d", value: "x/y/i" },
      { key: "e", value: "/2026/11" },
      { key: "f", value: "/a/b.c" },
    ]);
    assert.deepEqual(propertyProblems("a: /x\nb: //\nc: //i\nd: x/y/i\ne: /2026/11\nf: /a/b.c"), []);
  });
});

describe("propertyProblems", () => {
  it("says what is wrong with each line that is not a rule that works", () => {
    assert.deepEqual(propertyProblems("type: private\nprivate\ntype: /(/"), [
      '"private" is not a property: write it as key: value.',
      '"type: /(/" does not hold a valid regular expression.',
    ]);
    assert.deepEqual(propertyProblems(DEFAULT_PROPERTY_RULES), []);
    assert.deepEqual(propertyProblems(""), []);
  });
});
