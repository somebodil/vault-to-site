/**
 * The script of a document of the data (`data/n/<id>.html`, `data/s/<n>.html`):
 * it hands what the document holds to the page that shows the site, which
 * loaded the document in a frame (`loadData` in dom.ts says why). It runs in
 * that frame, before the frame is done loading, and does nothing else.
 */

const data = document.querySelector('script[type="application/json"]')?.textContent ?? null;
// On a web server the page is of the same origin as this document, and only it may get the message. A page
// opened from a file has no origin that a message could name, so there it goes to the page that holds the frame.
const page = window.location.protocol === "file:" ? "*" : window.location.origin;
window.parent.postMessage({ vaultToSite: data }, page);

// A module, so that its names are its own and not those of every file
export {};
