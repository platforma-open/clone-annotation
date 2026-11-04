import { describe, expect, test } from "vitest";
import type { ImportFileHandle } from "@platforma-open/milaboratories.clone-annotation.model";
import { PathPattern } from "@platforma-open/milaboratories.clone-annotation.model";
import { checkSelection, groupSelection, summarizeFields } from "../selection_summary";
import type { SelectedFile } from "../trace_set";

function select(pattern: PathPattern | undefined, paths: string[]): SelectedFile[] {
  return paths.map((p) => ({
    handle: p as unknown as ImportFileHandle,
    path: p,
    relativePath: p,
    match: pattern?.match(p),
    reason: pattern && !pattern.match(p) ? pattern.explain(p) : undefined,
  }));
}

describe("summarizeFields", () => {
  test("lists each declared field with its values, most common first", () => {
    const pattern = PathPattern.parse("{{Plate}}_{{Well}}_{{Chain}}.ab1");
    const files = select(pattern, [
      "P1_A01_IGH.ab1",
      "P1_A01_IGL.ab1",
      "P1_A02_IGH.ab1",
      "P2_A01_IGH.ab1",
    ]);
    expect(summarizeFields(files, pattern)).toEqual([
      {
        label: "Plate",
        kind: "plate",
        values: [
          { value: "P1", count: 3 },
          { value: "P2", count: 1 },
        ],
      },
      {
        label: "Well",
        kind: "well",
        values: [
          { value: "A01", count: 3 },
          { value: "A02", count: 1 },
        ],
      },
      {
        label: "Chain",
        kind: "chain",
        values: [
          { value: "IGH", count: 3 },
          { value: "IGL", count: 1 },
        ],
      },
    ]);
  });

  test("equal counts sort in natural order, so A2 comes before A10", () => {
    const pattern = PathPattern.parse("{{Well}}.ab1");
    const files = select(pattern, ["A10.ab1", "A2.ab1", "A1.ab1"]);
    expect(summarizeFields(files, pattern)[0]!.values.map((v) => v.value)).toEqual([
      "A1",
      "A2",
      "A10",
    ]);
  });

  test("unmatched files do not count", () => {
    const pattern = PathPattern.parse("{{Well}}.ab1");
    const files = select(pattern, ["A1.ab1", "notes.ab1"]);
    expect(summarizeFields(files, pattern)[0]!.values).toEqual([{ value: "A1", count: 1 }]);
  });

  test("a tag gets its own row, and a file without it counts as empty", () => {
    const pattern = PathPattern.parse("{{Well}}[_{{:Rerun}}].ab1");
    const files = select(pattern, ["A1.ab1", "A2.ab1", "A1_rep1.ab1"]);
    expect(summarizeFields(files, pattern)[1]).toEqual({
      label: "Rerun",
      kind: "tag",
      values: [
        { value: "", count: 2 },
        { value: "rep1", count: 1 },
      ],
    });
  });

  test("a default shows as a value", () => {
    const pattern = PathPattern.parse("{{Well}}[_{{Direction=F}}].ab1");
    const files = select(pattern, ["A1.ab1", "A1_R.ab1"]);
    expect(summarizeFields(files, pattern)[1]!.values).toEqual([
      { value: "F", count: 1 },
      { value: "R", count: 1 },
    ]);
  });
});

describe("groupSelection", () => {
  test("files with the same identity are grouped as a collision", () => {
    const pattern = PathPattern.parse("{{Well}}[_{{:Rerun}}].ab1");
    const g = groupSelection(select(pattern, ["A1.ab1", "A1_rep1.ab1", "A2.ab1"]));
    expect(g.collisions.map((c) => c.map((f) => f.path))).toEqual([["A1.ab1", "A1_rep1.ab1"]]);
    expect(g.matched.map((f) => f.path)).toEqual(["A2.ab1"]);
  });

  test("unmatched files are grouped by reason, the largest group first", () => {
    const pattern = PathPattern.parse("{{Plate}}/{{Well}}_{{Plate}}.ab1");
    const g = groupSelection(select(pattern, ["P1/A1_P2.ab1", "x.ab1", "y.ab1", "P1/A2_P1.ab1"]));
    expect(g.unmatched.map((u) => [u.reason, u.files.length])).toEqual([
      ["Does not fit the pattern", 2],
      ['{{Plate}} reads "P1" in one place and "P2" in another', 1],
    ]);
    expect(g.matched.map((f) => f.path)).toEqual(["P1/A2_P1.ab1"]);
  });

  test("without a pattern every file is unmatched with no reason", () => {
    const g = groupSelection(select(undefined, ["A1.ab1", "A2.ab1"]));
    expect(g.unmatched).toEqual([{ reason: undefined, files: expect.any(Array) }]);
    expect(g.unmatched[0]!.files).toHaveLength(2);
    expect(g.collisions).toEqual([]);
  });
});

