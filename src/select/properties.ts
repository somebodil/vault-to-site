/**
 * A property that keeps a note out of the site, as `key: value`. A note with
 * `type: private` among its properties is left out whatever is ticked. A key
 * with no value, as `draft:`, is every note that has the property, whatever
 * it holds. A value between slashes, as `type: /^(private|meta)$/`, is a
 * regular expression: the property meets the rule when the expression finds
 * something in what it holds. Letters after the last slash are its flags, as
 * in `/^(private|meta)$/i`.
 */
export interface PropertyRule {
  key: string;
  /** As it was written, also for a regular expression: `/^(private|meta)$/` */
  value: string;
  /** The regular expression of a value that is written between slashes, with the flags after them. It ignores case. */
  pattern?: RegExp;
}

/** The rules a vault starts with. `publish: false` is what Obsidian Publish reads. */
export const DEFAULT_PROPERTY_RULES = "type: private\npublish: false";

/**
 * The lines that are not a rule: text without a colon, or without a key
 * before it. A line that was meant as a rule and is not one keeps nothing
 * out, so it is not passed over in silence.
 */
export function invalidPropertyLines(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && line.indexOf(":") < 1);
}

/**
 * The flags a value that is a regular expression may have after its last
 * slash. `i` is taken and changes nothing: upper and lower case are the same
 * in every rule. A flag that makes an expression find things one after the
 * other, as `g`, is not for a rule that is asked once for each value.
 */
const FLAGS = "imsu";

/**
 * What is written between the slashes of a value that is a regular
 * expression, as `/^draft/`, with the letters after the last slash, or null
 * for a value that is plain text. Two slashes with nothing between them are
 * plain text, and so is a value with one slash.
 */
function patternParts(value: string): { source: string; flags: string } | null {
  const parts = /^\/(.+)\/([A-Za-z]*)$/s.exec(value);
  return parts === null ? null : { source: parts[1] ?? "", flags: parts[2] ?? "" };
}

/**
 * The regular expression of a value, null for plain text, "flags" for one
 * with a flag that a rule cannot have, and "invalid" for one that cannot be
 * compiled.
 */
function patternOf(value: string): RegExp | null | "flags" | "invalid" {
  const parts = patternParts(value);
  if (parts === null) {
    return null;
  }
  if ([...parts.flags].some((flag) => !FLAGS.includes(flag))) {
    return "flags";
  }
  try {
    // As the patterns for paths: upper and lower case are the same, and letters are compared in one form
    return new RegExp(parts.source.normalize("NFC"), parts.flags.includes("i") ? parts.flags : "i" + parts.flags);
  } catch {
    return "invalid";
  }
}

/** The lines whose value is written as a regular expression and is not one that works, with what is wrong with each */
function brokenPatterns(input: string): { line: string; why: "flags" | "invalid" }[] {
  const broken: { line: string; why: "flags" | "invalid" }[] = [];
  for (const line of input.split("\n").map((one) => one.trim())) {
    const pattern = line.indexOf(":") >= 1 ? patternOf(line.slice(line.indexOf(":") + 1).trim()) : null;
    if (pattern === "flags" || pattern === "invalid") {
      broken.push({ line, why: pattern });
    }
  }
  return broken;
}

/**
 * What is wrong with an input of properties, said for the one who wrote it:
 * nothing when every line is a rule that works. A line whose value is written
 * as a regular expression that is not a valid one, as `type: /(/`, or that
 * has a flag a rule cannot have, as `type: /private/g`, keeps nothing out and
 * marks nothing, so it is not passed over in silence either.
 */
export function propertyProblems(input: string): string[] {
  return [
    ...invalidPropertyLines(input).map((line) => `"${line}" is not a property: write it as key: value.`),
    ...brokenPatterns(input).map(({ line, why }) =>
      why === "flags" ? `"${line}" has letters after its last slash that are not flags of a rule: only i, m, s and u are.` : `"${line}" does not hold a valid regular expression.`,
    ),
  ];
}

/**
 * One rule a line. Lines without a colon, or without a key, are not rules:
 * see `invalidPropertyLines`. Nor is a line whose regular expression is not
 * a valid one, or has a flag a rule cannot have: see `propertyProblems`.
 */
export function parsePropertyRules(input: string): PropertyRule[] {
  const rules: PropertyRule[] = [];
  for (const line of input.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "") {
      continue;
    }
    const pattern = patternOf(value);
    if (pattern === null) {
      rules.push({ key, value });
    } else if (pattern !== "flags" && pattern !== "invalid") {
      rules.push({ key, value, pattern });
    }
  }
  return rules;
}

/** A key or a plain value as it is compared: in lower case, and with its letters in one form, as a pattern has them */
const fold = (value: unknown): string => String(value).trim().normalize("NFC").toLowerCase();

/** True when what a property holds meets the value of a rule: the same text, or text the regular expression finds something in */
function meets(item: unknown, rule: PropertyRule): boolean {
  return rule.pattern === undefined ? fold(item) === fold(rule.value) : rule.pattern.test(String(item).trim().normalize("NFC"));
}

/**
 * The first rule the properties of a note meet, or null. Upper and lower case
 * are the same in keys and in values. A property that is a list meets a rule
 * when one of its items does: a regular expression is tried on each item by
 * itself, not on the list as a whole.
 */
export function matchingRule(properties: Record<string, unknown> | undefined, rules: readonly PropertyRule[]): PropertyRule | null {
  if (properties === undefined) {
    return null;
  }
  for (const rule of rules) {
    for (const [key, value] of Object.entries(properties)) {
      if (fold(key) !== fold(rule.key)) {
        continue;
      }
      const items: unknown[] = Array.isArray(value) ? value : [value];
      if (rule.value === "" || items.some((item) => meets(item, rule))) {
        return rule;
      }
    }
  }
  return null;
}
