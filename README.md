# vault-to-site

An [Obsidian](https://obsidian.md) plugin that builds the notes you choose into a website to read them: one zip archive, with an `index.html` in it that you open with a browser. The site looks like your vault, because Obsidian itself draws every note for it, and it cannot be edited.

- **It opens from a file.** Unpack the archive and double-click `index.html`: no server, no network. The same files also work on a web server or on GitHub Pages as they are.
- **You choose what goes in.** Tick folders and notes in a tree, leave notes out or take in only some of them by their path or by a property, with regular expressions for both. Pictures and other files are not chosen: they come with the notes that use them.
- **Nothing gets in unseen.** Before a build you look over the list of every note that goes in, and of what was kept out and why.
- **It runs on a phone.** A build is one file that you can share from there.

## Requirements

- Obsidian 1.12.3 or later, on a computer, a phone, or a tablet

## Install

The plugin is not in the list of community plugins of Obsidian yet. Until it is, put it into a vault by hand:

1. From the [latest release](https://github.com/somebodil/vault-to-site/releases/latest), take `main.js`, `manifest.json` and `styles.css`.
2. Put them into a folder `.obsidian/plugins/vault-to-site/` in your vault. On a phone, a file manager or the app you sync with can do this.
3. In Obsidian, under **Settings → Community plugins**, turn **vault-to-site** on. Start Obsidian again if it is not listed.

The files of a release are built by GitHub from the commit of its tag, and carry a signed statement of that: `gh attestation verify main.js --repo somebodil/vault-to-site` checks it.

## Getting started

1. Run the command **vault-to-site: Build a site**, or tap its icon in the ribbon.
2. Tick what goes into the site, and choose **Look over**.
3. Read the list, and choose **Build**.
4. The site is the archive `vault-to-site.zip` in your vault. Unpack it and open `index.html` with a browser. On a phone, **Share or open** hands the archive to another app. The archive holds a `README.txt` for the one who gets it: how to open the site, and how to put it on the web.

## The archive, or a folder

Under **Written as** you choose what a build writes, and where, from the root of the vault:

- **Zip archive** (to begin with, `vault-to-site.zip`): one file. The archive of the build before gives way only when the new one is whole: a build that is stopped or fails leaves it as it was. A file with that name that this plugin did not write is not written over: the build is refused, and you choose another name or remove the file. The same holds for a file that comes to that name while the site is built.
- **Folder** (to begin with, `.vault-to-site`): the same files, unpacked. A build takes away the site of the build before and nothing else in the folder, so a folder that is also a copy of a repository keeps its `.git`. A folder with files in it counts as a site of this plugin only by what its file `vault-to-site.json` says, not by a file of that name: any other folder with files in it is refused. So is a build when a file of yours lies where an extra file is to go: remove it, or give the extra file another path. A path with a part that is `.` or `..` is refused, for the folder and for the archive. Obsidian does not show a folder whose name starts with a dot, so the pictures of the site do not turn up among those of your vault.

What a build has written is never part of a site, also after you give the archive or the folder another name. An archive or a folder that you rename or move away is put aside: the next build writes a new one where the setting says, and leaves the one you put aside alone. When you rename a folder above it, the setting follows. An archive or a folder that you delete is forgotten: a folder of notes that you make under its name later is a folder of notes.

If you sync the vault, keep it out of the sync: with git, add `vault-to-site.zip` and `.vault-to-site/` to `.gitignore`.

## Building by a program

The dialog is where you look over what goes in. A program has nobody to look: [obsidian-cmd-runner](https://github.com/somebodil/obsidian-cmd-runner) starts Obsidian without its window, on a build server after a push or from a script, and runs the command **Build a site** there. No dialog opens then, and the site is built at once.

```sh
obsidian-cmd-runner --vault notes --plugin somebodil/vault-to-site --command vault-to-site:build
```

Told nothing more, it goes by what the plugin has saved in the vault. Where nothing is ticked, the whole vault goes in, and where no place is named, the site is an archive `vault-to-site.zip` in the vault. What goes in is better said, and said by a mark on each note, so that a note does not go in by being new:

```json
{
  "ticks": { "on": [""] },
  "only": "publish: true",
  "format": "folder",
  "folder": "_site"
}
```

The command is given these as `settings`. With the file as `site.json` in the vault:

```sh
obsidian-cmd-runner --vault notes --plugin somebodil/vault-to-site \
  --command vault-to-site:build --arg "settings=$(cat notes/site.json)"
```

The file holds the settings of the dialog under the names `ticks` (`on` and `off`, paths from the root of the vault; `""` is the whole vault), `exclude`, `properties`, `include`, `only`, `extra`, `format` (`zip` or `folder`), `zip` and `folder`. They are laid over what the plugin has saved in the vault, and nothing of a run is saved. A name that is not one of these, or a value of the wrong kind, as a list where text is read, makes the run fail and is named: no setting is passed over. Because nothing is saved, a run knows the archive of the run before by what it holds and writes over it; any other file at its place is refused. A run is given `width` beside the settings (`--arg width=900`) to say how wide a note is taken to be, in pixels, for what is drawn to fit, as a diagram is: to begin with 1100, the width of a window on a computer. The run gives back which notes went in, how many were kept out by each rule, and what the look for names found. A note that could not be drawn makes the run fail.

## What the site has

- **The files** on the left, in folders, as in the file explorer
- **The note** in the middle, as Obsidian draws it in reading view: callouts, tables, code, formulas, diagrams, embeds, footnotes, properties
- **The outline, the backlinks and the graph** of the note on the right: the note with the notes it links to and the notes that link to it
- **The graph of the whole site**, from a button above the note. It can be moved and sized; the note under the pointer shows its name and its links, and a click opens it.
- **The note of a link** in a small window while the pointer rests on the link, as the page preview of Obsidian
- **Headings that fold**, with the triangle before a heading
- **Search** by the name of a note and by the words the notes show: press `/` or `Ctrl+K`. A line that is found opens its note at that line.
- **Dark and light**, as Obsidian was when the site was built, with a button to change it
- **An address for every note**, so the back and forward buttons of the browser work, a note that you come back to is where you left it, and a note or a heading can be bookmarked

On a narrow window, as on a phone, the two sides lie under the note, and the note moves aside for them: by their buttons, or with a finger. A finger that moves the note to the right uncovers the files, one that moves it to the left the outline, and the other way covers them again. The note follows the finger, and where it is let go decides: past the middle, or flicked, and the side stays open. A wide table or a block of code is still moved sideways inside itself. This is made for Chrome and the browsers built on it, as Edge.

## Choosing what goes in

These decide, in this order. A rule always wins over a tick, and a rule that leaves out wins over one that takes in.

1. **The ticks.** A ticked folder takes in everything inside it, also what you add later. Take the tick off a folder or a note inside it to leave that out. What is left out stays left out when you rename or move it in Obsidian. A rename that Obsidian cannot see, as one that a sync brings, is not followed: the dialog then names the path that is gone, because what it was is ticked again under its new name.
2. **Leave out by path.** JavaScript regular expressions, separated by commas. A path that one of them matches stays out. Upper and lower case are the same.

   | Input               | What stays out                                 |
   | ------------------- | ---------------------------------------------- |
   | `^Archive/`         | Everything in the top-level folder `Archive`   |
   | `(^\|/)_templates/` | Every folder called `_templates`, however deep |
   | `^Archive/, \.pdf$` | The folder `Archive`, and every PDF            |

   A comma is part of a pattern when it is escaped (`\,`), inside square brackets, inside a group, or inside a quantifier (`{1,3}`). **A pattern that is not a valid regular expression stops the build** until you correct it or take it out: a rule that does not work keeps nothing out. `*.png` is such a pattern; write `\.png$`.

3. **Leave out by property.** One property a line, as `key: value`. A note that has one of them stays out. To begin with these are `type: private` and `publish: false`. A key alone, as `draft:`, is every note that has that property, whatever it holds.

   **A value between slashes is a regular expression,** as in the rule for paths: the note stays out when the expression finds something in what the property holds. Upper and lower case are the same. Of a property that is a list, each item is tried by itself. Letters after the last slash are flags: `i`, `m`, `s` and `u` are taken (`i` changes nothing), and any other letters there make the line one that does not work.

   | Input                        | What stays out                                  |
   | ---------------------------- | ----------------------------------------------- |
   | `type: /^(private\|meta)$/` | A note whose `type` is `private` or `meta`      |
   | `tags: /^draft/`             | A note with a tag that starts with `draft`      |
   | `status: /wip/`              | A note whose `status` has `wip` somewhere in it |

   A value with one slash, or with nothing between two, is plain text. A plain value that has two slashes or more, as `/usr/bin`, is read as an expression with flags: write it as one, `/^\/usr\/bin$/`.

   A pattern that is not a regular expression, or a line that is not a property, keeps nothing out. The dialog says which one it is, and no site is built until it is corrected or taken out.
4. **Take in only by path.** Regular expressions, separated by commas, written as under **Leave out by path**. When there is one, a ticked note goes in only when one of them matches its path; a rule that keeps a note out still wins. Empty to begin with: then every ticked note goes in. With the whole vault ticked, `^Guide/, ^Notes/20\d\d-` takes of it the folder `Guide` and the notes of `Notes` that start with a year.

   Only notes are asked for a pattern. A picture or another file goes in with the note that uses it, wherever it lies.
5. **Take in only by property.** One property a line, as `publish: true`, with a value between slashes for a regular expression as above. When there is one, a ticked note goes in only with such a property; a rule that keeps a note out still wins. Empty to begin with: then every ticked note goes in. This is the rule for a site that is built with nobody looking the list over: a note does not go in by being new.

   **A note whose properties are not known stays out as well:** one that Obsidian has not read yet, as right after it starts, and one whose properties have a mistake in them, so that Obsidian shows them as text. A rule may be meant for such a note, and it cannot be checked. The step **Look over** lists these notes.

6. **Put a file at a path of its own.** One file a line, as `Resume.pdf: Papers/Resume.pdf`: the file of the vault after the colon goes into the site under the path before it, here at its top, where its address stays the same from build to build. Such a file is named one by one, by its whole path, and goes in whatever the ticks and the other rules say, also from a folder that a pattern keeps out. A note cannot be named: a note goes in only as a note. Nor can a path where the site itself writes, as `index.html`, or two paths of which one lies inside the other, as `a` and `a/b.pdf`. The step **Look over** lists these files, and a line that names no file of the vault stops the build.

**Ticks are for notes.** A picture or another file that is not a note is never chosen by a tick, and it is not in the tree. It goes into the site when a note of the site uses it, and only then. So ticking the whole vault does not put the pictures of a private note into the site, nor a file that lies in a folder of private notes and that no note links to. To have a file in the site, link to it or embed it in a note of the site.

In the tree, a ticked note that a rule keeps out is crossed out, with the rule beside it.

## What keeps a note out of the site

A note that is not part of the site leaves nothing in it:

- It is not in the list of files, not in the search, and not among the backlinks.
- **An embed of it is emptied,** also an embed inside an embedded note. Obsidian puts the text of an embedded note into the note that embeds it. The build takes it out again, and the site says "Not part of this site" in its place.
- **A link to it leads nowhere.** The words the link shows stay, because they are part of the note that has the link. Where the link led is removed, and the search finds only the words that show.
- **Its pictures stay out with it,** unless a note of the site uses them too.

The same holds for what reaches the site without being drawn by Obsidian: a link in a property or in a heading is shown as its words. An address that opens Obsidian (`obsidian://`) is taken out, because it holds the name of the vault and the path of a note. What is written as HTML in a note keeps an address (`href`, `src`, a picture in a `style`) only when it leads to the web, to a place on its own page, or to a file of the site. A style rule of a plugin or a snippet that names a folder of the vault, or a note that is not in the site, is not copied.

The step **Look over** lists the links and embeds that are cut this way.

**A build is what you looked over.** If the vault changes between the list and the build so that other notes or files would go in, the build is not done, and you look again.

**A name can still show.** The build cannot know every way a name gets onto a page: the words of a link, a sentence that mentions the note, or what another plugin writes when a note is drawn, such as a query that lists notes. So after a build, the words of every page are looked through for the names of the notes that a rule keeps out, and the dialog says which name shows where. The names it looks for are those of every note a rule is meant for, ticked or not. It changes nothing: whether a name may show is for you to say.

## Putting the site on GitHub Pages

The folder of the site is ready for it: every address in it is relative, and it has the `.nojekyll` file that GitHub Pages needs to serve all of it. Put the content of the folder into the repository or the branch that your pages are served from. A build of the same notes gives the same files, so a commit of the site shows only what has changed.

**A site on GitHub Pages can be read by everyone.** Look over the list before you build for it.

## The style sheets

The site looks like your Obsidian because a build copies the style sheets that your Obsidian has loaded: those of the app, of your theme, of your snippets, and of your plugins, also the ones a plugin makes with script, with the fonts they use. They are copied on your device at the time of the build. None of them is part of this plugin.

Those style sheets belong to their authors, and the ones of the app to Obsidian. Other plugins that publish notes do the same, but there is no written permission for it. Keep that in mind before you put a site where everyone can see it.

## Limits

- **A site is a picture of the vault at the time of the build.** What a plugin shows in a note, such as the result of a query, is as it was then. Every build draws every note again.
- **An archive is at most 4 GB and 65,535 files.** A larger site is built as a folder.
- **Canvases and bases stay out.** The site cannot draw them, and as plain files they would only carry the paths and the text they hold. An embed of one in a note is cut like a link to a note outside the site.
- **The search block and the base block of Obsidian are emptied.** A block that starts with `query` lists lines of other notes, and one that starts with `base` lists notes and their properties, whatever they are.
- **A link to a block leads to its note,** not to the block.
- **A site is written inside the vault,** because that is where a plugin may write on a phone.
- **In a link to a note outside the site, the words stay.** A link written without other words shows the name of its note.

## What was tried, and what was not

- **Building on a computer** ran in Obsidian 1.15.1 on a Mac: a note that uses every kind of block Obsidian draws, 1000 generated notes in 4 to 5 seconds, 300 notes with four diagrams and two formulas each, in which every diagram was drawn, and 168 real notes with a file of 85 MB, as an archive and as a folder, which held the same files.
- **Building on a phone** ran in Obsidian 1.15.1 on an emulated Android phone: a vault of difficult cases (private notes, embeds inside embeds, properties with a mistake, a canvas, a base, notes with scripts, HTML and odd names), 168 real notes with 70 pictures, 1000 generated notes in 6 to 8 seconds, and a site of 51 MB, whose archive is written in pieces. The same notes built twice gave the same files, byte for byte.
- **The look** was compared with the reading view of Obsidian on the computer, block by block: the size of each block, the styles the browser works out for it, and its picture. First with a note made for it, then with 16 real notes under a font that a plugin loads and without a line of readable length: all 363 blocks are the same. Headings, text, lists, tasks, quotes, callouts, code, tables, formulas, six kinds of diagram, pictures, embedded notes and the properties are the same. What differs is what a reader cannot use: the buttons that remove a value or add a property, and a link that leads out of the site, which is shown as one that leads nowhere.
- **Renames, stops and refusals** were done in Obsidian on the phone: a folder with left-out notes renamed, a build stopped half way, a vault changed between the list and the build, a file of the user at the place of the archive.
- **The site** was opened in Chrome, in WebKit (the engine of Safari) and in Firefox, from a file and from a web server under a path, at the width of a computer and of a phone. After each build of the difficult vault, every file of the site was searched for the names and the text of what was kept out.
- **In Chrome on the emulated phone** the site was loaded from a web server and read by script: it comes up in the layout for a phone. Touching it there was not tried, because the emulator stopped when a window of Chrome was touched.
- **A file at a path of its own** was built through the runner in Obsidian 1.15.1 on a Mac: a PDF from a folder that a pattern keeps out, put at the top of a site of 149 real notes, and served from there by a web server.
- **Taking in by path, and a value of a property as a regular expression**, were built through the runner in Obsidian 1.15.1 on a Mac, from a copy of a real vault of 244 notes. The settings as they were gave the same site as before, file for file. A pattern for paths took in the 41 notes it names with the pictures they use, and a pattern that leaves out won over it. A value between slashes gave the same site as the plain values it stands for, took a value in capital letters, and tried each item of a list. A pattern that is not valid stopped the run with its name, and nothing was written. The dialog was driven by script: it showed the count, the mark in the tree, the list in the step to look over, and it did not go on with a pattern that is not valid.
- **Building on Linux** ran through the runner in Obsidian 1.15.1 on arm64, with no screen: 142 real notes as a folder, the same files as from the build before these changes, and small vaults made for what a build refuses: an archive and a folder that are not the plugin's, a file where an extra file is to go, settings of a run that cannot be read.
- **Not tried:** building in Obsidian on Windows, on an iPhone or an iPad, the output of plugins of others as Dataview, and using the site by touch in the browser of a real phone.

## Development

You need [Node.js](https://nodejs.org) 24 or later.

```bash
npm install
npm run dev     # rebuilds main.js on every change
npm run check   # type check, lint, and tests
npm run build   # type check, then the main.js of a release
```

- `src/select` decides what goes into a site. It knows nothing about Obsidian, so its tests run with plain Node.js.
- `src/build` has Obsidian draw the notes and writes the site. The zip archive is written by `zip.ts`, without a library.
- `src/ui` holds the dialog.
- `src/viewer` is the script of the site, which runs in the browser. It is built on its own and goes into `main.js` as text.

To try a build, copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/vault-to-site/` in a vault.

## License

[MIT](LICENSE)
