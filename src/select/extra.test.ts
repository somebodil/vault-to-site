import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planExtra, renameExtra, sitePath, type KindOfPath } from "./extra.ts";

const OWN = ["vault-to-site.json", "index.html", ".nojekyll", "README.txt", "app", "data", "assets"];
const same = (path: string): string => path;
const vault: Record<string, KindOfPath> = { "Private/Resume.pdf": "file", "Private/Resume.tex.md": "note", "Papers/a.pdf": "file" };
const kindOf = (path: string): KindOfPath => vault[path] ?? "none";

describe("sitePath", () => {
  it("takes a path inside the site", () => {
    assert.equal(sitePath("Resume.pdf", OWN), "Resume.pdf");
    assert.equal(sitePath("  ./papers/2026/a b.pdf ", OWN), "papers/2026/a b.pdf");
    assert.equal(sitePath(".well-known/security.txt", OWN), ".well-known/security.txt");
    assert.equal(sitePath("이력서.pdf", OWN), "이력서.pdf");
  });

  it("takes no path that leaves the site or that a file system reads as something else", () => {
    for (const path of ["", "/Resume.pdf", "../Resume.pdf", "a/../b.pdf", "a//b.pdf", "a/./b.pdf", "a\\b.pdf", "C:/b.pdf", "a/b.pdf/", "a /b.pdf", "a./b", "a\tb", ".git/config", "x/.GIT/config"]) {
      assert.equal(sitePath(path, OWN), null, path);
    }
  });

  it("takes no path where the site itself writes, in capital or small letters", () => {
    for (const path of ["index.html", "INDEX.HTML", "data/n/x.js", "Assets/a.png", "app", "readme.txt", ".nojekyll", "vault-to-site.json"]) {
      assert.equal(sitePath(path, OWN), null, path);
    }
    assert.equal(sitePath("docs/index.html", OWN), "docs/index.html");
  });
});

describe("planExtra", () => {
  it("reads one file a line, in the order of their paths in the site", () => {
    const plan = planExtra("\nb/a.pdf: Papers/a.pdf\n  Resume.pdf:Private/Resume.pdf  \n", kindOf, same, OWN);
    assert.deepEqual(plan, {
      files: [
        { to: "Resume.pdf", from: "Private/Resume.pdf" },
        { to: "b/a.pdf", from: "Papers/a.pdf" },
      ],
      invalid: [],
    });
    assert.deepEqual(planExtra("", kindOf, same, OWN), { files: [], invalid: [] });
  });

  it("takes the path of the vault in the form the vault has", () => {
    const plan = planExtra("Resume.pdf: /Private//Resume.pdf", kindOf, (path) => path.replace(/\/+/g, "/").replace(/^\//, ""), OWN);
    assert.deepEqual(plan.files, [{ to: "Resume.pdf", from: "Private/Resume.pdf" }]);
  });

  it("says what is wrong with a line, and takes nothing for it", () => {
    const plan = planExtra(
      ["Resume.pdf", ": Private/Resume.pdf", "x.pdf:", "index.html: Papers/a.pdf", "x.pdf: Papers/none.pdf", "x.md: Private/Resume.tex.md", "A.pdf: Papers/a.pdf", "a.pdf: Private/Resume.pdf"].join("\n"),
      kindOf,
      same,
      OWN,
    );
    assert.deepEqual(plan.files, [{ to: "A.pdf", from: "Papers/a.pdf" }]);
    assert.deepEqual(plan.invalid, [
      '"Resume.pdf" does not name a file for the site: write it as path in the site: path in the vault.',
      '": Private/Resume.pdf" does not name a file for the site: write it as path in the site: path in the vault.',
      '"x.pdf:" does not name a file for the site: write it as path in the site: path in the vault.',
      '"index.html" cannot be the path of a file in the site.',
      '"Papers/none.pdf" is not a file of the vault.',
      '"Private/Resume.tex.md" is a note: a note goes into the site by the ticks and the rules only.',
      '"a.pdf" is named twice.',
    ]);
  });
});

describe("renameExtra", () => {
  it("follows a file that got another name, and leaves the other lines as they are", () => {
    const moved = (path: string): string => (path.startsWith("Private/") ? "Mine/" + path.slice(8) : path);
    assert.equal(renameExtra("Resume.pdf:Private/Resume.pdf\n\nbroken line\nb.pdf: Papers/a.pdf", moved, same), "Resume.pdf: Mine/Resume.pdf\n\nbroken line\nb.pdf: Papers/a.pdf");
    assert.equal(renameExtra("", moved, same), "");
  });
});
