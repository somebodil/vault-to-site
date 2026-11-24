import { type App, normalizePath } from "obsidian";
import { signatureOf } from "../select/choose.ts";
import { givenProblems, givenTicks, readSettings, type Settings } from "../settings.ts";
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

/**
 * The width a run asks for. One that cannot be taken makes the run fail: put
 * aside in silence, the site would be drawn at another width than was asked for.
 */
function widthOf(given: unknown): number {
  if (given === undefined) {
    return WIDTH_UNATTENDED;
  }
  if (typeof given !== "number" || !Number.isFinite(given) || given < 320 || given > 10_000) {
    throw new Error(`"width" has to be a number from 320 to 10000, the width of a note in pixels: ${JSON.stringify(given)} is not one.`);
  }
  return Math.round(given);
}

async function unattended(app: App, saved: Settings, version: string, runner: Runner, stop: { now: boolean }): Promise<unknown> {
  const given = runner.args.settings;
  if (given !== undefined && (typeof given !== "object" || given === null || Array.isArray(given))) {
    throw new Error('The settings for the run have to be an object, as {"ticks": {"on": [""]}, "only": "publish: true"}.');
  }
  const width = widthOf(runner.args.width);
  if (given === undefined) {
    // Not a failure: the names may be meant for another command of the same run. But settings under a name
    // with a mistake in it, as "setings", would be passed over, and the site built by what is saved.
    const others = Object.keys(runner.args).filter((name) => name !== "settings" && name !== "width");
    if (others.length > 0) {
      runner.log(`The run was given ${others.map((name) => `"${name}"`).join(", ")} and no "settings": this plugin reads "settings" and "width" only, and goes by what is saved in the vault.`);
    }
  }
  // A setting that cannot be read is not passed over: the site would be built without the rule it was written for
  const problems = given === undefined ? [] : givenProblems(given as Record<string, unknown>);
  if (problems.length > 0) {
    throw new Error(`${problems.join(" ")} A site is not built with settings that cannot be read.`);
  }
  // Laid over what is saved in the vault
  let told = given === undefined ? saved : readSettings({ ...saved, ...given });
  if (given !== undefined && (given as Record<string, unknown>).ticks !== undefined) {
    // The ticks that were given, as the vault has its paths, and each of them a folder or file that is there
    const ticks = givenTicks(told.ticks, normalizePath, (path) => app.vault.getAbstractFileByPath(path) !== null);
    if (ticks.problems.length > 0) {
      throw new Error(`${ticks.problems.join(" ")} A site is not built with a tick that is meant for nothing.`);
    }
    told = { ...told, ticks: ticks.ticks };
  }
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
  let said = 0;
  const result = await buildSite(
    app,
    settings,
    version,
    signatureOf(choice),
    (finished, total) => {
      const tenth = Math.floor((finished * 10) / total);
      if (tenth > said && tenth < 10) {
        said = tenth;
        runner.log(`${String(tenth * 10)}%`);
      }
    },
    stop,
    width,
    // Nobody looks at the pages: a note that could not be drawn makes the run fail, before the site takes its place
    true,
  );
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
