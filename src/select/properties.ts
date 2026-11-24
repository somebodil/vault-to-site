/**
 * A property that keeps a note out of the site, as `key: value`. A note with
 * `type: private` among its properties is left out whatever is ticked. A key
 * with no value, as `draft:`, is every note that has the property, whatever
 * it holds. A value between slashes, as `type: /^(private|meta)$/`, is a
 * regular expression: the property meets the rule when the expression finds
 * something in what it holds.
 */
export interface PropertyRule {
  key: string;
  /** As it was written, also for a regular expression: `/^(private|meta)$/` */
  value: string;
  /** The regular expression of a value that is written between slashes. It ignores case. */
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
 * What is written between the slashes of a value that is a regular
 * expression, as `/^draft/`, or null for a value that is plain text. Two
 * slashes with nothing between them are plain text.
 */
function patternSource(value: string): string | null {
  return value.length > 2 && value.startsWith("/") && value.endsWith("/") ? value.slice(1, -1) : null;
}

/** The regular expression of a value, null for plain text, and "invalid" for one that cannot be compiled */
function patternOf(value: string): RegExp | null | "invalid" {
  const source = patternSource(value);
  if (source === null) {
    return null;
  }
  try {
    // As the patterns for paths: upper and lower case are the same, and letters are compared in one form
    return new RegExp(source.normalize("NFC"), "i");
  } catch {
    return "invalid";
  }
}

/**
 * The lines whose value is written as a regular expression that is not a
 * valid one, as `type: /(/`. Such a line keeps nothing out and marks
 * nothing, so it is not passed over in silence either.
 */
export function invalidPropertyPatterns(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.indexOf(":") >= 1 && patternOf(line.slice(line.indexOf(":") + 1).trim()) === "invalid");
}

/** What is wrong with an input of properties, said for the one who wrote it: nothing when every line is a rule that works */
export function propertyProblems(input: string): string[] {
  return [
    ...invalidPropertyLines(input).map((line) => `"${line}" is not a property: write it as key: value.`),
    ...invalidPropertyPatterns(input).map((line) => `"${line}" does not hold a valid regular expression.`),
  ];
}

/**
 * One rule a line. Lines without a colon, or without a key, are not rules:
 * see `invalidPropertyLines`. Nor is a line whose regular expression is not
 * a valid one: see `invalidPropertyPatterns`.
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
    } else if (pattern !== "invalid") {
      rules.push({ key, value, pattern });
    }
  }
  return rules;
}

const fold = (value: unknown): string => String(value).trim().toLowerCase();

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
