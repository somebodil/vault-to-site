import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { siteReadme } from "./readme.ts";

describe("siteReadme", () => {
  it("starts with the name of the vault and says how to open the site and how to put it on the web", () => {
    const text = siteReadme("My notes", "en");
    assert.equal(text.split("\n")[0], "My notes");
    assert.match(text, /unpack all of it first/);
    assert.match(text, /Open index\.html with a web browser/);
    assert.match(text, /GitHub Pages, an S3 bucket/);
  });

  it("is in Korean when Obsidian is, and in English for every other language", () => {
    assert.match(siteReadme("노트", "ko"), /index\.html을 웹 브라우저로 엽니다/);
    assert.match(siteReadme("노트", "ko-KR"), /읽는 방법/);
    assert.match(siteReadme("Notes", "ja"), /TO READ IT/);
    assert.match(siteReadme("Notes", ""), /TO READ IT/);
  });
});
