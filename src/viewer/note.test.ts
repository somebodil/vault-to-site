import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findHeading, headingKey } from "./note.ts";

describe("headingKey", () => {
  it("is the letters and digits in lower case, with one space where anything else stands", () => {
    assert.equal(headingKey("Step 1: Install"), "step 1 install");
    assert.equal(headingKey("  What's new — and why?  "), "what s new and why");
    assert.equal(headingKey("설치 (macOS)"), "설치 macos");
    assert.equal(headingKey("?!"), "");
  });
});

describe("findHeading", () => {
  const headings = ["Step 1: Install", "step 1 install", "Use", "?!"];
  const same = (heading: string): string => heading;

  it("takes the heading that is written the same before one that only compares the same", () => {
    assert.equal(findHeading(headings, same, "step 1 install"), "step 1 install");
    assert.equal(findHeading(headings, same, "Step 1: Install"), "Step 1: Install");
  });

  it("finds a heading that is named in other letters and without its signs", () => {
    assert.equal(findHeading(headings, same, "STEP 1 - install"), "Step 1: Install");
    assert.equal(findHeading(headings, same, "use"), "Use");
  });

  it("finds nothing for a name that is in no heading, or that is made of signs only", () => {
    assert.equal(findHeading(headings, same, "Remove"), null);
    assert.equal(findHeading(headings, same, "!!"), null);
    assert.equal(findHeading(headings, same, "?!"), "?!");
  });
});
