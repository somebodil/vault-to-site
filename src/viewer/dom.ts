/**
 * The script of the site runs in a plain browser: nothing of Obsidian is
 * there, so elements are made with what every browser has.
 */

export interface Options {
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
  // The icons are SVG that the build took from Obsidian
  target.innerHTML = svg;
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

/** Loads a script of the data. A page opened from a file may load scripts, though it may not read files. */
export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      script.remove();
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("Could not load " + src));
    };
    document.head.appendChild(script);
  });
}
