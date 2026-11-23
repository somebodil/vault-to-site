import { extensionOf, hashOf } from "./ids.ts";

/** The style sheets Obsidian has loaded, as one sheet for the site, and the files that sheet points to */
export interface CapturedStyles {
  css: string;
  /** Fonts and pictures of the sheets: the name in the site, next to the sheet, and the content */
  resources: { name: string; bytes: ArrayBuffer }[];
}

const URL_IN_CSS = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/g;

/**
 * Reads every style sheet of the page of Obsidian: the app, the theme, the
 * snippets, the plugins, and what the drawing of formulas added. Nothing of
 * this is shipped with the plugin: it is copied from the Obsidian that runs,
 * at the time of the build.
 *
 * A sheet points to fonts and pictures by addresses that only work inside
 * Obsidian. Those are fetched and written next to the sheet.
 */
export async function captureStyles(doc: Document): Promise<CapturedStyles> {
  const parts: string[] = [];
  const wanted = new Map<string, string>();

  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A sheet from another site cannot be read. It is left out.
      continue;
    }
    const base = sheet.href ?? doc.baseURI;
    let text = "";
    for (const rule of Array.from(rules)) {
      text += rule.cssText + "\n";
    }
    parts.push(
      text.replace(URL_IN_CSS, (whole, double: string | undefined, single: string | undefined, bare: string | undefined) => {
        const address = (double ?? single ?? bare ?? "").trim();
        const local = localAddress(address, base, doc);
        if (local === null) {
          return whole;
        }
        let name = wanted.get(local);
        if (name === undefined) {
          const extension = extensionOf(new URL(local).pathname);
          name = "res/" + hashOf(local) + (extension === "" ? "" : "." + extension);
          wanted.set(local, name);
        }
        return `url("${name}")`;
      }),
    );
  }

  const resources: CapturedStyles["resources"] = [];
  for (const [address, name] of wanted) {
    try {
      // The address is a file that Obsidian serves to its own page, such as a font of the app.
      // `requestUrl` is for the web and cannot reach it.
      const response = await doc.defaultView?.fetch(address);
      if (response === undefined) {
        continue;
      }
      if (response.ok) {
        resources.push({ name, bytes: await response.arrayBuffer() });
      }
    } catch {
      // Without the file the site falls back to another font
    }
  }
  return { css: parts.join("\n"), resources };
}

/** The full address of a file that Obsidian serves itself, or null for what is inline or on the web */
function localAddress(address: string, base: string, doc: Document): string | null {
  if (address === "" || address.startsWith("data:") || address.startsWith("blob:") || address.startsWith("#")) {
    return null;
  }
  try {
    const url = new URL(address, base);
    return url.origin === new URL(doc.baseURI).origin ? url.href : null;
  } catch {
    return null;
  }
}
