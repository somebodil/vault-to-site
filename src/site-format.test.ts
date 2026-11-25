import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dataDocument, type NotePage } from "./site-format.ts";

/** What app/frame.js hands over: the text of the element that holds the JSON */
function held(document: string): string {
  const start = document.indexOf('<script type="application/json">') + '<script type="application/json">'.length;
  return document.slice(start, document.indexOf("</script>", start));
}

describe("dataDocument", () => {
  it("holds the data as JSON that reads back the same", () => {
    const page: NotePage = { html: '<p>a &amp; b</p><pre><code>if (a < b) {}</code></pre>', props: [["tags", ["x"], "tags"]], h: [[1, "설치 (macOS)"]] };
    assert.deepEqual(JSON.parse(held(dataDocument(page))), page);
    assert.deepEqual(JSON.parse(held(dataDocument([["abc", "line two"]]))), [["abc", "line two"]]);
  });

  it("has no sign in the JSON that could end the element it is in", () => {
    const page: NotePage = { html: "</script><script>alert(1)</script><!-- <script>", props: [], h: [] };
    const document = dataDocument(page);
    assert.equal(held(document).includes("<"), false);
    assert.deepEqual(JSON.parse(held(document)), page);
    assert.equal(document.split("</script>").length - 1, 2, "the two elements of the document, and no other");
  });

  it("loads the script that hands the data over, from two folders down", () => {
    assert.match(dataDocument([]), /<script src="\.\.\/\.\.\/app\/frame\.js"><\/script>/);
  });
});
