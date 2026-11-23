# vault-to-site

An [Obsidian](https://obsidian.md) plugin that builds the notes you choose into a website to read them: one zip archive, with an `index.html` in it that you open with a browser. The site looks like your vault, because Obsidian itself draws every note for it, and it cannot be edited.

- **It opens from a file.** Unpack the archive and double-click `index.html`: no server, no network. The same files also work on a web server or on GitHub Pages as they are.
- **You choose what goes in.** Tick folders and notes in a tree, leave paths out with regular expressions, and leave notes out by a property.
- **Nothing gets in unseen.** Before a build you look over the list of every note that goes in, and of what was kept out and why.
- **It runs on a phone.** A build is one file that you can share from there.

## Requirements

- Obsidian 1.12.3 or later, on a computer, a phone, or a tablet

## Getting started

1. Run the command **vault-to-site: Build a site**, or tap its icon in the ribbon.
2. Tick what goes into the site, and choose **Look over**.
3. Read the list, and choose **Build**.
4. The site is the archive `vault-to-site.zip` in your vault. Unpack it and open `index.html` with a browser. On a phone, **Share or open** hands the archive to another app.

## The archive, or a folder

Under **Written as** you choose what a build writes, and where, from the root of the vault:

- **Zip archive** (to begin with, `vault-to-site.zip`): one file. A build writes over the archive of the build before.
- **Folder** (to begin with, `.vault-to-site`): the same files, unpacked. A build empties the folder first, and refuses a folder that holds anything but a site of this plugin. Obsidian does not show a folder whose name starts with a dot, so the pictures of the site do not turn up among those of your vault.

What a build writes is never part of a site, and it is not a note. If you sync the vault, keep it out of the sync: with git, add `vault-to-site.zip` and `.vault-to-site/` to `.gitignore`.

## What the site has

- **The files** on the left, in folders, as in the file explorer
- **The note** in the middle, as Obsidian draws it in reading view: callouts, tables, code, formulas, diagrams, embeds, footnotes, properties
- **The outline and the backlinks** of the note on the right
- **Search** by the name of a note and by the words the notes show: press `/` or `Ctrl+K`
- **Dark and light**, as Obsidian was when the site was built, with a button to change it
- **An address for every note**, so the back and forward buttons of the browser work, a note that you come back to is where you left it, and a note or a heading can be bookmarked

On a narrow window, as on a phone, the two sides open over the note.

## Choosing what goes in

Three things decide, in this order. A later one always wins over an earlier one.

1. **The ticks.** A ticked folder takes in everything inside it, also what you add later. Take the tick off a folder or a note inside it to leave that out.
2. **Leave out by path.** JavaScript regular expressions, separated by commas. A path that one of them matches stays out. Upper and lower case are the same.

   | Input               | What stays out                                 |
   | ------------------- | ---------------------------------------------- |
   | `^Archive/`         | Everything in the top-level folder `Archive`   |
   | `(^\|/)_templates/` | Every folder called `_templates`, however deep |
   | `^Archive/, \.pdf$` | The folder `Archive`, and every PDF            |

3. **Leave out by property.** One property a line, as `key: value`. A note that has one of them stays out. To begin with these are `type: private` and `publish: false`.

Pictures and other files that are not notes follow the notes that use them:

- **A file comes along** when a note of the site uses it, ticked or not. A note never comes along that way.
- **A file stays out** when notes use it but none of the site does, even when it is ticked. So ticking a whole folder of pictures does not put the pictures of a private note into the site.
- **A ticked file that no note uses goes in.** It was asked for on its own.

In the tree, a ticked note or file that a rule keeps out is crossed out, with the rule beside it.

## What keeps a note out of the site

A note that is not part of the site leaves nothing in it:

- It is not in the list of files, not in the search, and not among the backlinks.
- **An embed of it is emptied,** also an embed inside an embedded note. Obsidian puts the text of an embedded note into the note that embeds it. The build takes it out again, and the site says "Not part of this site" in its place.
- **A link to it leads nowhere.** The words the link shows stay, because they are part of the note that has the link. Where the link led is removed, and the search finds only the words that show.
- **Its pictures stay out with it,** as told above.

The step **Look over** lists the links and embeds that are cut this way.

**A name can still show.** The build cannot know every way a name gets onto a page: the words of a link, a sentence that mentions the note, or what another plugin writes when a note is drawn, such as a query that lists notes. So after a build, the words of every page are looked through for the names of the notes that a rule keeps out, and the dialog says which name shows where. It changes nothing: whether a name may show is for you to say.

## Putting the site on GitHub Pages

The folder of the site is ready for it: every address in it is relative, and it has the `.nojekyll` file that GitHub Pages needs to serve all of it. Put the content of the folder into the repository or the branch that your pages are served from.

**A site on GitHub Pages can be read by everyone.** Look over the list before you build for it.

## The style sheets

The site looks like your Obsidian because a build copies the style sheets that your Obsidian has loaded: those of the app, of your theme, of your snippets, and of your plugins, with the fonts they use. They are copied on your device at the time of the build. None of them is part of this plugin.

Those style sheets belong to their authors, and the ones of the app to Obsidian. Other plugins that publish notes do the same, but there is no written permission for it. Keep that in mind before you put a site where everyone can see it.

## Limits

- **A site is a picture of the vault at the time of the build.** What a plugin shows in a note, such as the result of a query, is as it was then. Every build draws every note again.
- **An archive is at most 4 GB and 65,535 files.** A larger site is built as a folder.
- **Canvases and bases are not drawn.** They are files of the site that can be opened, not pages.
- **There is no graph view.**
- **A link to a block leads to its note,** not to the block.
- **A site is written inside the vault,** because that is where a plugin may write on a phone.
- **In a link to a note outside the site, the words stay.** A link written without other words shows the name of its note.

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
