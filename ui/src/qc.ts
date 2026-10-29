import type {
  Annotation,
  AnnotationReport,
  Clone,
  Sequence,
  TraceReport,
} from "@platforma-open/milaboratories.clone-annotation.model";

export type QcInput = {
  /** Every trace the scientist selected, matched or not. */
  fileCount: number;
  unmatched: string[];
  trace?: TraceReport;
  clones: Clone[];
  annotation?: AnnotationReport;
  clonesWithoutProperties: string[];
  valuesWithoutClone: string[];
};

/** A count the run produced, with the way it breaks down beside it. */
export type FunnelStep = {
  label: string;
  count: number;
  parts: { label: string; count: number; bad?: boolean }[];
};

function countBy<T>(items: T[], key: (item: T) => string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined || k === "") continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function largestFirst(counts: Map<string, number>, bad = false): FunnelStep["parts"] {
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count, bad }));
}

const SOURCE_LABELS: Record<Sequence["source"], string> = {
  merged: "both ends merged",
  forward: "forward only",
  reverse: "reverse only",
  none: "no read survived",
};

/**
 * Where a set of files went, step by step. Each step states what left the
 * pipeline, so a well that never reaches the clone table is accounted for
 * rather than silently missing.
 */
export function buildFunnel(input: QcInput): FunnelStep[] {
  const { fileCount, unmatched, trace, clones, annotation } = input;
  const steps: FunnelStep[] = [];

  steps.push({
    label: "Files added",
    count: fileCount,
    parts: [
      { label: "placed by the pattern", count: fileCount - unmatched.length },
      ...(unmatched.length > 0 ? [{ label: "unplaced", count: unmatched.length, bad: true }] : []),
    ],
  });

  if (trace) {
    const kept = trace.reads.filter((r) => r.kept).length;
    steps.push({
      label: "Traces read",
      count: trace.reads.length,
      parts: [
        { label: "usable after the quality floor", count: kept },
        ...largestFirst(
          countBy(trace.setAside, (s) => s.reason),
          true,
        ),
      ],
    });

    steps.push({
      label: "Sequences",
      count: trace.sequences.length,
      parts: (["merged", "forward", "reverse", "none"] as const)
        .map((source) => ({
          label: SOURCE_LABELS[source],
          count: trace.sequences.filter((m) => m.source === source).length,
          bad: source === "none",
        }))
        .filter((p) => p.count > 0),
    });
  }

  steps.push({
    label: "Clones",
    count: clones.length,
    parts: largestFirst(
      countBy(clones, (c) => {
        const n = Object.keys(c.chains).length;
        return `with ${n} chain${n === 1 ? "" : "s"}`;
      }),
    ),
  });

  if (annotation) {
    const anns = annotation.annotations;
    steps.push({
      label: "Chains paired",
      count: anns.length,
      parts: largestFirst(countBy(anns, (a) => a.pairStatus)).map((p) => ({
        ...p,
        bad: p.label === "Unpaired" || p.label === "Ambiguous",
      })),
    });

    steps.push({
      label: "Described",
      count: anns.filter((a) => a.status === "Annotated").length,
      parts: [
        { label: "germline called", count: anns.filter((a) => a.vGene !== undefined).length },
        ...(annotation.notNumbered.length > 0
          ? [{ label: "not numbered", count: annotation.notNumbered.length, bad: true }]
          : []),
        ...(annotation.notAligned.length > 0
          ? [{ label: "no germline", count: annotation.notAligned.length, bad: true }]
          : []),
      ],
    });

    const collapse = annotation.collapse;
    if (collapse?.variantsOut !== undefined)
      steps.push({
        label: "Variants",
        count: collapse.variantsOut,
        parts: [{ label: "collapsed from", count: collapse.clonesIn ?? anns.length }],
      });
  }

  return steps;
}

export const WELL_OUTCOMES = ["ok", "flagged", "notDescribed", "noRead", "empty"] as const;
export type WellOutcome = (typeof WELL_OUTCOMES)[number];

