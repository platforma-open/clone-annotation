import type {
  Annotation,
  Sequence,
  TraceReport,
} from "@platforma-open/milaboratories.clone-annotation.model";
import { describe, expect, test } from "vitest";
import type { QcInput } from "../qc";
import { buildFunnel, buildLists, buildPlateMaps, parseWell, rowLabel } from "../qc";

function annotation(over: Partial<Annotation> & Pick<Annotation, "plate" | "well">): Annotation {
  return {
    id: `${over.plate}-${over.well}`,
    declaredChain: "IGH",
    status: "Annotated",
    pairStatus: "Paired",
    vGene: "IGHV3-23",
    ...over,
  };
}

function sequence(over: Partial<Sequence> & Pick<Sequence, "plate" | "well">): Sequence {
  return {
    id: `${over.plate}-${over.well}`,
    chain: "IGH",
    source: "merged",
    reads: [],
    extraReads: 0,
    ...over,
  };
}

function input(over: Partial<QcInput> = {}): QcInput {
  return {
    fileCount: 0,
    unmatched: [],
    clones: [],
    clonesWithoutProperties: [],
    valuesWithoutClone: [],
    ...over,
  };
}

function trace(over: Partial<TraceReport> = {}): TraceReport {
  return { reads: [], setAside: [], sequences: [], ...over };
}

describe("parseWell", () => {
  test("reads a row letter and a column number, padded or not", () => {
    expect(parseWell("A1")).toEqual({ row: "A", column: 1 });
    expect(parseWell("a01")).toEqual({ row: "A", column: 1 });
    expect(parseWell("H12")).toEqual({ row: "H", column: 12 });
    expect(parseWell(" B7 ")).toEqual({ row: "B", column: 7 });
  });

  test("refuses anything that is not a position", () => {
    expect(parseWell("A0")).toBeUndefined();
    expect(parseWell("12A")).toBeUndefined();
    expect(parseWell("Well3")).toBeUndefined();
    expect(parseWell("")).toBeUndefined();
  });
});

test("row labels run past Z", () => {
  expect(rowLabel(0)).toBe("A");
  expect(rowLabel(7)).toBe("H");
  expect(rowLabel(25)).toBe("Z");
  expect(rowLabel(26)).toBe("AA");
});

describe("buildPlateMaps", () => {
  test("a 96-well plate is drawn full size from one used well", () => {
    const maps = buildPlateMaps(
      input({
        annotation: {
          scheme: "imgt",
          annotations: [annotation({ plate: "P1", well: "A1" })],
          notNumbered: [],
          notAligned: [],
          unpaired: [],
          chainMismatch: [],
        },
      }),
    );
    expect(maps).toHaveLength(1);
    expect(maps[0]!.rowLabels).toHaveLength(8);
    expect(maps[0]!.columnLabels).toHaveLength(12);
    expect(maps[0]!.grid[0]![0]!.outcome).toBe("ok");
    expect(maps[0]!.grid[0]![1]!.outcome).toBe("empty");
    expect(maps[0]!.counts.empty).toBe(95);
  });

  test("a plate wider than 96 wells grows to the 384 layout", () => {
    const maps = buildPlateMaps(
      input({ trace: trace({ sequences: [sequence({ plate: "P1", well: "P24" })] }) }),
    );
    expect(maps[0]!.rowLabels).toHaveLength(16);
    expect(maps[0]!.columnLabels).toHaveLength(24);
  });

  test("a well with no surviving read reads as no usable read, not as undescribed", () => {
    const maps = buildPlateMaps(
      input({
        trace: trace({ sequences: [sequence({ plate: "P1", well: "A1", source: "none" })] }),
        annotation: {
          scheme: "imgt",
          annotations: [
            annotation({ plate: "P1", well: "A1", status: "Failed", vGene: undefined }),
          ],
          notNumbered: [],
          notAligned: [],
          unpaired: [],
          chainMismatch: [],
        },
      }),
    );
    expect(maps[0]!.grid[0]![0]!.outcome).toBe("noRead");
    expect(maps[0]!.grid[0]![0]!.note).toBe("No read survived the quality floor");
  });

  test("a chain mismatch is flagged and the note says both readings", () => {
    const maps = buildPlateMaps(
      input({
        trace: trace({ sequences: [sequence({ plate: "P1", well: "B2" })] }),
        annotation: {
          scheme: "imgt",
          annotations: [
            annotation({
              plate: "P1",
              well: "B2",
              chainMismatch: true,
              declaredChain: "IGH",
              observedChain: "K",
            }),
          ],
          notNumbered: [],
          notAligned: [],
          unpaired: [],
          chainMismatch: [],
        },
      }),
    );
    const cell = maps[0]!.grid[1]![1]!;
    expect(cell.outcome).toBe("flagged");
    expect(cell.note).toContain("name says IGH, sequence says K");
  });

  test("one bad chain decides a well its other chain would have passed", () => {
    const maps = buildPlateMaps(
      input({
        trace: trace({
          sequences: [
            sequence({ plate: "P1", well: "C3", chain: "IGH" }),
            sequence({ plate: "P1", well: "C3", chain: "IGK" }),
          ],
        }),
        annotation: {
          scheme: "imgt",
          annotations: [
            annotation({ plate: "P1", well: "C3", declaredChain: "IGH" }),
            annotation({ plate: "P1", well: "C3", declaredChain: "IGK", vGene: undefined }),
          ],
          notNumbered: [],
          notAligned: [],
          unpaired: [],
          chainMismatch: [],
        },
      }),
    );
    expect(maps[0]!.grid[2]![2]!.outcome).toBe("notDescribed");
    expect(maps[0]!.grid[2]![2]!.note).toBe("IGH · IGK: no germline");
  });

  test("a well the grid cannot place is kept beside it, not dropped", () => {
    const maps = buildPlateMaps(
      input({ trace: trace({ sequences: [sequence({ plate: "P1", well: "pool" })] }) }),
    );
    expect(maps[0]!.offGrid.map((c) => c.label)).toEqual(["pool"]);
    expect(maps[0]!.counts.ok + maps[0]!.counts.notDescribed).toBeGreaterThan(0);
  });

  test("plates come back in natural order", () => {
    const maps = buildPlateMaps(
      input({
        trace: trace({
          sequences: [
            sequence({ plate: "P10", well: "A1" }),
            sequence({ plate: "P2", well: "A1" }),
          ],
        }),
      }),
    );
    expect(maps.map((m) => m.plate)).toEqual(["P2", "P10"]);
  });
});

