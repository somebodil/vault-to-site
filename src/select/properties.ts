/**
 * A property that keeps a note out of the site, as `key: value`. A note with
 * `type: private` among its properties is left out whatever is ticked.
 */
export interface PropertyRule {
  key: string;
  value: string;
}

/** The rules a vault starts with. `publish: false` is what Obsidian Publish reads. */
export const DEFAULT_PROPERTY_RULES = "type: private\npublish: false";

/** One rule a line. Lines without a colon, or without a key, are skipped. */
export function parsePropertyRules(input: string): PropertyRule[] {
  const rules: PropertyRule[] = [];
  for (const line of input.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key !== "") {
      rules.push({ key, value });
    }
  }
  return rules;
}

const fold = (value: unknown): string => String(value).trim().toLowerCase();

/**
 * The first rule the properties of a note meet, or null. Upper and lower case
 * are the same in keys and in values. A property that is a list meets a rule
 * when one of its items does.
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
      if (items.some((item) => fold(item) === fold(rule.value))) {
        return rule;
      }
    }
  }
  return null;
}
