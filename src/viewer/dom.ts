/**
 * The script of the site runs in a plain browser: nothing of Obsidian is
 * there, so elements are made with what every browser has.
 */

interface Options {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: Options = {},
  children: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.cls !== undefined) {
    node.className = options.cls;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  for (const [name, value] of Object.entries(options.attr ?? {})) {
    node.setAttribute(name, value);
  }
  for (const child of children) {
    if (child !== null) {
      node.appendChild(child);
    }
  }
  return node;
}

/** A button with an icon of Obsidian. Without the icon it shows the first letter of its name. */
export function iconButton(icons: Record<string, string>, icon: string, label: string, onClick: () => void): HTMLElement {
  const button = el("div", { cls: "clickable-icon v2s-button", attr: { "aria-label": label, role: "button", tabindex: "0" } });
  setIcon(button, icons, icon, label);
  button.addEventListener("click", onClick);
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  });
  return button;
}

export function setIcon(target: HTMLElement, icons: Record<string, string>, icon: string, label: string): void {
  const svg = icons[icon];
  if (svg === undefined) {
    target.textContent = label.charAt(0);
    return;
  }
  target.replaceChildren(...iconNodes(svg));
}

/**
 * Reads HTML into nodes of this page, as Obsidian drew it for the build: a
 * note, or an icon. The browser reads it in a document of its own, where
 * nothing of it runs and nothing is fetched, and the nodes are moved here.
 */
export function htmlNodes(html: string): Node[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return Array.from(document.adoptNode(parsed.body).childNodes);
}

/** Each icon read once: the tree of a large site has a triangle on every folder, and every list item that folds has one */
const readIcons = new Map<string, Node[]>();

/** An icon of Obsidian, as SVG that the build took from Obsidian, as new nodes for one place on the page. Empty for no icon. */
export function iconNodes(svg: string): Node[] {
  let nodes = readIcons.get(svg);
  if (nodes === undefined) {
    nodes = svg === "" ? [] : htmlNodes(svg);
    readIcons.set(svg, nodes);
  }
  return nodes.map((node) => node.cloneNode(true));
}

/** Reads and writes what the browser keeps for the site. A page opened from a file may be refused: then nothing is kept. */
export const kept = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem("v2s:" + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem("v2s:" + key, value);
    } catch {
      // Not kept
    }
  },
};

/** How long a frame of the data is waited for after it has loaded, for what it hands over: a missing file loads as well, as a page of the browser that says so */
const SAY_AFTER_LOAD = 1000;
/**
 * How long a frame of the data is waited for at most, should the browser never say that it has loaded. Safari
 * says nothing of a file that is missing when the site is opened from a file, where a file that is there loads at
 * once. On a web server a large note may take its time on a slow line.
 */
const longest = (): number => (window.location.protocol === "file:" ? 5_000 : 60_000);

/**
 * Loads a document of the data, `data/n/<id>.html` or `data/s/<n>.html`, and
 * gives back what it holds.
 *
 * The site has to work opened from a file, where a page may not read other
 * files: `fetch` is refused there. What a page may do there is show another
 * file in a frame. So each document of the data is a small page that holds
 * its content as JSON, with a script of the site (`app/frame.js`) that hands
 * the content over to this page as a message. The frame is not seen, and it
 * is taken away once it has said its content. It is no sandbox: Chrome and
 * Safari let a frame without an origin of its own load no script from a
 * file. The same works on a web server, so there is one way for both.
 *
 * A note is loaded when it is asked for, and the text to search in when the
 * search is opened: a large site opens as fast as a small one, and a note
 * that is read does not wait for all the others.
 */
export function loadData(src: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const frame = el("iframe", { cls: "v2s-data-frame", attr: { src, "aria-hidden": "true", tabindex: "-1" } });
    let late = 0;
    const end = (): void => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(late);
      frame.remove();
    };
    const fail = (): void => {
      end();
      reject(new Error("Could not load " + src));
    };
    late = window.setTimeout(fail, longest());
    const onMessage = (event: MessageEvent): void => {
      // Only the frame made here: another frame, as one in a note, says nothing to the site
      if (event.source === null || event.source !== frame.contentWindow) {
        return;
      }
      end();
      const said: unknown = event.data;
      const text = typeof said === "object" && said !== null ? (said as { vaultToSite?: unknown }).vaultToSite : undefined;
      try {
        resolve(JSON.parse(typeof text === "string" ? text : ""));
      } catch {
        reject(new Error("Could not read " + src));
      }
    };
    window.addEventListener("message", onMessage);
    frame.addEventListener("load", () => {
      window.clearTimeout(late);
      late = window.setTimeout(fail, SAY_AFTER_LOAD);
    });
    document.body.appendChild(frame);
  });
}