export const OUTCOME_LABELS: Record<WellOutcome, string> = {
  ok: "Described",
  flagged: "Needs a look",
  notDescribed: "Not described",
  noRead: "No usable read",
  empty: "No file",
};

export type PlateWell = {
  /** The well as the grid names it, which is also what the tooltip shows. */
  label: string;
  outcome: WellOutcome;
  /** What is in the well and what is wrong with it, one short line. */
  note: string;
};

export type PlateMap = {
  plate: string;
  rowLabels: string[];
  columnLabels: number[];
  grid: PlateWell[][];
  /** Wells whose name is not a row letter and a column number. */
  offGrid: PlateWell[];
  counts: Record<WellOutcome, number>;
};

export type WellPosition = { row: string; column: number };

/** `A1`, `a01` and `H12` are the same shape. Anything else has no grid position. */
export function parseWell(well: string): WellPosition | undefined {
  const m = /^([A-Za-z]{1,2})0*([0-9]{1,2})$/.exec(well.trim());
  if (!m) return undefined;
  const column = Number(m[2]);
  if (column < 1) return undefined;
  return { row: m[1]!.toUpperCase(), column };
}

export function rowIndex(row: string): number {
  let n = 0;
  for (const ch of row.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function rowLabel(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// A plate is drawn at its real size even where only a corner of it was used, so
// a half-filled plate reads as half-filled rather than as a small full one.
const STANDARD_LAYOUTS = [
  { rows: 8, columns: 12 },
  { rows: 16, columns: 24 },
];

function layoutFor(positions: WellPosition[]): { rows: number; columns: number } {
  const rows = Math.max(1, ...positions.map((p) => rowIndex(p.row) + 1));
  const columns = Math.max(1, ...positions.map((p) => p.column));
  return STANDARD_LAYOUTS.find((l) => rows <= l.rows && columns <= l.columns) ?? { rows, columns };
}

const BAD_PAIR_STATUS = new Set(["Unpaired", "Ambiguous"]);

function chainOf(a: Annotation): string {
  return a.declaredChain || a.observedChain || "";
}

function outcomeOf(annotations: Annotation[], sequences: Sequence[]): WellOutcome {
  if (annotations.length === 0 && sequences.length === 0) return "empty";
  if (sequences.length > 0 && sequences.every((m) => m.source === "none")) return "noRead";
  if (annotations.some((a) => a.status === "Failed" || a.vGene === undefined))
    return "notDescribed";
  if (
    annotations.some((a) => a.chainMismatch || (a.pairStatus && BAD_PAIR_STATUS.has(a.pairStatus)))
  )
    return "flagged";
  return "ok";
}

function describe(outcome: WellOutcome, annotations: Annotation[]): string {
  if (outcome === "empty") return "No file";
  if (outcome === "noRead") return "No read survived the quality floor";
  return annotations
    .map((a) => {
      const problems: string[] = [];
      if (a.chainMismatch)
        problems.push(`name says ${a.declaredChain}, sequence says ${a.observedChain}`);
      if (a.pairStatus && BAD_PAIR_STATUS.has(a.pairStatus))
        problems.push(a.pairStatus.toLowerCase());
      if (a.status === "Failed") problems.push("not numbered");
      else if (a.vGene === undefined) problems.push("no germline");
      const chain = chainOf(a) || "chain";
      return problems.length > 0 ? `${chain}: ${problems.join(", ")}` : chain;
    })
    .join(" · ");
}

function key(plate: string, well: string): string {
  return `${plate}\u0000${well}`;
}

/**
 * One grid per plate, every well carrying what happened to it. A trace set fails
 * in patterns — a dead row, a dead edge — and only a grid shows the pattern.
 */
export function buildPlateMaps(input: QcInput): PlateMap[] {
  const annotations = input.annotation?.annotations ?? [];
  const sequences = input.trace?.sequences ?? [];

  const byWell = new Map<string, { plate: string; well: string }>();
  const annsByWell = new Map<string, Annotation[]>();
  const seqsByWell = new Map<string, Sequence[]>();

  const push = <T>(map: Map<string, T[]>, k: string, value: T) => {
    const list = map.get(k);
    if (list) list.push(value);
    else map.set(k, [value]);
  };

  for (const source of [annotations, sequences, input.clones]) {
    for (const item of source as { plate: string; well: string }[]) {
      byWell.set(key(item.plate, item.well), { plate: item.plate, well: item.well });
    }
  }
  for (const a of annotations) push(annsByWell, key(a.plate, a.well), a);
  for (const s of sequences) push(seqsByWell, key(s.plate, s.well), s);

  const byPlate = new Map<string, { well: string; cell: PlateWell }[]>();
  for (const [k, { plate, well }] of byWell) {
    const anns = annsByWell.get(k) ?? [];
    const seqs = seqsByWell.get(k) ?? [];
    const outcome = outcomeOf(anns, seqs);
    push(byPlate, plate, { well, cell: { label: well, outcome, note: describe(outcome, anns) } });
  }

  const collator = new Intl.Collator(undefined, { numeric: true });
  return [...byPlate]
    .sort((a, b) => collator.compare(a[0], b[0]))
    .map(([plate, wells]) => {
      const placed = new Map<string, PlateWell>();
      const offGrid: PlateWell[] = [];
      const positions: WellPosition[] = [];
      for (const { well, cell } of wells) {
        const pos = parseWell(well);
        if (!pos) {
          offGrid.push(cell);
          continue;
        }
        positions.push(pos);
        placed.set(`${pos.row}${pos.column}`, cell);
      }

      const { rows, columns } = layoutFor(positions);
      const rowLabels = Array.from({ length: rows }, (_, i) => rowLabel(i));
      const columnLabels = Array.from({ length: columns }, (_, i) => i + 1);
      const grid = rowLabels.map((row) =>
        columnLabels.map(
          (column) =>
            placed.get(`${row}${column}`) ?? {
              label: `${row}${column}`,
              outcome: "empty" as const,
              note: "No file",
            },
        ),
      );

      const counts = Object.fromEntries(WELL_OUTCOMES.map((o) => [o, 0])) as Record<
        WellOutcome,
        number
      >;
      for (const cell of [...grid.flat(), ...offGrid]) counts[cell.outcome] += 1;

      return { plate, rowLabels, columnLabels, grid, offGrid, counts };
    });
}

export type QcList = { label: string; items: string[] };

/** The exception lists, in the order a scientist would work through them. */
export function buildLists(input: QcInput): QcList[] {
  const a = input.annotation;
  const mismatched = (input.trace?.sequences ?? []).filter((m) => (m.mismatches ?? 0) > 0);
  const extra = (input.trace?.sequences ?? []).filter((m) => m.extraReads > 0);
  return [
    { label: "Unplaced files", items: input.unmatched },
    { label: "Chain mismatch", items: a?.chainMismatch ?? [] },
    { label: "Unpaired", items: a?.unpaired ?? [] },
    { label: "Not numbered", items: a?.notNumbered ?? [] },
    { label: "No germline", items: a?.notAligned ?? [] },
    {
      label: "Reads disagreed on merge",
      items: mismatched
        .sort((x, y) => (y.mismatches ?? 0) - (x.mismatches ?? 0))
        .map((m) => `${m.plate} ${m.well} ${m.chain} (${m.mismatches} positions)`.trim()),
    },
    {
      label: "More reads than ends",
      items: extra.map((m) => `${m.plate} ${m.well} ${m.chain} (${m.extraReads} extra)`.trim()),
    },
    { label: "Clones no property reached", items: input.clonesWithoutProperties },
    { label: "Sheet rows that hit no clone", items: input.valuesWithoutClone },
  ].filter((l) => l.items.length > 0);
}
