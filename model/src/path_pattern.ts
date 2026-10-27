/**
 * Matches a declared pattern against a file's path relative to the selected root.
 *
 * Paths, not bare file names: the plate is frequently a directory rather than part
 * of the file name, so `{{Plate}}/{{Well}}_{{Chain}}.ab1` has to bind `{{Plate}}`
 * to a path segment.
 */

export type Range = { from: number; to: number };
export type Match = Range & { value: string };

export type PathGroups<T> = {
  well: T;
  plate?: T;
  chain?: T;
  direction?: T;
  tags?: Record<string, T>;
  anyMatchers: T[];
};

export type PathPatternMatch = PathGroups<Match>;

export type CompiledSpec = {
  regex: string;
  groups: {
    well: number;
    plate?: number;
    chain?: number;
    direction?: number;
    tags?: Record<string, number>;
  };
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Literal text, with `[a|b]` sections compiled to an optional alternation.
 *
 * It exists for one shape: a set filed one directory per chain, where the
 * folder is the plate with a suffix. `{{Plate}}[_LC|_KC]/` reads `Plate1` from
 * all three of `Plate1`, `Plate1_LC` and `Plate1_KC`, because the alternatives
 * are stated rather than guessed. Without them the plate token is lazy and
 * collapses to the shortest thing that still lets the rest match.
 *
 * The section captures nothing, so it holds literal text only.
 */
function compileLiteral(text: string, pattern: string): string {
  let out = "";
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("[", at);
    if (open < 0) {
      out += escapeRegExp(text.slice(at));
      break;
    }
    out += escapeRegExp(text.slice(at, open));
    const close = text.indexOf("]", open);
    if (close < 0) throw new Error(`Unclosed [ in ${pattern}`);
    const body = text.slice(open + 1, close);
    if (body === "") throw new Error(`Empty [] in ${pattern}`);
    if (body.includes("/")) throw new Error(`[] cannot span a directory in ${pattern}`);
    if (body.includes("{")) throw new Error(`[] holds literal text only, in ${pattern}`);
    out += "(?:" + body.split("|").map(escapeRegExp).join("|") + ")?";
    at = close + 1;
  }
  return out;
}

function getMatch(m: RegExpMatchArray, idx: number): Match {
  const bounds = m.indices?.[idx];
  if (bounds === undefined || m[idx] === undefined)
    throw new Error(`Group ${idx} matched without a position`);
  return { from: bounds[0], to: bounds[1], value: m[idx] };
}

// A token never spans a directory boundary: a plate is one directory and a well
// sits in one file name, so letting `.` cross `/` only produces silent mis-splits.
const SEGMENT = "([^/]+?)";
const SEGMENT_NUM = "([0-9]+)";

