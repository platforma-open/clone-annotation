import type { PathPattern } from "@platforma-open/milaboratories.clone-annotation.model";
import { fieldAccepts } from "@platforma-open/milaboratories.clone-annotation.model";

export type Role = "text" | "plate" | "well" | "chain" | "direction" | "tag" | "skip";

export type Piece = {
  from: number;
  to: number;
  role: Role;
  /** The tag's name, for the tag role. */
  tag?: string;
  /**
   * The token this piece was read from, such as `{{Chain:12|34}}` or `{{n}}`.
   * Writing it back as it was keeps what the builder cannot show.
   */
  token?: string;
  /**
   * The text inside an optional `[ ]` part, such as `_LC|_KC`. Such a piece covers
   * what the part matched in the example, and nothing when the part is absent.
   */
  section?: string;
};

const SEPARATOR = /^[_\-. /]$/;

export function isSeparator(text: string): boolean {
  return SEPARATOR.test(text);
}

/** Each separator on its own, and the runs between them. */
function runs(text: string, offset: number): Piece[] {
  const out: Piece[] = [];
  for (const m of text.matchAll(/[_\-. /]|[^_\-. /]+/g))
    out.push({ from: offset + m.index, to: offset + m.index + m[0].length, role: "text" });
  return out;
}

export function defaultPieces(example: string): Piece[] {
  return runs(example, 0);
}

/**
 * Cuts at separators and where letters meet digits, except that one capital row
 * letter stays with the digits after it: "XY2200A07" gives XY, 2200, A07.
 */
function fineCuts(text: string, offset: number): Piece[] {
  const parts = [...text.matchAll(/[A-Za-z]+|[0-9]+|[_\-. /]|[^A-Za-z0-9_\-. /]+/g)].map((m) => ({
    from: offset + m.index,
    to: offset + m.index + m[0].length,
    text: m[0],
  }));
  const out: Piece[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const next = parts[i + 1];
    if (/^[A-P]$/.test(p.text) && next && fieldAccepts("well", p.text + next.text)) {
      out.push({ from: p.from, to: next.to, role: "text" });
      i++;
    } else out.push({ from: p.from, to: p.to, role: "text" });
  }
  return out;
}

export function splitPiece(example: string, pieces: Piece[], i: number): Piece[] {
  const p = pieces[i]!;
  if (p.section !== undefined) return pieces;
  const parts = fineCuts(example.slice(p.from, p.to), p.from);
  if (parts.length < 2) return pieces;
  return [...pieces.slice(0, i), ...parts, ...pieces.slice(i + 1)];
}

/** Joins a piece with the next piece that is not a separator, and any separator between. */
export function joinWithNext(example: string, pieces: Piece[], i: number): Piece[] {
  let j = i + 1;
  while (j < pieces.length && isSeparator(example.slice(pieces[j]!.from, pieces[j]!.to))) j++;
  if (j >= pieces.length) return pieces;
  const p = pieces[i]!;
  if (p.section !== undefined || pieces[j]!.section !== undefined) return pieces;
  const joined: Piece = { from: p.from, to: pieces[j]!.to, role: p.role, tag: p.tag };
  return [...pieces.slice(0, i), joined, ...pieces.slice(j + 1)];
}

export function setRole(pieces: Piece[], i: number, role: Role, tag?: string): Piece[] {
  const p = pieces[i]!;
  const next: Piece = { from: p.from, to: p.to, role };
  if (role === "tag") next.tag = tag;
  return pieces.map((q, k) => (k === i ? next : q));
}

/** Tag names allowed by the grammar: letters, digits and `_`. */
export function tagName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "") || "Tag";
}

// Text the grammar would read as syntax. There is no escape for it, so such text
// is skipped instead of written out.
function isLiteral(text: string): boolean {
  return !text.includes("[") && !text.includes("]") && !text.includes("{{");
}

export function literalOrSkip(text: string): string {
  return isLiteral(text) ? text : "{{*}}";
}

export type Built = { pattern: string; notes: string[] };

