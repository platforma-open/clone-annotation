import type {
  PathPattern,
  PathPatternMatch,
} from "@platforma-open/milaboratories.clone-annotation.model";
import type { SelectedFile } from "./trace_set";

export type ValueCount = { value: string; count: number };

export type FieldSummary = {
  /** What the scientist sees: Plate, Well, Chain, Direction, or a tag's own name. */
  label: string;
  kind: "plate" | "well" | "chain" | "direction" | "tag";
  /** Most common first, so a field that captured junk shows its junk at the front. */
  values: ValueCount[];
};

const collator = new Intl.Collator(undefined, { numeric: true });

function countValues(values: string[]): ValueCount[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.value, b.value));
}

/** The distinct values each field of the pattern took over the matched files. */
export function summarizeFields(files: SelectedFile[], pattern: PathPattern): FieldSummary[] {
  const matches = files.flatMap((f) => (f.match ? [f.match] : []));
  const field = (
    label: string,
    kind: FieldSummary["kind"],
    pick: (m: PathPatternMatch) => string | undefined,
  ): FieldSummary => ({
    label,
    kind,
    values: countValues(matches.map(pick).map((v) => v ?? "")),
  });

  const out: FieldSummary[] = [];
  if (pattern.hasPlate) out.push(field("Plate", "plate", (m) => m.plate?.value));
  out.push(field("Well", "well", (m) => m.well.value));
  if (pattern.hasChain) out.push(field("Chain", "chain", (m) => m.chain?.value));
  if (pattern.hasDirection) out.push(field("Direction", "direction", (m) => m.direction?.value));
  for (const tag of pattern.tags) out.push(field(tag, "tag", (m) => m.tags?.[tag]?.value));
  return out;
}

export type SelectionGroups = {
  /** Each entry is two or more files that claim the same plate, well, chain and direction. */
  collisions: SelectedFile[][];
  /** Unmatched files, one entry per reason, the largest first. No reason means no pattern yet. */
  unmatched: { reason?: string; files: SelectedFile[] }[];
  /** Matched files that collide with nothing. */
  matched: SelectedFile[];
};

function identity(m: PathPatternMatch): string {
  return [m.plate?.value ?? "", m.well.value, m.chain?.value ?? "", m.direction?.value ?? ""].join(
    "\u0000",
  );
}

export function groupSelection(files: SelectedFile[]): SelectionGroups {
  const byIdentity = new Map<string, SelectedFile[]>();
  const byReason = new Map<string | undefined, SelectedFile[]>();
  const add = <K>(map: Map<K, SelectedFile[]>, key: K, f: SelectedFile) => {
    const list = map.get(key);
    if (list) list.push(f);
    else map.set(key, [f]);
  };
  for (const f of files) {
    if (f.match) add(byIdentity, identity(f.match), f);
    else add(byReason, f.reason, f);
  }
  const groups = [...byIdentity.values()];
  return {
    collisions: groups.filter((g) => g.length > 1),
    unmatched: [...byReason]
      .map(([reason, files]) => ({ reason, files }))
      .sort((a, b) => b.files.length - a.files.length),
    matched: groups.filter((g) => g.length === 1).flat(),
  };
}

function examples(values: string[], n = 3): string {
  return values.slice(0, n).join(", ");
}

function wellName(m: PathPatternMatch): string {
  return m.plate ? `${m.plate.value} ${m.well.value}` : m.well.value;
}

/**
 * Signs that the pattern reads the wrong part of the name. A file can fit the
 * pattern and still give values that make no sense together, and only the whole
 * selection shows it.
 */
export function checkSelection(files: SelectedFile[], pattern: PathPattern): string[] {
  const matches = files.flatMap((f) => (f.match ? [f.match] : []));
  if (matches.length < 2) return [];
  const out: string[] = [];
  const distinct = (pick: (m: PathPatternMatch) => string) => [...new Set(matches.map(pick))];

  const wells = distinct((m) => `${m.plate?.value ?? ""}\u0000${m.well.value}`);
  if (wells.length === 1)
    out.push(`All ${matches.length} files read the same well, ${wellName(matches[0]!)}.`);

  if (pattern.hasPlate && distinct((m) => m.plate?.value ?? "").length === matches.length)
    out.push(
      "Every file has its own plate. The plate may be reading a part that changes per file.",
    );

  const partners = (
    groupBy: (m: PathPatternMatch) => string,
    partner: (m: PathPatternMatch) => string,
  ) => {
    const seen = new Map<string, { first: PathPatternMatch; values: Set<string> }>();
    for (const m of matches) {
      const key = groupBy(m);
      const entry = seen.get(key) ?? { first: m, values: new Set<string>() };
      entry.values.add(partner(m));
      seen.set(key, entry);
    }
    const all = [...seen.values()];
    return { total: all.length, lone: all.filter((e) => e.values.size === 1) };
  };

  if (pattern.hasChain && distinct((m) => m.chain?.value ?? "").length > 1) {
    const { total, lone } = partners(
      (m) => `${m.plate?.value ?? ""}\u0000${m.well.value}`,
      (m) => m.chain?.value ?? "",
    );
    if (lone.length > 0)
      out.push(
        `${lone.length} of ${total} wells have only one chain, for example ${examples(
          lone.map((e) => `${wellName(e.first)} (${e.first.chain?.value ?? ""})`),
        )}.`,
      );
  }

  if (pattern.hasDirection) {
    const directions = distinct((m) => m.direction?.value ?? "");
    if (directions.length > 2)
      out.push(
        `Direction has ${directions.length} values: ${examples(
          directions,
          5,
        )}. Check that each one means forward or reverse.`,
      );
    if (directions.length > 1) {
      const { total, lone } = partners(
        (m) => [m.plate?.value ?? "", m.well.value, m.chain?.value ?? ""].join("\u0000"),
        (m) => m.direction?.value ?? "",
      );
      if (lone.length > 0)
        out.push(
          `${lone.length} of ${total} reads have only one direction, for example ${examples(
            lone.map(
              (e) =>
                `${[wellName(e.first), e.first.chain?.value]
                  .filter(Boolean)
                  .join(" ")} (${e.first.direction?.value ?? ""})`,
            ),
          )}.`,
        );
    }
  }

  const skips = pattern.rawElements.anyMatchers;
  skips.forEach((ranges, i) => {
    // A skip inside an absent [ ] section leaves no entry, so positions only line
    // up in files that have every skipped part.
    const values = [
      ...new Set(
        matches
          .filter((m) => m.anyMatchers.length === skips.length)
          .map((m) => m.anyMatchers[i]!.value),
      ),
    ];
    if (values.length < 2) return;
    const token = pattern.rawPattern.slice(ranges[0]!.from, ranges[0]!.to);
    const which =
      skips.length > 1 ? `Skipped part ${i + 1} (${token})` : `The skipped part ${token}`;
    out.push(
      `${which} has ${values.length} different values, for example ${examples(
        values,
      )}. If they matter, read it as a tag, like {{:Run}}.`,
    );
  });

  return out;
}
