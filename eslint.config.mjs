import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores(["node_modules", "main.js", "esbuild.config.mjs"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"],
        },
      },
    },
  },
  {
    // The script of the site runs in a plain browser, where nothing of Obsidian exists: no popout
    // windows, no `createEl`, no `Platform`. What it puts on the page with innerHTML is what the
    // build took from Obsidian: the notes as Obsidian drew them, and its icons.
    files: ["src/viewer/**"],
    rules: {
      "obsidianmd/prefer-active-doc": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/prefer-instanceof": "off",
      "obsidianmd/platform": "off",
      "no-unsanitized/property": "off",
      "@microsoft/sdl/no-inner-html": "off",
    },
  },
  {
    // `describe` and `it` of node:test return promises that the test runner takes care of
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
]);