function pieceText(example: string, p: Piece, notes: string[]): string {
  const value = example.slice(p.from, p.to);
  if (p.section !== undefined) return `[${p.section}]`;
  if (p.token !== undefined) return p.token;
  switch (p.role) {
    case "text":
      return literalOrSkip(value);
    case "well":
      if (!fieldAccepts("well", value))
        notes.push(`"${value}" is not a well. A well is a row letter and a column, A1 to P24.`);
      return "{{Well}}";
    case "plate":
      return "{{Plate}}";
    case "chain":
      if (fieldAccepts("chain", value)) return "{{Chain}}";
      notes.push(
        `"${value}" is not a usual chain name, so the pattern lists it. Add the other codes to the list in the pattern, like {{Chain:${value}|…}}.`,
      );
      return `{{Chain:${value}}}`;
    case "direction":
      if (!fieldAccepts("direction", value))
        notes.push(`"${value}" is not a direction. A direction is F/R, fwd/rev or 1/2.`);
      return "{{Direction}}";
    case "tag":
      return `{{:${tagName(p.tag ?? "")}}}`;
    case "skip":
      return "{{*}}";
  }
}

export function toPattern(example: string, pieces: Piece[]): Built {
  const notes: string[] = [];
  const pattern = pieces.map((p) => pieceText(example, p, notes)).join("");
  return { pattern, notes };
}

type Span = { from: number; to: number; role: Role; tag?: string };

type Item =
  | { kind: "text"; text: string }
  | { kind: "token"; text: string }
  | { kind: "section"; inner: string };

