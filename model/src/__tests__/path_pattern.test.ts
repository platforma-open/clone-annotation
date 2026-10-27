import { describe, expect, test } from "vitest";
import { highlightMatch, PathPattern } from "../path_pattern";

describe("PathPattern", () => {
  test("binds the plate to a directory segment", () => {
    const p = PathPattern.parse("{{Plate}}/{{:Run}}-{{Well}}.ab1");
    const m = p.match("Plate1/Run7-A10.ab1");
    expect(m?.plate?.value).toBe("Plate1");
    expect(m?.well.value).toBe("A10");
    expect(m?.tags?.["Run"]?.value).toBe("Run7");
  });

  test("plate directory, well and chain in the name, trailing part ignored", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}-{{:Lib}}_{{Chain}}_Run_{{*}}.ab1");
    const m = p.match("Plate1/A1-3_IgG_Run_BARCODE.ab1");
    expect(m?.plate?.value).toBe("Plate1");
    expect(m?.well.value).toBe("A1");
    expect(m?.chain?.value).toBe("IgG");
  });

  test("flat layout: everything in the file name", () => {
    const p = PathPattern.parse("Plate_{{Chain}}_{{Direction}}_{{Well}}-{{*}}.ab1");
    const m = p.match("Plate_IGH_F_A1-IGH_F.ab1");
    expect(m?.chain?.value).toBe("IGH");
    expect(m?.well.value).toBe("A1");
  });

  // The pattern the import dialog suggests. A default that does not parse would
  // send every new user to the help tooltip.
  test("the suggested pattern reads a flat four-part name", () => {
    const p = PathPattern.parse("{{Plate}}_{{Chain}}_{{Direction}}_{{Well}}.ab1");
    const m = p.match("P3a_IGH_R_B10.ab1");
    expect(m?.plate?.value).toBe("P3a");
    expect(m?.chain?.value).toBe("IGH");
    expect(m?.direction?.value).toBe("R");
    expect(m?.well.value).toBe("B10");
  });

  test("direction takes F/R, fwd/rev and a numbered read", () => {
    const p = PathPattern.parse("{{Well}}_{{Direction}}.ab1");
    expect(p.match("A1_F.ab1")?.direction?.value).toBe("F");
    expect(p.match("A1_rev.ab1")?.direction?.value).toBe("rev");
    expect(p.match("A1_R2.ab1")?.direction?.value).toBe("R2");
  });

  test("an optional suffix lets one plate cover several folders", () => {
    const p = PathPattern.parse("{{Plate}}[_LC|_KC]/{{Well}}_{{Chain}}.ab1");
    expect(p.match("Plate1/A1_IgG.ab1")?.plate?.value).toBe("Plate1");
    expect(p.match("Plate1_LC/A1_Lambda.ab1")?.plate?.value).toBe("Plate1");
    expect(p.match("Plate1_KC/A1_Kappa.ab1")?.plate?.value).toBe("Plate1");
  });

  test("a folder matching no alternative keeps its whole name", () => {
    const p = PathPattern.parse("{{Plate}}[_LC|_KC]/{{Well}}_{{Chain}}.ab1");
    expect(p.match("Plate1_XX/A1_IgG.ab1")?.plate?.value).toBe("Plate1_XX");
  });

  test("the optional section captures nothing", () => {
    const p = PathPattern.parse("{{Plate}}[_LC]/{{Well}}.ab1");
    expect(p.compiled.groups.plate).toBe(1);
    expect(p.match("Plate1_LC/A1.ab1")?.well.value).toBe("A1");
  });

  test("a malformed optional section is refused", () => {
    expect(() => PathPattern.parse("{{Plate}}[_LC/{{Well}}.ab1")).toThrow(/Unclosed/);
    expect(() => PathPattern.parse("{{Plate}}[]/{{Well}}.ab1")).toThrow(/Empty/);
    expect(() => PathPattern.parse("{{Plate}}[a/b]/{{Well}}.ab1")).toThrow(/directory/);
    // A token inside the section is consumed by the token scan first, so the
    // bracket is reported unclosed. Refused either way.
    expect(() => PathPattern.parse("{{Plate}}[{{Chain}}]/{{Well}}.ab1")).toThrow();
  });

  test("a token never spans a directory boundary", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}.ab1");
    expect(p.match("a/b/c.ab1")).toBeUndefined();
  });

  test("non-matching extension does not match", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}.ab1");
    expect(p.match("P1/A10.fastq")).toBeUndefined();
  });

  test("extension is exposed for the dialog filter", () => {
    expect(PathPattern.parse("{{Well}}.scf").extension).toBe("scf");
  });

  test("a pattern without {{Well}} is refused", () => {
    expect(() => PathPattern.parse("{{Plate}}/x.ab1")).toThrow(/No \{\{Well\}\}/);
  });

  test("a repeated matcher is refused", () => {
    expect(() => PathPattern.parse("{{Well}}_{{Well}}.ab1")).toThrow(/Repeated/);
  });

  test("character ranges are kept for highlighting", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}.ab1");
    expect(p.rawPattern.slice(p.rawElements.plate!.from, p.rawElements.plate!.to)).toBe(
      "{{Plate}}",
    );
  });
});

describe("highlightMatch", () => {
  const opts = {
    well: { begin: "<w>", end: "</w>" },
    plate: { begin: "<p>", end: "</p>" },
  };

  test("wraps each captured field and leaves the rest alone", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}.ab1");
    const m = p.match("P1/A10.ab1")!;
    expect(highlightMatch("P1/A10.ab1", m, opts)).toBe("<p>P1</p>/<w>A10</w>.ab1");
  });

  test("escapes text it did not add, including the tail", () => {
    const p = PathPattern.parse("{{Well}}<&>.ab1");
    const m = p.match("A1<&>.ab1")!;
    expect(highlightMatch("A1<&>.ab1", m, opts)).toBe("<w>A1</w>&lt;&amp;&gt;.ab1");
  });

  test("a field with no wrapping is left as plain escaped text", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}.ab1");
    const m = p.match("P1/A10.ab1")!;
    expect(highlightMatch("P1/A10.ab1", m, { well: opts.well })).toBe("P1/<w>A10</w>.ab1");
  });
});
