/**
 * The patterns of an input of paths: the one that leaves paths out
 * (`exclude`), and the one that takes in only the paths it names (`include`).
 */
export interface ExcludeRules {
  /** The patterns that could be compiled. They ignore case. */
  patterns: RegExp[];
  /** True if a pattern is not a valid regular expression */
  hasInvalid: boolean;
  /** The patterns that are not a valid regular expression, as they were written */
  invalid: string[];
}

/**
 * Splits an exclude input at commas into patterns.
 *
 * A comma belongs to the pattern, not to the list, when it is escaped (`\,`),
 * inside a character class (`[a,b]`), inside a group (`(a,b)`) or inside a
 * quantifier (`{1,3}`).
 * Whitespace around a pattern is dropped, and so are empty patterns.
 */
export function splitPatterns(input: string): string[] {
  const patterns: string[] = [];
  let pattern = "";
  let inClass = false;
  /** How many groups are open */
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "\\") {
      // An escaped character never ends a pattern or a character class
      pattern += char + (input[i + 1] ?? "");
      i++;
      continue;
    }
    if (char === "," && !inClass && depth === 0 && !isQuantifierComma(pattern, input, i)) {
      patterns.push(pattern);
      pattern = "";
      continue;
    }
    if (char === "[") {
      inClass = true;
    } else if (char === "]") {
      inClass = false;
    } else if (!inClass && char === "(") {
      depth++;
    } else if (!inClass && char === ")") {
      depth = Math.max(0, depth - 1);
    }
    pattern += char;
  }
  patterns.push(pattern);
  return patterns.map((x) => x.trim()).filter((x) => x !== "");
}

/** True for the comma of `{1,3}` or `{2,}`: digits after "{" before it, digits and "}" after it. */
function isQuantifierComma(before: string, input: string, at: number): boolean {
  return /\{\d+$/.test(before) && /^\d*\}/.test(input.slice(at + 1));
}

/** Compiles an input of paths. Invalid patterns are left out and reported. */
export function parseExcludeRules(input: string): ExcludeRules {
  const rules: ExcludeRules = { patterns: [], hasInvalid: false, invalid: [] };
  for (const pattern of splitPatterns(input)) {
    try {
      // The same letters can be written in two ways, as one sign or as its parts: both sides are compared in one form
      rules.patterns.push(new RegExp(pattern.normalize("NFC"), "i"));
    } catch {
      rules.hasInvalid = true;
      rules.invalid.push(pattern);
    }
  }
  return rules;
}

/** Answers for many paths whether one of the patterns matches */
export function pathMatcher(rules: ExcludeRules): (path: string) => boolean {
  // The same letters can be stored as one sign or as its parts: a path is compared in the form the patterns have
  return (path) => {
    const normal = path.normalize("NFC");
    return rules.patterns.some((pattern) => pattern.test(normal));
  };
}
