import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteCss, splitRules, topRuleCount, withoutComments, type CssChoice } from "./css.ts";

const keepAll: CssChoice = { drops: () => false };
const text = (css: string, choice: CssChoice = keepAll): string =>
  rewriteCss(css, choice)
    .filter((piece) => typeof piece === "string")
    .join("");

describe("splitRules", () => {
  it("cuts a sheet into its rules and statements", () => {
    assert.deepEqual(splitRules('@import "a.css"; a { color: red } @media (min-width: 1px) { b { c: d } e { f: g } }'), [
      { prelude: '@import "a.css"', block: null },
      { prelude: "a", block: " color: red " },
      { prelude: "@media (min-width: 1px)", block: " b { c: d } e { f: g } " },
    ]);
  });

  it("does not take a brace or a semicolon in a string, a comment or an address for the end of a rule", () => {
    const rules = splitRules(`a::before { content: "}{;"; } /* } b { */ c { background: url(data:image/svg+xml;utf8,<svg style='x{y}'/>); } d[x="a;b{"] { e: f }`);
    assert.deepEqual(
      rules.map((rule) => rule.prelude),
      ["a::before", "c", 'd[x="a;b{"]'],
    );
    assert.equal(rules[1]?.block?.trim(), "background: url(data:image/svg+xml;utf8,<svg style='x{y}'/>);");
  });

  it("reads a block that is not closed to the end, and passes over an end without a start", () => {
    assert.deepEqual(splitRules("} a { b: c } d { e: f"), [
      { prelude: "a", block: " b: c " },
      { prelude: "d", block: " e: f" },
    ]);
  });
});

describe("withoutComments", () => {
  it("takes comments out, and leaves what only looks like one in a string or an address", () => {
    assert.equal(withoutComments('a /* x */ b "/* kept */" url(/*kept*/)'), 'a   b "/* kept */" url(/*kept*/)');
  });
});

describe("rewriteCss", () => {
  it("writes every declaration as it was written, also one a browser does not give back", () => {
    const hr = "hr{border:none;border-top:var(--hr-thickness) solid;border-color:var(--hr-color);margin:2rem 0}";
    assert.equal(text(hr), hr + "\n");
  });

  it("leaves out the rules the choice names, also inside a rule that holds rules, and such a rule that is left empty", () => {
    const choice: CssChoice = { drops: (selector) => selector.includes("[data-path") };
    const css = 'a{b:c} .x[data-path="Private"]{d:e} @media print{ .y[data-path^="P"]{f:g} h{i:j} } @supports (x:y){ .z[data-path]{k:l} }';
    assert.equal(text(css, choice), "a{b:c}\n@media print{\nh{i:j}\n}\n");
  });

  it("gives a rule with rules of its own in its block to the choice with that block", () => {
    const choice: CssChoice = { drops: (selector, block) => (selector + block).includes("[data-path") };
    assert.equal(text('.a{color:red; .b[data-path="x"]{c:d}} .e{f:g}', choice), ".e{f:g}\n");
  });

  it("keeps the rules that hold no rules of the page as they are", () => {
    const css = "@keyframes spin{from{a:b}to{c:d}}\n@font-face{font-family:x;src:url(a.woff2)}\n@layer base, theme;\n@property --x{syntax:'*';inherits:false}\n";
    assert.equal(text(css, { drops: () => true }), css);
  });

  it("lets the choice write the block of a font", () => {
    assert.equal(text("@font-face{font-family:x}", { drops: () => false, font: (block) => block + ";font-weight:100 900" }), "@font-face{font-family:x;font-weight:100 900}\n");
  });

  it("sets apart the sheets that are taken in, where they stood, and drops the line about how the file is stored", () => {
    assert.deepEqual(rewriteCss(`@charset "utf-8"; @import url("https://fonts.example/a.css") screen; a{b:c} @import 'local.css'; @import url(bare.css) layer(x);`, keepAll), [
      { address: "https://fonts.example/a.css", rest: "screen" },
      "a{b:c}\n",
      { address: "local.css", rest: "" },
      { address: "bare.css", rest: "layer(x)" },
    ]);
  });
});

describe("topRuleCount", () => {
  it("counts the rules at the top of a sheet", () => {
    assert.equal(topRuleCount('@charset "utf-8"; a{b:c} @media print{d{e:f} g{h:i}} @import "x";'), 3);
    assert.equal(topRuleCount(""), 0);
  });
});
