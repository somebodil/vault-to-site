import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PROPERTY_RULES, matchingRule, parsePropertyRules } from "./properties.ts";

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

describe("matchingRule", () => {
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

  it("lets other notes through", () => {
    assert.equal(matchingRule(undefined, rules), null);
    assert.equal(matchingRule({}, rules), null);
    assert.equal(matchingRule({ type: "knowledge", publish: true }, rules), null);
    assert.equal(matchingRule({ type: "privately" }, rules), null);
  });
});