describe("checkSelection", () => {
  const check = (pattern: string, paths: string[]) => {
    const p = PathPattern.parse(pattern);
    return checkSelection(select(p, paths), p);
  };

  test("a clean plate gives no warnings", () => {
    expect(
      check("{{Plate}}_{{Well}}_{{Chain}}_{{Direction}}.ab1", [
        "P1_A1_H_F.ab1",
        "P1_A1_H_R.ab1",
        "P1_A1_L_F.ab1",
        "P1_A1_L_R.ab1",
        "P1_A2_H_F.ab1",
        "P1_A2_H_R.ab1",
        "P1_A2_L_F.ab1",
        "P1_A2_L_R.ab1",
      ]),
    ).toEqual([]);
  });

  test("all files on one well", () => {
    expect(check("{{Well}}_{{Chain}}.ab1", ["A1_H.ab1", "A1_L.ab1"])).toEqual([
      "All 2 files read the same well, A1.",
    ]);
  });

  test("every file on its own plate", () => {
    expect(check("{{Plate}}_{{Well}}.ab1", ["R101_A1.ab1", "R102_A2.ab1"])).toEqual([
      "Every file has its own plate. The plate may be reading a part that changes per file.",
    ]);
  });

  test("a well with only one chain", () => {
    expect(check("{{Well}}_{{Chain}}.ab1", ["A1_H.ab1", "A1_L.ab1", "A2_H.ab1"])).toEqual([
      "1 of 2 wells have only one chain, for example A2 (H).",
    ]);
  });

  test("a dataset with one chain only is not warned about", () => {
    expect(check("{{Well}}_{{Chain}}.ab1", ["A1_VHH.ab1", "A2_VHH.ab1"])).toEqual([]);
  });

  test("a read with only one direction", () => {
    expect(
      check("{{Plate}}_{{Well}}_{{Direction}}.ab1", ["P1_A1_F.ab1", "P1_A1_R.ab1", "P1_A2_F.ab1"]),
    ).toEqual(["1 of 2 reads have only one direction, for example P1 A2 (F)."]);
  });

  test("more than two direction values", () => {
    expect(
      check("{{Well}}_{{Direction}}.ab1", ["A1_F.ab1", "A1_R.ab1", "A2_fwd.ab1", "A2_rev.ab1"]),
    ).toEqual([
      "Direction has 4 values: F, R, fwd, rev. Check that each one means forward or reverse.",
    ]);
  });

  test("a skipped part that changes from file to file", () => {
    expect(check("{{*}}_{{Well}}.ab1", ["run1_A1.ab1", "run2_A2.ab1"])).toEqual([
      "The skipped part {{*}} has 2 different values, for example run1, run2. If they matter, read it as a tag, like {{:Run}}.",
    ]);
  });

  test("a skipped part with one value is fine", () => {
    expect(check("{{*}}_{{Well}}.ab1", ["run1_A1.ab1", "run1_A2.ab1"])).toEqual([]);
  });

  test("several skipped parts are told apart by number", () => {
    expect(check("{{*}}_{{Well}}_{{*}}.ab1", ["x_A1_a.ab1", "x_A2_b.ab1"])).toEqual([
      "Skipped part 2 ({{*}}) has 2 different values, for example a, b. If they matter, read it as a tag, like {{:Run}}.",
    ]);
  });
});