describe("buildFunnel", () => {
  test("the first step names the files the pattern could not place", () => {
    const steps = buildFunnel(input({ fileCount: 10, unmatched: ["a.ab1", "b.ab1"] }));
    expect(steps[0]).toEqual({
      label: "Files added",
      count: 10,
      parts: [
        { label: "placed by the pattern", count: 8 },
        { label: "unplaced", count: 2, bad: true },
      ],
    });
  });

  test("set-aside traces are grouped by their reason, the largest first", () => {
    const steps = buildFunnel(
      input({
        fileCount: 3,
        trace: trace({
          reads: [
            { path: "a", length: 700, usableLength: 650, meanQuality: 40, kept: true },
            { path: "b", length: 700, usableLength: 0, meanQuality: 5, kept: false },
            { path: "c", length: 0, usableLength: 0, meanQuality: 0, kept: false },
          ],
          setAside: [
            { path: "b", reason: "below the quality floor" },
            { path: "c", reason: "below the quality floor" },
          ],
        }),
      }),
    );
    const read = steps.find((s) => s.label === "Traces read")!;
    expect(read.count).toBe(3);
    expect(read.parts).toEqual([
      { label: "usable after the quality floor", count: 1 },
      { label: "below the quality floor", count: 2, bad: true },
    ]);
  });

  test("sequences break down by which ends were read", () => {
    const steps = buildFunnel(
      input({
        trace: trace({
          sequences: [
            sequence({ plate: "P1", well: "A1", source: "merged" }),
            sequence({ plate: "P1", well: "A2", source: "forward" }),
            sequence({ plate: "P1", well: "A3", source: "none" }),
          ],
        }),
      }),
    );
    const mols = steps.find((s) => s.label === "Sequences")!;
    expect(mols.count).toBe(3);
    expect(mols.parts).toEqual([
      { label: "both ends merged", count: 1, bad: false },
      { label: "forward only", count: 1, bad: false },
      { label: "no read survived", count: 1, bad: true },
    ]);
  });

  test("the collapse states what went in as well as what came out", () => {
    const steps = buildFunnel(
      input({
        annotation: {
          scheme: "imgt",
          annotations: [],
          notNumbered: [],
          notAligned: [],
          unpaired: [],
          chainMismatch: [],
          collapse: { clonesIn: 192, variantsOut: 94 },
        },
      }),
    );
    expect(steps.find((s) => s.label === "Variants")).toEqual({
      label: "Variants",
      count: 94,
      parts: [{ label: "collapsed from", count: 192 }],
    });
  });

  test("steps the run has not produced are left out rather than shown as zero", () => {
    const steps = buildFunnel(input({ fileCount: 4 }));
    expect(steps.map((s) => s.label)).toEqual(["Files added", "Clones"]);
  });
});

describe("buildLists", () => {
  test("only lists with something in them come back", () => {
    const lists = buildLists(
      input({
        unmatched: ["stray.ab1"],
        clonesWithoutProperties: ["P1 A1"],
        trace: trace({
          sequences: [
            sequence({ plate: "P1", well: "A1", mismatches: 12 }),
            sequence({ plate: "P1", well: "A2", mismatches: 0 }),
          ],
        }),
      }),
    );
    expect(lists.map((l) => l.label)).toEqual([
      "Unplaced files",
      "Reads disagreed on merge",
      "Clones no property reached",
    ]);
    expect(lists[1]!.items).toEqual(["P1 A1 IGH (12 positions)"]);
  });
});