/** The pattern's top level: fixed text, tokens and `[ ]` parts, in order. */
function items(text: string): Item[] {
  const out: Item[] = [];
  for (const m of text.matchAll(/\{\{.*?\}\}|\[[^\]]*\]|(?:(?!\{\{)[^[])+/g)) {
    const t = m[0];
    if (t.startsWith("{{")) out.push({ kind: "token", text: t });
    else if (t.startsWith("[")) out.push({ kind: "section", inner: t.slice(1, -1) });
    else out.push({ kind: "text", text: t });
  }
  return out;
}

/** The pieces the pattern gives on this example, or nothing when the example does not fit. */
export function fromPattern(
  example: string,
  text: string,
  pattern: PathPattern,
): Piece[] | undefined {
  const m = pattern.match(example);
  if (!m) return undefined;

  const present = m.sections.filter((r) => r !== undefined);
  const inSection = (from: number) => present.some((r) => r.from <= from && from < r.to);
  const spans: Span[] = [];
  const add = (ranges: { from: number; to: number }[], role: Role, tag?: string) => {
    for (const r of ranges)
      if (!inSection(r.from)) spans.push({ from: r.from, to: r.to, role, tag });
  };
  add(m.well.ranges, "well");
  if (m.plate) add(m.plate.ranges, "plate");
  if (m.chain) add(m.chain.ranges, "chain");
  if (m.direction) add(m.direction.ranges, "direction");
  for (const [name, t] of Object.entries(m.tags ?? {})) add(t.ranges, "tag", name);
  for (const a of m.anyMatchers) add(a.ranges, "skip");
  spans.sort((a, b) => a.from - b.from);

  // Walks the pattern and the example side by side. Each top-level token reads
  // the next span, and an absent [ ] part takes no room in the example.
  const pieces: Piece[] = [];
  let at = 0;
  let span = 0;
  let section = 0;
  for (const item of items(text)) {
    if (item.kind === "text") {
      if (!example.startsWith(item.text, at)) return undefined;
      pieces.push(...runs(item.text, at));
      at += item.text.length;
    } else if (item.kind === "token") {
      const s = spans[span++];
      if (s === undefined || s.from !== at) return undefined;
      pieces.push({ ...s, token: item.text });
      at = s.to;
    } else {
      const r = m.sections[section++];
      if (r !== undefined && r.from !== at) return undefined;
      const to = r?.to ?? at;
      pieces.push({ from: at, to, role: "text", section: item.inner });
      at = to;
    }
  }
  return at === example.length && span === spans.length ? pieces : undefined;
}

function separatorAt(example: string, pieces: Piece[], i: number): boolean {
  const p = pieces[i];
  if (p === undefined || p.section !== undefined) return false;
  const text = example.slice(p.from, p.to);
  return isSeparator(text) && text !== "/";
}

/**
 * Turns a piece into an optional `[ ]` part. The separator before it goes in too,
 * or the one after it at the start of a name, so that "P7_LC" gives `P7[_LC]`.
 */
export function makeOptional(example: string, pieces: Piece[], i: number): Piece[] {
  const p = pieces[i]!;
  if (p.section !== undefined || p.role === "well") return pieces;
  let first = i;
  let last = i;
  if (separatorAt(example, pieces, i - 1)) first = i - 1;
  else if (separatorAt(example, pieces, i + 1)) last = i + 1;
  const inner = pieces
    .slice(first, last + 1)
    .map((q) => pieceText(example, q, []))
    .join("");
  const part: Piece = {
    from: pieces[first]!.from,
    to: pieces[last]!.to,
    role: "text",
    section: inner,
  };
  return [...pieces.slice(0, first), part, ...pieces.slice(last + 1)];
}

/** Writes an optional part's content without the brackets, so it is required again. */
export function makeRequired(pieces: Piece[], i: number): Piece[] {
  const p = pieces[i]!;
  if (p.section === undefined) return pieces;
  const required: Piece = { from: p.from, to: p.to, role: "text", token: p.section };
  return pieces.map((q, k) => (k === i ? required : q));
}

export function setSection(pieces: Piece[], i: number, inner: string): Piece[] {
  return pieces.map((q, k) => (k === i ? { ...q, section: inner } : q));
}

export function removePiece(pieces: Piece[], i: number): Piece[] {
  return pieces.filter((_, k) => k !== i);
}

/** The pattern with one more folder level in front, read as fixed text. */
export function addFolder(pattern: string, folder: string): string {
  return `${literalOrSkip(folder)}/${pattern}`;
}

/** The pattern without its first folder level. */
export function dropFolder(pattern: string): string {
  const slash = pattern.indexOf("/");
  return slash < 0 ? pattern : pattern.slice(slash + 1);
}

export type WellGuess =
  | { kind: "found"; from: number; to: number; values: number; files: number }
  | { kind: "unsure"; parts: string[] };

/**
 * Finds the part of the example that holds the well, from the files named the
 * same way. The look of a value alone misleads, since plates like "P1" look like
 * wells too, so the well must also take clearly more values than any other part.
 */
export function guessWell(example: string, names: string[]): WellGuess | undefined {
  const shape = (parts: string[]) => parts.map((p) => (isSeparator(p) ? p : "w")).join("\u0000");
  const cut = (text: string) => fineCuts(text, 0).map((p) => text.slice(p.from, p.to));
  const own = fineCuts(example, 0);
  const ownShape = shape(own.map((p) => example.slice(p.from, p.to)));
  const same = names.map(cut).filter((parts) => shape(parts) === ownShape);
  if (same.length < 2) return undefined;

  const candidates = own
    .map((p, j) => ({ piece: p, values: new Set(same.map((parts) => parts[j]!)) }))
    .filter(({ piece, values }) => {
      const text = example.slice(piece.from, piece.to);
      return (
        !isSeparator(text) && values.size > 1 && [...values].every((v) => fieldAccepts("well", v))
      );
    })
    .sort((a, b) => b.values.size - a.values.size);
  const [best, next] = candidates;
  if (best === undefined) return undefined;
  if (next !== undefined && best.values.size < 2 * next.values.size)
    return {
      kind: "unsure",
      parts: candidates.map((c) => example.slice(c.piece.from, c.piece.to)),
    };
  return {
    kind: "found",
    from: best.piece.from,
    to: best.piece.to,
    values: best.values.size,
    files: same.length,
  };
}

/** Marks the range as the well, cutting it out of a bigger piece if needed. */
export function markWell(pieces: Piece[], from: number, to: number): Piece[] {
  const i = pieces.findIndex((p) => p.from <= from && to <= p.to && p.section === undefined);
  if (i < 0) return pieces;
  const p = pieces[i]!;
  const parts: Piece[] = [];
  if (p.from < from) parts.push({ from: p.from, to: from, role: "text" });
  parts.push({ from, to, role: "well" });
  if (to < p.to) parts.push({ from: to, to: p.to, role: "text" });
  return [...pieces.slice(0, i), ...parts, ...pieces.slice(i + 1)];
}
