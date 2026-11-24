import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noteAddress } from "../site-format.ts";
import { findHeading, headingKey, noteOfAddress, sameAddress } from "./note.ts";

describe("noteOfAddress", () => {
  it("is the note the address names, with or without a heading", () => {
    assert.equal(noteOfAddress("#/abc", "first"), "abc");
    assert.equal(noteOfAddress(noteAddress("abc", "Step 1: a/b"), "first"), "abc");
  });

  it("is the note the site opens with for an address that names none", () => {
    assert.equal(noteOfAddress("", "first"), "first");
    assert.equal(noteOfAddress("#", "first"), "first");
    assert.equal(noteOfAddress("#/", "first"), "first");
    assert.equal(noteOfAddress("#fn-1", "first"), "first");
    assert.equal(noteOfAddress("", ""), "");
  });
});

describe("sameAddress", () => {
  it("is true for the same note and heading, however the heading is written", () => {
    assert.equal(sameAddress("#/abc", "#/abc"), true);
    assert.equal(sameAddress(noteAddress("abc", "설치 (macOS)"), "#/abc/설치 (macOS)"), true);
    assert.equal(sameAddress(noteAddress("abc", "50% off"), "#/abc/50%25%20off"), true);
  });

  it("is false for another note, another heading, or a heading against none", () => {
    assert.equal(sameAddress("#/abc", "#/abd"), false);
    assert.equal(sameAddress("#/abc/Install", "#/abc/Use"), false);
    assert.equal(sameAddress("#/abc/Install", "#/abc"), false);
    assert.equal(sameAddress("#/abc", ""), false);
  });
});

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
