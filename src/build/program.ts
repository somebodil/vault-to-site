import { type App, normalizePath } from "obsidian";
import { signatureOf } from "../select/choose.ts";
import { givenProblems, placeOf, readSettings, type Settings } from "../settings.ts";
import { isSiteArchive } from "./output.ts";
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
 * Builds the site for a program that runs Obsidian without its window, and
 * tells it how the build went. The command comes here first: with nobody
 * there, a dialog would wait for a click that never comes.
 *
 * The dialog is where a person looks over the list of what goes in. A
 * program, as on a server after every push, has nobody to look: it says in
 * its settings what goes in, and should say it by a mark on each note
 * (`only`, as `publish: true`), so that a note does not go in by being new.
 * Told nothing, the whole vault goes in. What went in is given back, for
 * the record of the run.
 *
 * @param stop held by the plugin, which sets it when it is turned off: there is no dialog here to stop the build from
 * @returns false when a person runs the command: nothing was done then
 */
export async function buildForProgram(app: App, saved: Settings, version: string, stop: { now: boolean }): Promise<boolean> {
  const runner = (window as unknown as { obsidianCmdRunner?: Runner }).obsidianCmdRunner;
  if (runner === undefined) {
    return false;
  }
  runner.claim();
  try {
    runner.done(await unattended(app, saved, version, runner, stop));
  } catch (error) {
    runner.fail(error);
  }
  return true;
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

async function unattended(app: App, saved: Settings, version: string, runner: Runner, stop: { now: boolean }): Promise<unknown> {
  const given = runner.args.settings;
  if (given !== undefined && (typeof given !== "object" || given === null || Array.isArray(given))) {
    throw new Error('The settings for the run have to be an object, as {"ticks": {"on": [""]}, "only": "publish: true"}.');
  }
  // A setting that cannot be read is not passed over: the site would be built without the rule it was written for
  const problems = given === undefined ? [] : givenProblems(given as Record<string, unknown>);
  if (problems.length > 0) {
    throw new Error(`${problems.join(" ")} A site is not built with settings that cannot be read.`);
  }
  // Laid over what is saved in the vault
  const told = given === undefined ? saved : readSettings({ ...saved, ...given });
  // Told nothing on what goes in, the whole vault does: a run with no settings at all builds a site, as the settings are to begin with
  const settings = told.ticks.on.length === 0 ? { ...told, ticks: { on: [""], off: told.ticks.off } } : told;
  if (settings !== told) {
    runner.log('Nothing is ticked: the whole vault goes in. Settings say otherwise, as {"ticks": {"on": ["Folder"]}} or "only": "publish: true".');
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
  // Nothing is saved in a run, so there is no record that the archive of the run before is the plugin's:
  // it is known by what it holds. A file of someone else at its place is still refused.
  const place = placeOf(settings, normalizePath);
  const isOwnArchive = settings.format === "zip" && !settings.written.includes(place) && (await isSiteArchive(app.vault.adapter, place));
  let said = 0;
  const result = await buildSite(
    app,
    isOwnArchive ? { ...settings, written: [...settings.written, place] } : settings,
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
    stop,
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
