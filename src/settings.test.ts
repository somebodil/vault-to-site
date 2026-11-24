import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS, followDelete, followRename, givenProblems, givenTicks, placeOf, readSettings, type Settings } from "./settings.ts";

describe("readSettings", () => {
  it("gives the defaults for nothing saved", () => {
    assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(readSettings("nonsense"), DEFAULT_SETTINGS);
  });

  it("keeps what is of the right kind and drops the rest", () => {
    const read = readSettings({
      ticks: { on: ["Notes", 7, null], off: "no list" },
      exclude: "^Archive/",
      properties: 5,
      format: "folder",
      zip: "   ",
      folder: " out/site ",
      written: ["old.zip", 5],
    });
    assert.deepEqual(read.written, ["old.zip"]);
    assert.deepEqual(read.ticks, { on: ["Notes"], off: [] });
    assert.equal(read.exclude, "^Archive/");
    assert.equal(read.properties, DEFAULT_SETTINGS.properties);
    assert.equal(read.format, "folder");
    assert.equal(read.zip, DEFAULT_SETTINGS.zip);
    assert.equal(read.folder, "out/site");
  });

  it("writes an archive unless a folder was asked for", () => {
    assert.equal(readSettings({ format: "tar" }).format, "zip");
    assert.equal(readSettings({}).format, "zip");
  });

  it("reads the patterns to take in by, and has none to begin with", () => {
    assert.equal(readSettings({ include: "^Guide/" }).include, "^Guide/");
    assert.equal(readSettings({ include: 5 }).include, "");
    assert.equal(DEFAULT_SETTINGS.include, "");
  });

  it("keeps an empty list of property rules: no rule is a choice", () => {
    assert.equal(readSettings({ properties: "" }).properties, "");
  });

});

describe("givenProblems", () => {
  it("finds nothing wrong with settings as they are written for a run", () => {
    assert.deepEqual(givenProblems({}), []);
    assert.deepEqual(givenProblems({ ticks: { on: [""] }, only: "publish: true", format: "folder", folder: "_site" }), []);
    assert.deepEqual(
      givenProblems({ ticks: { on: ["Guide"], off: [] }, exclude: "", include: "^Guide/", properties: "type: private", only: "", extra: "a.pdf: b.pdf", format: "zip", zip: "site", folder: "out" }),
      [],
    );
  });

  it("names a key that is not a setting", () => {
    assert.deepEqual(givenProblems({ exlude: "^Private/", ticks: { on: [""] } }), [
      '"exlude" is not a setting: a run takes ticks, exclude, include, properties, only, extra, format, zip and folder.',
    ]);
    // What the plugin keeps for itself is not given to a run
    assert.equal(givenProblems({ written: ["Notes"] }).length, 1);
    assert.deepEqual(givenProblems({ ticks: { on: [""], of: ["Private"] } }), ['"ticks.of" is not a setting: "ticks" has the lists "on" and "off".']);
  });

  it("names a value of the wrong kind", () => {
    assert.deepEqual(givenProblems({ only: ["publish: true"] }), ['"only" has to be text, as it is typed in the dialog.']);
    for (const key of ["exclude", "include", "properties", "only", "extra"]) {
      for (const value of [null, 5, true, ["x"], { x: 1 }]) {
        assert.deepEqual(givenProblems({ [key]: value }), [`"${key}" has to be text, as it is typed in the dialog.`]);
      }
    }
    assert.deepEqual(givenProblems({ format: "tar" }), ['"format" has to be "zip" or "folder".']);
    assert.deepEqual(givenProblems({ format: ["zip"] }), ['"format" has to be "zip" or "folder".']);
    assert.deepEqual(givenProblems({ zip: 5, folder: "  " }), ['"zip" has to be a path, as text.', '"folder" has to be a path, as text.']);
    for (const ticks of [null, "Guide", [""], 5]) {
      assert.deepEqual(givenProblems({ ticks }), ['"ticks" has to be an object with the lists "on" and "off", as {"on": [""]}.']);
    }
    assert.deepEqual(givenProblems({ ticks: { on: "", off: ["a", 5] } }), [
      '"ticks.on" has to be a list of paths, each as text: [""] is the whole vault.',
      '"ticks.off" has to be a list of paths, each as text: [""] is the whole vault.',
    ]);
  });

  it("names every one of them", () => {
    assert.equal(givenProblems({ only: ["publish: true"], exlude: "^Private/", format: "site" }).length, 3);
  });
});

