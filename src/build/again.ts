import { type App, Notice } from "obsidian";
import { signatureOf } from "../select/choose.ts";
import { readSettings, type Settings } from "../settings.ts";
import { planSite } from "./plan.ts";
import { buildSite } from "./site.ts";

/**
 * What a program that runs Obsidian without its window leaves in the page
 * for a command (obsidian-cmd-runner). It is not there when a person runs
 * the command.
 */
interface Runner {
  /** What the run was given: `settings` holds settings of this plugin, laid over the saved ones */
  args: Record<string, unknown>;
  claim(): void;
  done(result?: unknown): void;
  fail(error: unknown): void;
  log(message: string): void;
}

/**
 * Builds the site without the dialog.
 *
 * The dialog is where the list of what goes in is looked over, and a build
 * without it is done only where that is not lost:
 *
 * - **A person** gets the site that was looked over last. When other notes
 *   or files would go in now, nothing is built, and the dialog is the way.
 * - **A program**, as on a server after every push, has nobody to look. It
 *   says in its settings what goes in, and should say it by a mark on each
 *   note (`only`, as `publish: true`), so that a note does not go in by
 *   being new. What went in is given back, for the record of the run.
 *
 * @param claim called with the place that is written to: see `buildSite`
 */
export async function buildAgain(app: App, saved: Settings, version: string, claim: (place: string) => Promise<void>): Promise<void> {
  const runner = (window as unknown as { obsidianCmdRunner?: Runner }).obsidianCmdRunner;
  if (runner !== undefined) {
    runner.claim();
    try {
      runner.done(await unattended(app, saved, version, runner));
    } catch (error) {
      runner.fail(error);
    }
    return;
  }

  const { choice, invalid } = planSite(app, saved);
  if (invalid.length > 0 || saved.reviewed === "" || signatureOf(choice) !== saved.reviewed) {
    new Notice('The site would not be the one you looked over last: other notes or files would go in. Run "Build a site" and look it over.', 10_000);
    return;
  }
  const notice = new Notice("Building the site", 0);
  try {
    const result = await buildSite(
      app,
      saved,
      version,
      saved.reviewed,
      claim,
      (finished, total) => notice.setMessage(`Building the site: ${String(Math.min(finished + 1, total))} of ${String(total)}`),
      { now: false },
    );
    notice.setMessage(`The site is built: ${String(result.notes)} notes, in "${result.place}".`);
    window.setTimeout(() => notice.hide(), 6000);
  } catch (error) {
    notice.setMessage(`The site could not be built. ${error instanceof Error ? error.message : String(error)}`);
    window.setTimeout(() => notice.hide(), 12_000);
  }
}

/**
 * How wide a note is taken to be when nobody has Obsidian open at a size of
 * their own. A program runs it in a window of whatever size, at times with
 * no screen at all, and what is drawn to fit the width of a note, as a
 * diagram is, must not come out by that chance. To begin with, the width of
 * a window on a computer; `width` among what the run is given says another.
 */
const WIDTH_UNATTENDED = 1100;

function widthOf(given: unknown): number {
  return typeof given === "number" && Number.isFinite(given) && given >= 320 && given <= 10_000 ? Math.round(given) : WIDTH_UNATTENDED;
}

async function unattended(app: App, saved: Settings, version: string, runner: Runner): Promise<unknown> {
  const given = runner.args.settings;
  if (given !== undefined && (typeof given !== "object" || given === null || Array.isArray(given))) {
    throw new Error('The settings for the run have to be an object, as {"ticks": {"on": [""]}, "only": "publish: true"}.');
  }
  // Laid over what is saved in the vault, and read with the same care: what is of the wrong kind falls back
  const settings = given === undefined ? saved : readSettings({ ...saved, ...given });
  if (settings.ticks.on.length === 0) {
    throw new Error('Nothing is ticked, so nothing would go into the site. Say what goes in: {"ticks": {"on": [""]}} is the whole vault, and "only": "publish: true" takes of it the notes that are marked.');
  }
  const { choice, invalid } = planSite(app, settings);
  if (invalid.length > 0) {
    throw new Error(`${invalid.join(" ")} A site is not built with a rule that does not work.`);
  }
  if (choice.notes.length === 0) {
    throw new Error("No note would go into the site: none that is ticked passes the rules.");
  }
  runner.log(`${String(choice.notes.length)} notes and ${String(choice.files.length)} other files go in.`);
  for (const file of choice.extra) {
    runner.log(`"${file.from}" goes in as "${file.to}".`);
  }
  let said = 0;
  const result = await buildSite(
    app,
    settings,
    version,
    signatureOf(choice),
    // Nothing is saved in a run: the settings of the run are not those of the vault
    () => Promise.resolve(),
    (finished, total) => {
      const tenth = Math.floor((finished * 10) / total);
      if (tenth > said && tenth < 10) {
        said = tenth;
        runner.log(`${String(tenth * 10)}%`);
      }
    },
    { now: false },
    widthOf(runner.args.width),
  );
  if (result.failed.length > 0) {
    throw new Error(`${String(result.failed.length)} notes could not be drawn: ${result.failed.map((one) => `${one.path} (${one.message})`).join("; ")}`);
  }
  return {
    place: result.place,
    notes: choice.notes,
    files: choice.files,
    extra: choice.extra,
    bytes: result.bytes,
    seconds: result.millis / 1000,
    keptOut: {
      byProperty: choice.byProperty.length,
      byPattern: choice.byPattern.length,
      unknownProperties: choice.unread.length,
      notNamed: choice.unnamed.length,
      notMarked: choice.unmarked.length,
    },
    cutLinks: choice.cut.length,
    unfinished: result.unfinished,
    mentions: result.mentions,
  };
}
