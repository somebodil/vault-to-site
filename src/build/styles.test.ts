import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileOfData, fontKey, weightRangeOf } from "./styles.ts";

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

describe("weightRangeOf", () => {
  /** A file with nothing but the table that says how a font varies */
  function font(axes: [tag: string, least: number, greatest: number][]): ArrayBuffer {
    const bytes = new Uint8Array(12 + 16 + 16 + axes.length * 20);
    const view = new DataView(bytes.buffer);
    const tag = (text: string): number => (text.charCodeAt(0) << 24) | (text.charCodeAt(1) << 16) | (text.charCodeAt(2) << 8) | text.charCodeAt(3);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 1);
    view.setUint32(12, tag("fvar"));
    view.setUint32(12 + 8, 28);
    view.setUint32(12 + 12, 16 + axes.length * 20);
    view.setUint16(28, 1);
    view.setUint16(28 + 4, 16);
    view.setUint16(28 + 8, axes.length);
    view.setUint16(28 + 10, 20);
    for (const [at, [name, least, greatest]] of axes.entries()) {
      const axis = 28 + 16 + at * 20;
      view.setUint32(axis, tag(name));
      view.setInt32(axis + 4, least * 65536);
      view.setInt32(axis + 8, least * 65536);
      view.setInt32(axis + 12, greatest * 65536);
    }
    return bytes.buffer;
  }

  it("reads the weights of a font that varies in weight", () => {
    assert.deepEqual(weightRangeOf(font([["wght", 45, 920]])), [45, 920]);
    assert.deepEqual(weightRangeOf(font([["wdth", 75, 125], ["wght", 100, 900]])), [100, 900]);
  });

  it("is null for a font of one weight, and for what is not a font", () => {
    assert.equal(weightRangeOf(font([["wdth", 75, 125]])), null);
    assert.equal(weightRangeOf(font([["wght", 400, 400]])), null);
    assert.equal(weightRangeOf(new ArrayBuffer(3)), null);
    assert.equal(weightRangeOf(new TextEncoder().encode("not a font at all, just some text").buffer), null);
  });
});
