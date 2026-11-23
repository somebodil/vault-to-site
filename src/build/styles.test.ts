import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileOfData, fontKey } from "./styles.ts";

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
