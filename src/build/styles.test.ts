import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mentionFinder } from "./mentions.ts";
import { comparedInSelector, fileOfData, fontKey, namesPathIn, URL_IN_CSS } from "./styles.ts";

describe("fontKey", () => {
  it("is the same for the name of a font and the name of its file", () => {
    assert.equal(fontKey("pretendardvariable"), fontKey("PretendardVariable.ttf"));
    assert.equal(fontKey('"Pretendard Variable"'), fontKey("Pretendard-Variable.woff2"));
    assert.equal(fontKey("나눔 고딕"), fontKey("나눔고딕.otf"));
  });

  it("tells different fonts apart", () => {
    assert.notEqual(fontKey("Pretendard"), fontKey("PretendardVariable.ttf"));
  });
});

describe("fileOfData", () => {
  const bytes = Buffer.from(Array.from({ length: 30_000 }, (_, i) => (i * 7919) & 0xff));
  const font = "data:font/truetype;base64," + bytes.toString("base64");

  it("makes a file of a large font that is written into a sheet", () => {
    const file = fileOfData(font);
    assert.ok(file !== null);
    assert.match(file.name, /^res\/[0-9a-z]+\.ttf$/);
    assert.deepEqual(Buffer.from(file.bytes), bytes);
  });

  it("gives the same file the same name, and another file another", () => {
    assert.equal(fileOfData(font)?.name, fileOfData(font)?.name);
    const other = "data:font/truetype;base64," + Buffer.from(bytes.map((b) => b ^ 1)).toString("base64");
    assert.notEqual(fileOfData(font)?.name, fileOfData(other)?.name);
  });

  it("leaves a small one, and one of an unknown kind, where it is", () => {
    assert.equal(fileOfData("data:image/png;base64,iVBORw0KGgo="), null);
    assert.equal(fileOfData("data:application/octet-stream;base64," + bytes.toString("base64")), null);
    assert.equal(fileOfData("data:image/svg+xml;utf8," + "x".repeat(30_000)), null);
  });
});

describe("comparedInSelector", () => {
  it("gives what an attribute is compared with", () => {
    assert.deepEqual(comparedInSelector('.workspace-tab-header[aria-label="Diary 2026"]'), ["Diary 2026"]);
    assert.deepEqual(comparedInSelector("a[title^='My plan'], .x[data-kind *= \"a \\\" b\"]"), ["My plan", 'a \\" b']);
  });

  it("gives it also when it is written without quotes", () => {
    assert.deepEqual(comparedInSelector(".workspace-tab-header[aria-label=Diary], a[ title |= Plan i ]"), ["Diary", "Plan"]);
  });

  it("gives nothing for a selector without a comparison, or with one of an attribute that holds a keyword", () => {
    assert.deepEqual(comparedInSelector('.callout[data-callout=note] > .x::before, a:not([href])'), []);
    assert.deepEqual(comparedInSelector('.callout[data-callout="todo"], input[TYPE="checkbox"], [svg|type=text], pre[class*=language-]'), []);
  });
});

describe("namesPathIn", () => {
  const outside = mentionFinder(["Private/Todo.md"]);
  const names = (text: string): boolean => outside.names(text);

  it("keeps a rule for a keyword that is also the name of a note outside the site", () => {
    assert.equal(namesPathIn('.callout[data-callout="todo"]', names), false);
    assert.equal(namesPathIn(".markdown-rendered [data-task=todo]", names), false);
  });

  it("leaves out a rule that picks an element by a path or by the name of such a note", () => {
    assert.equal(namesPathIn('.nav-file-title[data-path="Todo.md"]', names), true);
    assert.equal(namesPathIn('.workspace-tab-header[aria-label="Todo"]', names), true);
    assert.equal(namesPathIn(".workspace-tab-header[aria-label=Todo]", names), true);
    assert.equal(namesPathIn('.workspace-tab-header[aria-label="Settings"]', names), false);
  });
});

describe("URL_IN_CSS", () => {
  it("finds an address however `url` is written", () => {
    const found: string[] = [];
    const css = 'a{b:URL("app://local/Users/me/Vault/x.png")} c{d:Url( y.png )} e{f:url(\'z.png\')}';
    const left = css.replace(URL_IN_CSS, (_whole, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      found.push((double ?? single ?? bare ?? "").trim());
      return "url(-)";
    });
    assert.deepEqual(found, ["app://local/Users/me/Vault/x.png", "y.png", "z.png"]);
    assert.equal(left, "a{b:url(-)} c{d:url(-)} e{f:url(-)}");
  });
});