// Longer alternatives first: JS alternation is leftmost-wins, so `w|well` would
// match the "W" of "{{Well}}" and leave "ell}}" as stray text.
const TOKEN =
  /\{\{ *(?<well>well|w)|\{\{ *(?<plate>plate|p)|\{\{ *(?<chain>chain|c)|\{\{ *(?<direction>direction|d)|\{\{ *\*?:(?<tag>[a-zA-Z0-9_]+)|\{\{ *(?<any>\*)|\{\{ *(?<anynum>n)/dgi;

// Capillary sequencing reads a template from each end, marked F/R or fwd/rev.
// Not Illumina's R1/R2, though the digits are accepted for sets named that way.
const DIRECTION = "(fwd|rev|[fFrR]|[rR]?[12])";

export class PathPattern {
  private constructor(
    private readonly regexp: RegExp,
    private readonly groups: PathGroups<number>,
    public readonly rawPattern: string,
    public readonly rawElements: PathGroups<Range>,
  ) {}

  public get hasPlate(): boolean {
    return this.groups.plate !== undefined;
  }

  public get hasChain(): boolean {
    return this.groups.chain !== undefined;
  }

  public get hasDirection(): boolean {
    return this.groups.direction !== undefined;
  }

  public get tags(): string[] {
    return this.groups.tags ? Object.keys(this.groups.tags).sort() : [];
  }

  /**
   * How many path segments the pattern spans. A path is matched against its last
   * `segmentCount` segments, so `{{Plate}}/{{Well}}.ab1` sees the plate directory
   * whatever else sits above it.
   */
  public get segmentCount(): number {
    return this.rawPattern.split("/").length;
  }

  /** The extension the pattern ends in, lowercased, without the dot. */
  public get extension(): string {
    const dot = this.rawPattern.lastIndexOf(".");
    return dot < 0 ? "" : this.rawPattern.slice(dot + 1).toLowerCase();
  }

  /**
   * The compiled regex and which capture group holds which field, for the workflow
   * to apply the same matching without reimplementing the token grammar.
   */
  public get compiled(): CompiledSpec {
    return {
      regex: this.regexp.source,
      groups: {
        well: this.groups.well,
        plate: this.groups.plate,
        chain: this.groups.chain,
        direction: this.groups.direction,
        tags: this.groups.tags,
      },
    };
  }

  public match(relativePath: string): PathPatternMatch | undefined {
    const m = relativePath.match(this.regexp);
    if (!m) return undefined;

    const result: PathPatternMatch = {
      well: getMatch(m, this.groups.well),
      anyMatchers: [],
    };
    if (this.groups.plate !== undefined) result.plate = getMatch(m, this.groups.plate);
    if (this.groups.chain !== undefined) result.chain = getMatch(m, this.groups.chain);
    if (this.groups.direction !== undefined) result.direction = getMatch(m, this.groups.direction);
    if (this.groups.tags !== undefined) {
      result.tags = {};
      for (const [name, gi] of Object.entries(this.groups.tags))
        result.tags[name] = getMatch(m, gi);
    }
    for (const gi of this.groups.anyMatchers) result.anyMatchers.push(getMatch(m, gi));
    return result;
  }

  static parse(pattern: string): PathPattern {
    let regexp = "^";
    let lastIndex = 0;
    let groupCounter = 1;
    const groups: Partial<PathGroups<number>> = { tags: {}, anyMatchers: [] };
    const raw: Partial<PathGroups<Range>> = { tags: {}, anyMatchers: [] };

    const single = (
      key: "well" | "plate" | "chain" | "direction",
      label: string,
      re: string,
      range: Range,
    ) => {
      if (groups[key] !== undefined) throw new Error(`Repeated ${label} matcher`);
      groups[key] = groupCounter++;
      raw[key] = range;
      regexp += re;
    };

    for (const m of pattern.matchAll(TOKEN)) {
      // The token regex stops before the closing braces so each alternative can be
      // named; consume them here or they land in the literal text.
      const open = m.indices?.[0];
      if (open === undefined) throw new Error("Token matched without its position");
      const close = pattern.indexOf("}}", open[1]);
      if (close < 0) throw new Error(`Unclosed token at ${open[0]} in ${pattern}`);
      const between = pattern.slice(open[1], close).trim();
      if (between !== "")
        throw new Error(`Unexpected text in token: ${pattern.slice(open[0], close + 2)}`);

      const range = { from: open[0], to: close + 2 };
      regexp += compileLiteral(pattern.substring(lastIndex, open[0]), pattern);
      lastIndex = close + 2;

      const g = m.groups!;
      if (g["well"]) single("well", "{{Well}}", SEGMENT, range);
      else if (g["plate"]) single("plate", "{{Plate}}", SEGMENT, range);
      else if (g["chain"]) single("chain", "{{Chain}}", SEGMENT, range);
      else if (g["direction"]) single("direction", "{{Direction}}", DIRECTION, range);
      else if (g["tag"]) {
        groups.tags![g["tag"]] = groupCounter++;
        raw.tags![g["tag"]] = range;
        regexp += SEGMENT;
      } else if (g["any"]) {
        groups.anyMatchers!.push(groupCounter++);
        raw.anyMatchers!.push(range);
        regexp += SEGMENT;
      } else if (g["anynum"]) {
        groups.anyMatchers!.push(groupCounter++);
        raw.anyMatchers!.push(range);
        regexp += SEGMENT_NUM;
      } else throw new Error(`Unexpected token: ${m[0]}`);
    }

    regexp += compileLiteral(pattern.substring(lastIndex), pattern) + "$";

    if (groups.well === undefined) throw new Error("No {{Well}} matcher in the pattern");

    return new PathPattern(
      new RegExp(regexp, "d"),
      groups as PathGroups<number>,
      pattern,
      raw as PathGroups<Range>,
    );
  }
}

export type Wrapping = { begin: string; end: string };

export type HighlightOpts = {
  well?: Wrapping;
  plate?: Wrapping;
  chain?: Wrapping;
  direction?: Wrapping;
  tag?: Wrapping;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Wraps each captured field of a matched path in markup, so the scientist sees
 * which part of the path became which field. Escapes everything it did not add.
 */
export function highlightMatch(path: string, m: PathPatternMatch, opts: HighlightOpts): string {
  const spans: { range: Range; wrapping: Wrapping }[] = [];
  const add = (range: Range | undefined, wrapping: Wrapping | undefined) => {
    if (range && wrapping) spans.push({ range, wrapping });
  };

  add(m.well, opts.well);
  add(m.plate, opts.plate);
  add(m.chain, opts.chain);
  add(m.direction, opts.direction);
  for (const t of Object.values(m.tags ?? {})) add(t, opts.tag);

  spans.sort((a, b) => a.range.from - b.range.from);

  let out = "";
  let cursor = 0;
  for (const s of spans) {
    if (s.range.from < cursor) throw new Error("Intersecting ranges");
    out += escapeHtml(path.substring(cursor, s.range.from));
    out += s.wrapping.begin + escapeHtml(path.substring(s.range.from, s.range.to)) + s.wrapping.end;
    cursor = s.range.to;
  }
  return out + escapeHtml(path.substring(cursor));
}
