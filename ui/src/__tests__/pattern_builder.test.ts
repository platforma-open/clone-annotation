import { describe, expect, test } from "vitest";
import { PathPattern } from "@platforma-open/milaboratories.clone-annotation.model";
import type { Piece, Role } from "../pattern_builder";
import {
  addFolder,
  defaultPieces,
  dropFolder,
  fromPattern,
  guessWell,
  joinWithNext,
  markWell,
  makeOptional,
  makeRequired,
  removePiece,
  setRole,
  setSection,
  splitPiece,
  toPattern,
} from "../pattern_builder";

const texts = (example: string, pieces: Piece[]) => pieces.map((p) => example.slice(p.from, p.to));

/** Gives roles to the pieces whose text is listed, and builds the pattern. */
function build(example: string, roles: Record<string, Role>, pieces = defaultPieces(example)) {
  let out = pieces;
  out.forEach((p, i) => {
    const role = roles[example.slice(p.from, p.to)];
    if (role) out = setRole(out, i, role, role === "tag" ? "Run" : undefined);
  });
  return toPattern(example, out);
}

describe("defaultPieces", () => {
  test("cuts at separators and keeps each separator as its own piece", () => {
    const e = "21345/E06_21345_T7.ab1";
    expect(texts(e, defaultPieces(e))).toEqual([
      "21345",
      "/",
      "E06",
      "_",
      "21345",
      "_",
      "T7",
      ".",
      "ab1",
    ]);
  });
});

describe("splitPiece", () => {
  test("cuts where letters meet digits, and keeps a well whole", () => {
    const e = "XY2208G04.ab1";
    expect(texts(e, splitPiece(e, defaultPieces(e), 0))).toEqual(["XY", "2208", "G04", ".", "ab1"]);
  });

  test("a word that is not a well is cut at every change", () => {
    const e = "Plate12.ab1";
    expect(texts(e, splitPiece(e, defaultPieces(e), 0))).toEqual(["Plate", "12", ".", "ab1"]);
  });

  test("a piece with nothing to cut stays as it is", () => {
    const e = "A1.ab1";
    const pieces = defaultPieces(e);
    expect(splitPiece(e, pieces, 0)).toBe(pieces);
  });
});

describe("joinWithNext", () => {
  test("joins across a separator", () => {
    const e = "E12_01/B12.ab1";
    expect(texts(e, joinWithNext(e, defaultPieces(e), 0))).toEqual([
      "E12_01",
      "/",
      "B12",
      ".",
      "ab1",
    ]);
  });

  test("joins two pieces that a split made", () => {
    const e = "XY2208G04.ab1";
    const split = splitPiece(e, defaultPieces(e), 0);
    expect(texts(e, joinWithNext(e, split, 0))).toEqual(["XY2208", "G04", ".", "ab1"]);
  });
});

describe("toPattern", () => {
  test("writes a token for each role and the rest as text", () => {
    expect(build("21345/E06_21345_T7.ab1", { "21345": "plate", E06: "well" }).pattern).toBe(
      "{{Plate}}/{{Well}}_{{Plate}}_T7.ab1",
    );
  });

  test("all roles", () => {
    expect(
      build("P1_A1_IGH_F_run2_x.ab1", {
        P1: "plate",
        A1: "well",
        IGH: "chain",
        F: "direction",
        run2: "tag",
        x: "skip",
      }).pattern,
    ).toBe("{{Plate}}_{{Well}}_{{Chain}}_{{Direction}}_{{:Run}}_{{*}}.ab1");
  });

  test("an unusual chain code is written as a list, with a note", () => {
    const built = build("A1_12.ab1", { A1: "well", "12": "chain" });
    expect(built.pattern).toBe("{{Well}}_{{Chain:12}}.ab1");
    expect(built.notes).toHaveLength(1);
  });

  test("a piece that is not a well gets a note", () => {
    expect(build("X9_IGH.ab1", { X9: "well" }).notes[0]).toMatch(/not a well/);
  });

  test("text the grammar would read as syntax is skipped", () => {
    expect(build("[x]_A1.ab1", { A1: "well" }).pattern).toBe("{{*}}_{{Well}}.ab1");
  });
});

