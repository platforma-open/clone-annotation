/**
 * Matches a declared pattern against a file's path relative to the selected root.
 *
 * Paths, not bare file names: the plate is frequently a directory rather than part
 * of the file name, so `{{Plate}}/{{Well}}_{{Chain}}.ab1` has to bind `{{Plate}}`
 * to a path segment.
 *
 * A token is `{{Name}}`, `{{Name:a|b}}` to accept only the listed values, or
 * `{{Name=x}}` to give a value when the token's `[ ]` section is absent.
 */

export type Range = { from: number; to: number };

/** A field's value and where each copy of it sits. A value from a default has no range. */
export type Match = { value: string; ranges: Range[] };

export type PathGroups<T> = {
  well: T;
  plate?: T;
  chain?: T;
  direction?: T;
  tags?: Record<string, T>;
  anyMatchers: T[];
};

export type PathPatternMatch = PathGroups<Match> & {
  /** Where each `[ ]` part sits in the path, in pattern order; undefined when it is absent. */
  sections: (Range | undefined)[];
};

export type Field = "well" | "plate" | "chain" | "direction";

const LABEL: Record<Field, string> = {
  well: "{{Well}}",
  plate: "{{Plate}}",
  chain: "{{Chain}}",
  direction: "{{Direction}}",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive without the `i` flag, so the rest of the pattern stays exact. */
function anyCase(word: string): string {
  return [...word]
    .map((ch) => {
      const lo = ch.toLowerCase();
      const up = ch.toUpperCase();
      return lo === up ? escapeRegExp(ch) : `[${up}${lo}]`;
    })
    .join("");
}

// Longest first: JS alternation is leftmost-wins, so `H|HC` would take the "H" of
// "HC" and leave "C" to fail against the next literal.
function oneOf(words: string[], cased: (w: string) => string): string {
  return (
    "(?:" +
    [...words]
      .sort((a, b) => b.length - a.length)
      .map(cased)
      .join("|") +
    ")"
  );
}

// A token never spans a directory boundary: a plate is one directory and a well
// sits in one file name, so letting `.` cross `/` only produces silent mis-splits.
const SEGMENT = "[^/]+?";
const SEGMENT_NUM = "[0-9]+";

// Typed rather than free text, because a free token next to another one with no
// separator between them ("XY2208G04") takes as little as it can and every file
// still matches, wrongly. A row letter and a column that fit a 384-well plate.
const WELL = "[A-Pa-p](?:0?[1-9]|1[0-9]|2[0-4])";

const CHAIN_WORDS = [
  "heavy",
  "light",
  "kappa",
  "lambda",
  "IGH",
  "IGK",
  "IGL",
  "VHH",
  "VH",
  "VL",
  "VK",
  "HC",
  "LC",
  "KC",
  "H",
  "L",
  "K",
  "IgG",
  "IgG1",
  "IgG2",
  "IgG3",
  "IgG4",
  "IgM",
  "IgA",
  "IgA1",
  "IgA2",
  "IgD",
  "IgE",
];

// Capillary sequencing reads a template from each end, marked F/R or fwd/rev.
// Not Illumina's R1/R2, though those are accepted for sets named that way. No list
// is taken: the workflow has to know which end each value names.
const DIRECTION_WORDS = ["forward", "reverse", "fwd", "rev", "F", "R", "R1", "R2", "1", "2"];

const DEFAULT_VALUES: Record<Field, string> = {
  well: WELL,
  plate: SEGMENT,
  chain: oneOf(CHAIN_WORDS, anyCase),
  direction: oneOf(DIRECTION_WORDS, anyCase),
};

/** Whether the field's own token, with no list, would read this value. */
export function fieldAccepts(field: Field, value: string): boolean {
  return new RegExp(`^(?:${DEFAULT_VALUES[field]})$`).test(value);
}

// Longer names first, so `w` does not take the "W" of "Well".
const TOKEN_BODY =
  /^\s*(?:(?<field>well|plate|chain|direction|w|p|c|d)|\*?:(?<tag>[a-zA-Z0-9_]+)|(?<any>\*)|(?<anynum>n))\s*(?::(?<list>[^=]*))?(?:=(?<def>.*))?$/i;

const FIELD_OF: Record<string, Field> = {
  well: "well",
  w: "well",
  plate: "plate",
  p: "plate",
  chain: "chain",
  c: "chain",
  direction: "direction",
  d: "direction",
};

/** Every place one field is read from, in pattern order. */
type Slot = { groups: number[]; optional: boolean[]; ranges: Range[]; def?: string };

type Piece =
  | { kind: "text"; text: string; at: number }
  | { kind: "token"; body: string; range: Range }
  | { kind: "section"; pieces: Piece[]; range: Range };

/** Splits a pattern into literal text, tokens and `[ ]` sections. */
function scan(pattern: string, from: number, to: number, inSection: boolean): Piece[] {
  const pieces: Piece[] = [];
  let text = "";
  let textAt = from;
  const flush = () => {
    if (text !== "") pieces.push({ kind: "text", text, at: textAt });
    text = "";
  };

  let at = from;
  while (at < to) {
    if (pattern.startsWith("{{", at)) {
      const close = pattern.indexOf("}}", at + 2);
      if (close < 0 || close + 2 > to) throw new Error(`Unclosed token at ${at} in ${pattern}`);
      flush();
      pieces.push({
        kind: "token",
        body: pattern.slice(at + 2, close),
        range: { from: at, to: close + 2 },
      });
      at = close + 2;
      textAt = at;
    } else if (pattern[at] === "[") {
      if (inSection) throw new Error(`[ ] cannot hold another [ ] in ${pattern}`);
      const close = pattern.indexOf("]", at + 1);
      if (close < 0 || close >= to) throw new Error(`Unclosed [ in ${pattern}`);
      if (close === at + 1) throw new Error(`Empty [] in ${pattern}`);
      flush();
      pieces.push({
        kind: "section",
        pieces: scan(pattern, at + 1, close, true),
        range: { from: at, to: close + 1 },
      });
      at = close + 1;
      textAt = at;
    } else {
      text += pattern[at];
      at++;
    }
  }
  flush();
  return pieces;
}

function parseList(raw: string, token: string): string[] {
  const values = raw.split("|").map((v) => v.trim());
  if (values.some((v) => v === "")) throw new Error(`Empty value in the list of ${token}`);
  if (values.some((v) => v.includes("/")))
    throw new Error(`A value cannot hold a directory, in ${token}`);
  return values;
}

export class PathPattern {
  private constructor(
    private readonly regexp: RegExp,
    private readonly slots: Partial<Record<Field, Slot>>,
    private readonly tagSlots: Record<string, Slot>,
    private readonly anyGroups: number[],
    private readonly sectionGroups: number[],
    public readonly rawPattern: string,
    public readonly rawElements: PathGroups<Range[]>,
  ) {}

  public get hasPlate(): boolean {
    return this.slots.plate !== undefined;
  }

  public get hasChain(): boolean {
    return this.slots.chain !== undefined;
  }

  public get hasDirection(): boolean {
    return this.slots.direction !== undefined;
  }

  public get tags(): string[] {
    return Object.keys(this.tagSlots).sort();
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

  public match(relativePath: string): PathPatternMatch | undefined {
    return this.resolve(relativePath).match;
  }

  /** Why a path did not match, or undefined if it did. */
  public explain(relativePath: string): string | undefined {
    return this.resolve(relativePath).reason;
  }

  private resolve(relativePath: string): { match?: PathPatternMatch; reason?: string } {
    const m = relativePath.match(this.regexp);
    if (!m) return { reason: "Does not fit the pattern" };

    let reason: string | undefined;
    const read = (slot: Slot, label: string): Match | undefined => {
      const copies: Match[] = [];
      for (const g of slot.groups) {
        const bounds = m.indices?.[g];
        const value = m[g];
        // A group inside an absent [ ] section takes no part in the match.
        if (value === undefined || bounds === undefined) continue;
        copies.push({ value, ranges: [{ from: bounds[0], to: bounds[1] }] });
      }
      if (copies.length === 0)
        return slot.def === undefined ? undefined : { value: slot.def, ranges: [] };

      const other = copies.find((c) => c.value !== copies[0]!.value);
      if (other !== undefined && reason === undefined)
        reason = `${label} reads "${copies[0]!.value}" in one place and "${other.value}" in another`;
      return { value: copies[0]!.value, ranges: copies.flatMap((c) => c.ranges) };
    };

    const well = read(this.slots.well!, LABEL.well);
    if (well === undefined) throw new Error("{{Well}} matched without a value");
    const result: PathPatternMatch = { well, anyMatchers: [], sections: [] };
    for (const field of ["plate", "chain", "direction"] as const) {
      const slot = this.slots[field];
      if (slot === undefined) continue;
      const got = read(slot, LABEL[field]);
      if (got !== undefined) result[field] = got;
    }
    const tagNames = Object.keys(this.tagSlots);
    if (tagNames.length > 0) {
      result.tags = {};
      for (const name of tagNames) {
        const got = read(this.tagSlots[name]!, `{{:${name}}}`);
        if (got !== undefined) result.tags[name] = got;
      }
    }
    for (const g of this.anyGroups) {
      const bounds = m.indices?.[g];
      if (m[g] !== undefined && bounds !== undefined)
        result.anyMatchers.push({ value: m[g], ranges: [{ from: bounds[0], to: bounds[1] }] });
    }
    result.sections = this.sectionGroups.map((g) => {
      const bounds = m.indices?.[g];
      return m[g] === undefined || bounds === undefined
        ? undefined
        : { from: bounds[0], to: bounds[1] };
    });

    // Two copies of one field that disagree mean the file sits in the wrong folder
    // or was renamed by hand; either way nothing here can say which copy is right.
    return reason === undefined ? { match: result } : { reason };
  }

  static parse(pattern: string): PathPattern {
    let groupCounter = 1;
    const slots: Partial<Record<Field, Slot>> = {};
    const tagSlots: Record<string, Slot> = {};
    const anyGroups: number[] = [];
    const sectionGroups: number[] = [];
    const raw: PathGroups<Range[]> = { well: [], tags: {}, anyMatchers: [] };

    const addCopy = (
      slot: Slot,
      optional: boolean,
      range: Range,
      def: string | undefined,
      token: string,
    ) => {
      slot.groups.push(groupCounter++);
      slot.optional.push(optional);
      slot.ranges.push(range);
      if (def !== undefined) {
        if (slot.def !== undefined && slot.def !== def)
          throw new Error(`Two different defaults for one field, in ${token}`);
        slot.def = def;
      }
    };

    const compileToken = (body: string, range: Range, optional: boolean): string => {
      const token = pattern.slice(range.from, range.to);
      const t = TOKEN_BODY.exec(body)?.groups;
      if (t === undefined) throw new Error(`Unknown token ${token}`);

      const list = t["list"] !== undefined ? parseList(t["list"], token) : undefined;
      const def = t["def"]?.trim();
      if (def === "") throw new Error(`Empty default in ${token}`);
      if (def !== undefined && !optional)
        throw new Error(
          `A default applies only inside [ ], where the part can be absent: ${token}`,
        );

      if (t["any"] !== undefined || t["anynum"] !== undefined) {
        if (list !== undefined || def !== undefined)
          throw new Error(`${token} skips text and takes no list or default`);
        anyGroups.push(groupCounter++);
        raw.anyMatchers.push([range]);
        return `(${t["any"] !== undefined ? SEGMENT : SEGMENT_NUM})`;
      }

      let values: string;
      let slot: Slot;
      if (t["tag"] !== undefined) {
        values = list !== undefined ? oneOf(list, escapeRegExp) : SEGMENT;
        slot = tagSlots[t["tag"]] ??= { groups: [], optional: [], ranges: [] };
        (raw.tags![t["tag"]] ??= []).push(range);
      } else {
        const field = FIELD_OF[t["field"]!.toLowerCase()]!;
        if (field === "well") {
          if (optional) throw new Error(`{{Well}} cannot sit inside [ ]: every file needs a well`);
          if (list !== undefined)
            throw new Error(`{{Well}} takes a well such as A1 or H12, not a list`);
        }
        if (field === "direction" && list !== undefined)
          throw new Error(`{{Direction}} takes F/R, fwd/rev, forward/reverse or 1/2, not a list`);
        values = list !== undefined ? oneOf(list, escapeRegExp) : DEFAULT_VALUES[field];
        slot = slots[field] ??= { groups: [], optional: [], ranges: [] };
        if (field === "well") raw.well.push(range);
        else (raw[field] ??= []).push(range);
      }

      if (def !== undefined && !new RegExp(`^${values}$`).test(def))
        throw new Error(`The default in ${token} is not a value the token accepts`);
      addCopy(slot, optional, range, def, token);
      return `(${values})`;
    };

    const compile = (pieces: Piece[], optional: boolean): string =>
      pieces
        .map((p) => {
          if (p.kind === "text") return escapeRegExp(p.text);
          if (p.kind === "token") return compileToken(p.body, p.range, optional);
          return compileSection(p);
        })
        .join("");

    // `[a|b]` is one of several literal texts, or none of them. `[_{{:Run}}]` is a
    // part that may be absent, tokens and all. The two are not mixed: a bar between
    // tokens would leave it unclear which copy of a field each alternative fills.
    const compileSection = (section: Extract<Piece, { kind: "section" }>): string => {
      const text = pattern.slice(section.range.from, section.range.to);
      if (text.includes("/")) throw new Error(`[] cannot span a directory in ${pattern}`);
      // Numbered before its content, as the regex numbers groups by opening paren.
      sectionGroups.push(groupCounter++);
      const hasToken = section.pieces.some((p) => p.kind === "token");
      if (!hasToken) {
        const body = section.pieces.map((p) => (p.kind === "text" ? p.text : "")).join("");
        return "(" + body.split("|").map(escapeRegExp).join("|") + ")?";
      }
      if (section.pieces.some((p) => p.kind === "text" && p.text.includes("|")))
        throw new Error(`A [ ] holding a token cannot also list alternatives: ${text}`);
      return "(" + compile(section.pieces, true) + ")?";
    };

    const regexp = "^" + compile(scan(pattern, 0, pattern.length, false), false) + "$";

    if (slots.well === undefined) throw new Error("No {{Well}} matcher in the pattern");
    for (const [field, slot] of Object.entries(slots))
      if (slot.def !== undefined && slot.optional.includes(false))
        throw new Error(
          `The default for ${LABEL[field as Field]} never applies: one copy is outside [ ]`,
        );
    for (const [name, slot] of Object.entries(tagSlots))
      if (slot.def !== undefined && slot.optional.includes(false))
        throw new Error(`The default for {{:${name}}} never applies: one copy is outside [ ]`);

    return new PathPattern(
      new RegExp(regexp, "d"),
      slots,
      tagSlots,
      anyGroups,
      sectionGroups,
      pattern,
      raw,
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
  const add = (field: Match | undefined, wrapping: Wrapping | undefined) => {
    if (field && wrapping) for (const range of field.ranges) spans.push({ range, wrapping });
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
