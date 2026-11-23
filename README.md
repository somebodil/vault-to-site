# vault-to-site

An [Obsidian](https://obsidian.md) plugin that builds the notes you choose into a website to read them: a folder with an `index.html` that you open with a browser. The site looks like your vault, because Obsidian itself draws every note for it, and it cannot be edited.

- **It opens from a file.** Double-click `index.html`: no server, no network. The same folder also works on a web server or on GitHub Pages as it is.
- **You choose what goes in.** Tick folders and notes in a tree, leave paths out with regular expressions, and leave notes out by a property.
- **Nothing gets in unseen.** Before a build you look over the list of every note that goes in, and of what was kept out and why.

## Requirements

- Obsidian 1.8.7 or later, on a computer, a phone, or a tablet

## Getting started

1. Run the command **vault-to-site: Build a site**, or tap its icon in the ribbon.
2. Tick what goes into the site, and choose **Look over**.
3. Read the list, and choose **Build**.
4. Open `index.html` in the folder of the site with a browser. The folder is `.vault-to-site` in your vault until you change it.

## What the site has

- **The files** on the left, in folders, as in the file explorer
- **The note** in the middle, as Obsidian draws it in reading view: callouts, tables, code, formulas, diagrams, embeds, footnotes, properties
- **The outline and the backlinks** of the note on the right
- **Search** by the name of a note and by the text of the notes: press `/` or `Ctrl+K`
- **Dark and light**, as Obsidian was when the site was built, with a button to change it
- **An address for every note**, so the back and forward buttons of the browser work, and a note or a heading can be bookmarked

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

Pictures and other files that are not notes come along when a note of the site uses them, ticked or not. A note never comes along that way.

## What keeps a note out of the site

A note that is not part of the site leaves nothing in it:

- It is not in the list of files, not in the search, and not among the backlinks.
- **An embed of it is emptied.** Obsidian puts the text of an embedded note into the note that embeds it. The build takes it out again, and the site says "Not part of this site" in its place.
- **A link to it leads nowhere.** The words of the link stay, because they are part of the note that has the link. Where the link led is removed.
- **A picture that a pattern keeps out is not shown.**

The step **Look over** lists the links and embeds that are cut this way.

What the build cannot know: text that another plugin writes into a note when it is drawn. A query that lists the names of other notes lists them in the site too.

## Putting the site on GitHub Pages

The folder of the site is ready for it: every address in it is relative, and it has the `.nojekyll` file that GitHub Pages needs to serve all of it. Put the content of the folder into the repository or the branch that your pages are served from.

**A site on GitHub Pages can be read by everyone.** Look over the list before you build for it.

## The style sheets

The site looks like your Obsidian because a build copies the style sheets that your Obsidian has loaded: those of the app, of your theme, of your snippets, and of your plugins, with the fonts they use. They are copied on your device at the time of the build. None of them is part of this plugin.

Those style sheets belong to their authors, and the ones of the app to Obsidian. Other plugins that publish notes do the same, but there is no written permission for it. Keep that in mind before you put a site where everyone can see it.

## Limits

- **A site is a picture of the vault at the time of the build.** What a plugin shows in a note, such as the result of a query, is as it was then.
- **Canvases and bases are not drawn.** They are files of the site that can be opened, not pages.
- **There is no graph view.**
- **A link to a block leads to its note,** not to the block.
- **On a phone or a tablet the site is written inside the vault,** because that is where a plugin may write there.

## Development

You need [Node.js](https://nodejs.org) 24 or later.

```bash
npm install
npm run dev     # rebuilds main.js on every change
npm run check   # type check, lint, and tests
npm run build   # type check, then the main.js of a release
```

- `src/select` decides what goes into a site. It knows nothing about Obsidian, so its tests run with plain Node.js.
- `src/build` has Obsidian draw the notes and writes the site.
- `src/ui` holds the dialog.
- `src/viewer` is the script of the site, which runs in the browser. It is built on its own and goes into `main.js` as text.

To try a build, copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/vault-to-site/` in a vault.

## License

[MIT](LICENSE)
