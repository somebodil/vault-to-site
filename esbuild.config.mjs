import { readFileSync } from "node:fs";
import esbuild from "esbuild";

// `node esbuild.config.mjs production` builds once. Without the argument it rebuilds on every change.
const production = process.argv[2] === "production";

// The site that the plugin writes has a script of its own: what runs in the
// browser when index.html is opened. It is built first and goes into main.js
// as text, together with its style sheet, so that a release is still the
// three files Obsidian knows.
const viewer = await esbuild.build({
  entryPoints: ["src/viewer/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: production,
  write: false,
  logLevel: "info",
});

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  target: "es2020",
  // Obsidian provides it at run time
  external: ["obsidian"],
  define: {
    VIEWER_JS: JSON.stringify(viewer.outputFiles[0].text),
    VIEWER_CSS: JSON.stringify(readFileSync("src/viewer/viewer.css", "utf8")),
  },
  minify: production,
  sourcemap: production ? false : "inline",
  logLevel: "info",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  // The script of the site is not watched: start again after changing it
  await context.watch();
}