describe("fromPattern", () => {
  const read = (example: string, text: string) =>
    fromPattern(example, text, PathPattern.parse(text));

  test("gives each token's piece its role", () => {
    const e = "21345/E06_21345_T7.ab1";
    const pieces = read(e, "{{Plate}}/{{Well}}_{{Plate}}_T7.ab1")!;
    expect(pieces.map((p) => [e.slice(p.from, p.to), p.role])).toEqual([
      ["21345", "plate"],
      ["/", "text"],
      ["E06", "well"],
      ["_", "text"],
      ["21345", "plate"],
      ["_", "text"],
      ["T7", "text"],
      [".", "text"],
      ["ab1", "text"],
    ]);
  });

  test("a token without a separator next to it becomes its own piece", () => {
    const e = "XY2200A07.ab1";
    const pieces = read(e, "{{Plate}}{{Well}}.ab1")!;
    expect(texts(e, pieces)).toEqual(["XY2200", "A07", ".", "ab1"]);
  });

  test("a plate that holds a separator stays one piece", () => {
    const e = "E12_01/B12.ab1";
    expect(texts(e, read(e, "{{Plate}}/{{Well}}.ab1")!)).toEqual([
      "E12_01",
      "/",
      "B12",
      ".",
      "ab1",
    ]);
  });

  test("writing back gives the same text, lists and aliases included", () => {
    for (const [e, text] of [
      ["A1_12_run7.ab1", "{{w}}_{{Chain:12|34}}_{{:Run}}.ab1"],
      ["x12_A1.ab1", "x{{n}}_{{Well}}.ab1"],
      ["P1/A1_P1.ab1", "{{Plate}}/{{Well}}_{{Plate}}.ab1"],
    ] as const) {
      expect(toPattern(e, read(e, text)!).pattern).toBe(text);
    }
  });

  test("an example that does not fit cannot be shown", () => {
    expect(read("notes.ab1", "{{Well}}.ab1")).toBeUndefined();
  });

  test("changing a role drops the kept token", () => {
    const e = "A1_12.ab1";
    const pieces = read(e, "{{Well}}_{{Chain:12|34}}.ab1")!;
    const i = pieces.findIndex((p) => p.role === "chain");
    expect(toPattern(e, setRole(pieces, i, "skip")).pattern).toBe("{{Well}}_{{*}}.ab1");
  });
});

describe("folders", () => {
  test("a folder is added in front as text", () => {
    expect(addFolder("{{Well}}.ab1", "plate7")).toBe("plate7/{{Well}}.ab1");
  });

  test("the first folder is dropped", () => {
    expect(dropFolder("{{Plate}}/{{Well}}.ab1")).toBe("{{Well}}.ab1");
  });
});

describe("optional parts", () => {
  const PATTERN = "{{Plate}}[_LC|_KC]/{{Well}}-3_{{Chain}}_Inner_{{*}}.ab1";
  const read = (example: string, text: string) =>
    fromPattern(example, text, PathPattern.parse(text));
  const roles = (e: string, pieces: Piece[]) =>
    pieces.map((p) => [e.slice(p.from, p.to), p.section ?? p.role]);

  test("a present part is one piece that keeps its text", () => {
    const e = "E12_01_LC/B12-3_IgK_Inner_x7.ab1";
    const pieces = read(e, PATTERN)!;
    expect(roles(e, pieces).slice(0, 3)).toEqual([
      ["E12_01", "plate"],
      ["_LC", "_LC|_KC"],
      ["/", "text"],
    ]);
    expect(toPattern(e, pieces).pattern).toBe(PATTERN);
  });

  test("an absent part is an empty piece in its place", () => {
    const e = "E12_01/B12-3_IgG_Inner_x7.ab1";
    const pieces = read(e, PATTERN)!;
    expect(pieces[1]).toEqual({ from: 6, to: 6, role: "text", section: "_LC|_KC" });
    expect(toPattern(e, pieces).pattern).toBe(PATTERN);
  });

  test("a part with a token in it is read back too", () => {
    const text = "{{Plate}}[_{{Direction=F}}]/{{Well}}[_{{:Run}}].ab1";
    for (const e of ["P1/A1.ab1", "P1_R/A1_r2.ab1"])
      expect(toPattern(e, read(e, text)!).pattern).toBe(text);
  });

  test("making a piece optional takes the separator before it", () => {
    const e = "P7_LC/A1.ab1";
    const pieces = build(e, { P7: "plate", A1: "well" });
    const parsed = read(e, pieces.pattern)!;
    const lc = parsed.findIndex((p) => e.slice(p.from, p.to) === "LC");
    expect(toPattern(e, makeOptional(e, parsed, lc)).pattern).toBe("{{Plate}}[_LC]/{{Well}}.ab1");
  });

  test("at the start of a name it takes the separator after it", () => {
    const e = "rep1_A1.ab1";
    const pieces = setRole(defaultPieces(e), 2, "well");
    expect(toPattern(e, makeOptional(e, pieces, 0)).pattern).toBe("[rep1_]{{Well}}.ab1");
  });

  test("an optional field keeps its token", () => {
    const e = "A1_R.ab1";
    const pieces = setRole(setRole(defaultPieces(e), 0, "well"), 2, "direction");
    expect(toPattern(e, makeOptional(e, pieces, 2)).pattern).toBe("{{Well}}[_{{Direction}}].ab1");
  });

  test("the well cannot be optional", () => {
    const e = "A1.ab1";
    const pieces = setRole(defaultPieces(e), 0, "well");
    expect(makeOptional(e, pieces, 0)).toBe(pieces);
  });

  test("the part's text can be edited, made required, or removed", () => {
    const e = "P7_LC/A1.ab1";
    const pieces = read(e, "{{Plate}}[_LC]/{{Well}}.ab1")!;
    expect(toPattern(e, setSection(pieces, 1, "_LC|_KC")).pattern).toBe(
      "{{Plate}}[_LC|_KC]/{{Well}}.ab1",
    );
    expect(toPattern(e, makeRequired(pieces, 1)).pattern).toBe("{{Plate}}_LC/{{Well}}.ab1");

    const absent = "P7/A1.ab1";
    const without = read(absent, "{{Plate}}[_LC]/{{Well}}.ab1")!;
    expect(toPattern(absent, removePiece(without, 1)).pattern).toBe("{{Plate}}/{{Well}}.ab1");
  });

  test("join and split leave an optional part alone", () => {
    const e = "P7_LC/A1.ab1";
    const pieces = read(e, "{{Plate}}[_LC]/{{Well}}.ab1")!;
    expect(joinWithNext(e, pieces, 0)).toBe(pieces);
    expect(splitPiece(e, pieces, 1)).toBe(pieces);
  });
});