describe("placeOf", () => {
  it("is the archive with its ending or the folder, by the format", () => {
    assert.equal(placeOf({ ...DEFAULT_SETTINGS, format: "zip", zip: "out/a", folder: "b" }), "out/a.zip");
    assert.equal(placeOf({ ...DEFAULT_SETTINGS, format: "zip", zip: "a.ZIP", folder: "b" }), "a.ZIP");
    assert.equal(placeOf({ ...DEFAULT_SETTINGS, format: "folder", zip: "a.zip", folder: " b " }, (path) => path.trim()), "b");
  });
});

describe("followRename", () => {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ticks: { on: ["Guide"], off: ["Guide/Draft.md"] },
    zip: "out/site",
    folder: "out/web",
    written: ["out/site.zip", "out/web"],
  };

  it("moves the ticks, the record of what was written and the place of the next build with a folder above them", () => {
    const next = followRename(settings, "out", "public");
    assert.deepEqual(next.written, ["public/site.zip", "public/web"]);
    assert.equal(next.zip, "public/site.zip");
    assert.equal(next.folder, "public/web");
    assert.deepEqual(followRename(settings, "Guide", "Manual").ticks, { on: ["Manual"], off: ["Manual/Draft.md"] });
  });

  it("follows a file that is put into the site at a path of its own", () => {
    const some = { ...settings, extra: "Resume.pdf: Guide/Resume.pdf\nb.pdf: Other/b.pdf" };
    assert.equal(followRename(some, "Guide", "Manual").extra, "Resume.pdf: Manual/Resume.pdf\nb.pdf: Other/b.pdf");
    assert.equal(followRename(some, "Guide/Resume.pdf", "Guide/CV.pdf").extra, "Resume.pdf: Guide/CV.pdf\nb.pdf: Other/b.pdf");
    assert.equal(readSettings({ extra: 3 }).extra, "");
  });

  it("keeps an archive that was put aside the plugin's, and writes the next one where the setting says", () => {
    const next = followRename(settings, "out/site.zip", "backup/site of May.zip");
    assert.deepEqual(next.written, ["backup/site of May.zip", "out/web"]);
    assert.equal(next.zip, "out/site");
    assert.equal(followRename(settings, "out/web", "out/web of May").folder, "out/web");
  });

  it("is not moved by the names a build gives its archive on the way", () => {
    assert.equal(followRename(settings, "out/site.zip", "out/site.zip.v2s-old"), settings);
    assert.equal(followRename(settings, "out/site.zip.v2s-part", "out/site.zip"), settings);
    assert.equal(followRename(settings, "out/site.zip.v2s-old", "out/site.zip"), settings);
    // With the letters a build draws by chance, and for what lies in a folder on the way
    assert.equal(followRename(settings, "out/site.zip.v2s-part-k3j9x2a1", "out/site.zip"), settings);
    assert.equal(followRename(settings, "site.v2s-part-k3j9x2a1/data", "site/data"), settings);
  });

  it("follows a rename to a name that only looks like one of those", () => {
    const some: Settings = { ...settings, ticks: { on: [""], off: ["Drafts"] } };
    assert.deepEqual(followRename(some, "Drafts", "Drafts.old").ticks, { on: [""], off: ["Drafts.old"] });
    assert.deepEqual(followRename({ ...some, ticks: { on: [""], off: ["Notes.old"] } }, "Notes.old", "Notes").ticks, { on: [""], off: ["Notes"] });
    assert.deepEqual(followRename(settings, "out/site.zip", "out/site.zip.old").written, ["out/site.zip.old", "out/web"]);
  });

  it("keeps what was decided inside a folder when Obsidian tells of the folder and of each thing in it", () => {
    const some: Settings = { ...settings, ticks: { on: ["", "Notes/Private/open.md"], off: ["Notes/Private", "Notes/diary.md"] } };
    const told: [string, string][] = [
      ["Notes", "Wiki"],
      ["Notes/Private", "Wiki/Private"],
      ["Notes/Private/open.md", "Wiki/Private/open.md"],
      ["Notes/Private/secret.md", "Wiki/Private/secret.md"],
      ["Notes/diary.md", "Wiki/diary.md"],
    ];
    const after = { on: ["", "Wiki/Private/open.md"], off: ["Wiki/Private", "Wiki/diary.md"] };
    // In the order from the folder down, and in the order from the notes up
    for (const order of [told, [...told].reverse()]) {
      const next = order.reduce((now, [from, to]) => followRename(now, from, to), some);
      assert.deepEqual(next.ticks, after);
    }
  });

  it("leaves the settings as they are for a rename elsewhere", () => {
    assert.deepEqual(followRename(settings, "Notes/a.md", "Notes/b.md"), settings);
  });

  it("gives back the same object when nothing has changed, and another when something has", () => {
    const some: Settings = { ...settings, extra: "Resume.pdf: Guide/Resume.pdf" };
    assert.equal(followRename(some, "Notes/a.md", "Notes/b.md"), some);
    assert.equal(followRename(some, "Notes", "Wiki", true), some);
    assert.notEqual(followRename(some, "Guide/Draft.md", "Guide/Sketch.md"), some);
    assert.notEqual(followRename(some, "Guide/Resume.pdf", "Guide/CV.pdf"), some);
    assert.notEqual(followRename(some, "out/web", "out/web of May"), some);
    assert.notEqual(followRename(some, "out", "public"), some);
    // A tick that is dropped because something else came to its path is a change as well
    assert.notEqual(followRename(some, "Notes/a.md", "Guide/Draft.md", true), some);
  });
});