describe("guessWell", () => {
  const plate = (name: string) =>
    ["A", "B", "C", "D"].flatMap((row) =>
      [1, 2, 3].map((col) => name.replaceAll("@", `${row}0${col}`)),
    );

  test("finds the part that takes the most well-like values", () => {
    const names = plate("21345/@_21345_T7.ab1");
    expect(guessWell(names[0]!, names)).toEqual({
      kind: "found",
      from: 6,
      to: 9,
      values: 12,
      files: 12,
    });
  });

  test("a plate that looks like a well does not win over the real well", () => {
    const names = [...plate("P1_IGH_@.ab1"), ...plate("P3_IGH_@.ab1")];
    const guess = guessWell(names[0]!, names);
    expect(guess?.kind).toBe("found");
    expect(names[0]!.slice((guess as { from: number }).from, (guess as { to: number }).to)).toBe(
      "A01",
    );
  });

  test("finds a well glued to the plate name", () => {
    const names = plate("XY2208@.ab1");
    expect(guessWell(names[0]!, names)).toMatchObject({ kind: "found", from: 6, to: 9 });
  });

  test("two parts with as many well-like values are left to the scientist", () => {
    const names = plate("@_SEQ_@.seq");
    expect(guessWell(names[0]!, names)).toEqual({ kind: "unsure", parts: ["A01", "A01"] });
  });

  test("a well-like part with one value is not a well", () => {
    const names = ["run_H1_x1.ab1", "run_H1_x2.ab1"];
    expect(guessWell(names[0]!, names)).toBeUndefined();
  });

  test("files named another way are left out", () => {
    const names = [...plate("@.ab1"), "notes_v2.ab1"];
    expect(guessWell(names[0]!, names)).toMatchObject({ kind: "found", files: 12 });
  });

  test("one file is not enough to tell", () => {
    expect(guessWell("A1.ab1", ["A1.ab1"])).toBeUndefined();
  });
});

describe("markWell", () => {
  test("marks a whole piece", () => {
    const e = "P1_A07.ab1";
    expect(toPattern(e, markWell(defaultPieces(e), 3, 6)).pattern).toBe("P1_{{Well}}.ab1");
  });

  test("cuts the well out of a bigger piece", () => {
    const e = "XY2200A07.ab1";
    const pieces = markWell(defaultPieces(e), 6, 9);
    expect(texts(e, pieces)).toEqual(["XY2200", "A07", ".", "ab1"]);
    expect(toPattern(e, pieces).pattern).toBe("XY2200{{Well}}.ab1");
  });
});