describe("followDelete", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, ticks: { on: ["Blog"], off: [] }, zip: "out/site", folder: "Blog", written: ["out/site.zip", "Blog", "Blogs"] };

  it("forgets what a build wrote at a path that is deleted, or inside it", () => {
    assert.deepEqual(followDelete(settings, "Blog").written, ["out/site.zip", "Blogs"]);
    assert.deepEqual(followDelete(settings, "out/site.zip").written, ["Blog", "Blogs"]);
    assert.deepEqual(followDelete(settings, "out").written, ["Blog", "Blogs"]);
  });

  it("changes nothing else: the ticks and the place of the next build stay", () => {
    const next = followDelete(settings, "Blog");
    assert.deepEqual({ ...next, written: settings.written }, settings);
  });

  it("gives back the same object for a delete elsewhere, also inside a site", () => {
    assert.equal(followDelete(settings, "Notes/a.md"), settings);
    assert.equal(followDelete(settings, "Blog/index.html"), settings);
    assert.equal(followDelete(settings, "Blo"), settings);
    assert.equal(followDelete(settings, "out/site.zip.v2s-old"), settings);
    assert.equal(followDelete(settings, ""), settings);
  });
});

describe("givenTicks", () => {
  /** As Obsidian makes a path normal: no slash at its ends, and its letters put together */
  const normal = (path: string): string => {
    const plain = path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
    return plain === "" ? "/" : plain.normalize("NFC");
  };
  const inVault = new Set(["Private", "Notes", "Notes/a.md", "한글"]);
  const has = (path: string): boolean => inVault.has(path);

  it("puts each path into the form the vault has", () => {
    const read = givenTicks({ on: ["", "/Notes/"], off: ["Private/", "/Private", "Notes\\a.md", "한글".normalize("NFD")] }, normal, has);
    assert.deepEqual(read, { ticks: { on: ["", "Notes"], off: ["Notes/a.md", "Private", "한글"] }, problems: [] });
  });

  it("takes a slash for the whole vault, and does not ask whether the whole vault is there", () => {
    assert.deepEqual(givenTicks({ on: ["/"], off: [] }, normal, () => false), { ticks: { on: [""], off: [] }, problems: [] });
    assert.deepEqual(givenTicks({ on: [""], off: [] }, normal, () => false), { ticks: { on: [""], off: [] }, problems: [] });
  });

  it("names a path that is no folder and no file of the vault, as it was written", () => {
    const read = givenTicks({ on: ["Note"], off: ["Privat/", "Private"] }, normal, has);
    assert.deepEqual(read.problems, ['"ticks.on" names "Note", which is not a folder or file of the vault.', '"ticks.off" names "Privat/", which is not a folder or file of the vault.']);
  });
});
