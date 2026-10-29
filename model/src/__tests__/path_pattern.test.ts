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

  test("a literal-only optional section captures nothing", () => {
    const p = PathPattern.parse("{{Plate}}[_LC]/{{Well}}.ab1");
    const m = p.match("Plate1_LC/A1.ab1");
    expect(m?.plate?.value).toBe("Plate1");
    expect(m?.well.value).toBe("A1");
    expect(m?.anyMatchers).toEqual([]);
  });

  test("a malformed optional section is refused", () => {
    expect(() => PathPattern.parse("{{Plate}}[_LC/{{Well}}.ab1")).toThrow(/Unclosed/);
    expect(() => PathPattern.parse("{{Plate}}[]/{{Well}}.ab1")).toThrow(/Empty/);
    expect(() => PathPattern.parse("{{Plate}}[a/b]/{{Well}}.ab1")).toThrow(/directory/);
    expect(() => PathPattern.parse("{{Plate}}[_[x]]/{{Well}}.ab1")).toThrow(/another/);
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

  test("an unknown token is refused", () => {
    expect(() => PathPattern.parse("{{Wrong}}_{{Well}}.ab1")).toThrow(/Unknown token/);
  });

  test("character ranges are kept for highlighting", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}.ab1");
    const [plate] = p.rawElements.plate!;
    expect(p.rawPattern.slice(plate!.from, plate!.to)).toBe("{{Plate}}");
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

describe("typed tokens", () => {
  test("a well glued to the plate splits where the well starts", () => {
    const p = PathPattern.parse("{{Plate}}{{Well}}.{{*}}.ab1");
    const m = p.match("XY2208G04.XY57.ab1");
    expect(m?.plate?.value).toBe("XY2208");
    expect(m?.well.value).toBe("G04");
  });

  test("a chain glued to a clone number splits where the chain starts", () => {
    const p = PathPattern.parse("{{:Clone}}{{Chain}}_{{Well}}.ab1");
    const m = p.match("1234HC_A1.ab1");
    expect(m?.tags?.["Clone"]?.value).toBe("1234");
    expect(m?.chain?.value).toBe("HC");
  });

  test("the well takes A1 to P24, padded or not, in either case", () => {
    const p = PathPattern.parse("{{Well}}.ab1");
    for (const w of ["A1", "A01", "H12", "P24", "b7"])
      expect(p.match(`${w}.ab1`)?.well.value).toBe(w);
    for (const w of ["Q1", "A0", "A25", "A001", "P1a", "AA1"])
      expect(p.match(`${w}.ab1`)).toBeUndefined();
  });

  test("a name whose well slot holds no well is not matched", () => {
    const p = PathPattern.parse("{{Plate}}_{{Well}}.ab1");
    expect(p.match("Plate1_sample.ab1")).toBeUndefined();
    expect(p.explain("Plate1_sample.ab1")).toMatch(/Does not fit/);
  });

  test("the chain takes the usual spellings in any case", () => {
    const p = PathPattern.parse("{{Chain}}_{{Well}}.ab1");
    for (const c of ["IGH", "igk", "VHH", "VL", "HC", "Kappa", "lambda", "IgG", "IgG1", "H"])
      expect(p.match(`${c}_A1.ab1`)?.chain?.value).toBe(c);
    expect(p.match("12_A1.ab1")).toBeUndefined();
  });

  test("a chain list replaces the usual spellings", () => {
    const p = PathPattern.parse("{{Well}}_{{Chain:12|34}}.ab1");
    expect(p.match("A1_12.ab1")?.chain?.value).toBe("12");
    expect(p.match("A1_34.ab1")?.chain?.value).toBe("34");
    expect(p.match("A1_IGH.ab1")).toBeUndefined();
  });

  test("a tag list accepts only its values", () => {
    const p = PathPattern.parse("{{Well}}_{{:Primer:T7|SP6}}.ab1");
    expect(p.match("A1_SP6.ab1")?.tags?.["Primer"]?.value).toBe("SP6");
    expect(p.match("A1_M13.ab1")).toBeUndefined();
  });

  test("direction takes the spelled-out ends", () => {
    const p = PathPattern.parse("{{Well}}_{{Direction}}.ab1");
    expect(p.match("A1_FWD.ab1")?.direction?.value).toBe("FWD");
    expect(p.match("A1_reverse.ab1")?.direction?.value).toBe("reverse");
    expect(p.match("A1_inner.ab1")).toBeUndefined();
  });

  test("lists are refused where the workflow must read the value", () => {
    expect(() => PathPattern.parse("{{Well:A1|A2}}.ab1")).toThrow(/not a list/);
    expect(() => PathPattern.parse("{{Well}}_{{Direction:T7|SP6}}.ab1")).toThrow(/not a list/);
    expect(() => PathPattern.parse("{{Well}}_{{Chain:12||34}}.ab1")).toThrow(/Empty value/);
  });
});

describe("tokens inside an optional section", () => {
  test("the part is read where present and absent where not", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}_IgG[_{{:Primer}}].ab1");
    expect(p.match("P1/A1_IgG_ACGTACG.ab1")?.tags?.["Primer"]?.value).toBe("ACGTACG");
    const bare = p.match("P1/A1_IgG.ab1");
    expect(bare?.well.value).toBe("A1");
    expect(bare?.tags?.["Primer"]).toBeUndefined();
  });

  test("a rerun suffix becomes a field rather than a second copy of the well", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}_T7[_{{:Rerun}}].ab1");
    expect(p.match("21345/E09_T7.ab1")?.tags?.["Rerun"]).toBeUndefined();
    expect(p.match("21345/E09_T7_rep1.ab1")?.tags?.["Rerun"]?.value).toBe("rep1");
  });

  test("an absent part leaves nothing to highlight", () => {
    const p = PathPattern.parse("{{Well}}[_{{Chain}}].ab1");
    const m = p.match("A1.ab1")!;
    expect(highlightMatch("A1.ab1", m, { well: { begin: "<w>", end: "</w>" } })).toBe(
      "<w>A1</w>.ab1",
    );
  });

  test("a well cannot be optional, and tokens do not mix with alternatives", () => {
    expect(() => PathPattern.parse("{{Plate}}[_{{Well}}].ab1")).toThrow(/every file needs a well/);
    expect(() => PathPattern.parse("{{Well}}[_{{Chain}}|_x].ab1")).toThrow(/alternatives/);
  });
});

describe("a field read in two places", () => {
  test("copies that agree give one value and highlight both places", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}_{{Plate}}_T7.ab1");
    const m = p.match("21345/E06_21345_T7.ab1");
    expect(m?.plate?.value).toBe("21345");
    expect(m?.plate?.ranges).toHaveLength(2);
    const html = highlightMatch("21345/E06_21345_T7.ab1", m!, {
      plate: { begin: "<p>", end: "</p>" },
    });
    expect(html).toBe("<p>21345</p>/E06_<p>21345</p>_T7.ab1");
  });

  test("copies that disagree leave the file unmatched, with the reason", () => {
    const p = PathPattern.parse("{{Plate}}/{{Well}}_{{Plate}}_T7.ab1");
    expect(p.match("21345/E06_21346_T7.ab1")).toBeUndefined();
    expect(p.explain("21345/E06_21346_T7.ab1")).toBe(
      '{{Plate}} reads "21345" in one place and "21346" in another',
    );
  });

  test("a chain in the folder and in the name must agree", () => {
    const p = PathPattern.parse("Hybridoma_{{Chain}}/{{:Clone}}_{{Chain}}_{{Well}}.fastq");
    expect(p.match("Hybridoma_VL/1234_vl_A1.fastq")).toBeUndefined();
    expect(p.match("Hybridoma_VL/1234_VL_A1.fastq")?.chain?.value).toBe("VL");
  });

  test("a copy inside an absent section does not count against the other", () => {
    const p = PathPattern.parse("{{Plate}}[_{{Direction}}]/{{Well}}[_{{Direction}}].ab1");
    expect(p.match("E12_01_R/B12_R.ab1")?.direction?.value).toBe("R");
    expect(p.match("E12_01/B12_R.ab1")?.direction?.value).toBe("R");
    expect(p.match("E12_01_F/B12_R.ab1")).toBeUndefined();
  });

  test("a tag read twice must agree too", () => {
    const p = PathPattern.parse("{{:Run}}/{{Well}}_{{:Run}}.ab1");
    expect(p.explain("r1/A1_r2.ab1")).toMatch(/\{\{:Run\}\} reads "r1"/);
  });
});

describe("defaults", () => {
  test("a default fills a field whose section is absent", () => {
    const p = PathPattern.parse("{{Plate}}[_{{Direction=F}}]/{{Well}}.ab1");
    const fwd = p.match("E12_01/B12.ab1");
    expect(fwd?.plate?.value).toBe("E12_01");
    expect(fwd?.direction).toEqual({ value: "F", ranges: [] });
    expect(p.match("E12_01_R/B12.ab1")?.direction?.value).toBe("R");
  });

  test("one default covers every copy of the field", () => {
    const p = PathPattern.parse("{{Plate}}[_{{Direction=F}}]/{{Well}}[_{{Direction}}].ab1");
    expect(p.match("E12_01/B12.ab1")?.direction?.value).toBe("F");
    expect(p.match("E12_01/B12_R.ab1")?.direction?.value).toBe("R");
  });

  test("a tag can carry a default", () => {
    const p = PathPattern.parse("{{Well}}[_{{:Rerun=original}}].ab1");
    expect(p.match("A1.ab1")?.tags?.["Rerun"]?.value).toBe("original");
    expect(p.match("A1_rep1.ab1")?.tags?.["Rerun"]?.value).toBe("rep1");
  });

  test("a default that could never apply is refused", () => {
    expect(() => PathPattern.parse("{{Well}}_{{Direction=F}}.ab1")).toThrow(/only inside \[ \]/);
    expect(() =>
      PathPattern.parse("{{Plate}}_{{Direction}}/{{Well}}[_{{Direction=F}}].ab1"),
    ).toThrow(/never applies/);
  });

  test("a default the token itself would not accept is refused", () => {
    expect(() => PathPattern.parse("{{Well}}[_{{Direction=inner}}].ab1")).toThrow(/not a value/);
    expect(() => PathPattern.parse("{{Well}}[_{{Chain:12|34=IGH}}].ab1")).toThrow(/not a value/);
    expect(() => PathPattern.parse("{{Well}}[_{{:Run=}}].ab1")).toThrow(/Empty default/);
  });

  test("two copies with different defaults are refused", () => {
    expect(() =>
      PathPattern.parse("{{Plate}}[_{{Direction=F}}]/{{Well}}[_{{Direction=R}}].ab1"),
    ).toThrow(/different defaults/);
  });

  test("skip tokens take no options", () => {
    expect(() => PathPattern.parse("{{Well}}[_{{*=x}}].ab1")).toThrow(/no list or default/);
  });
});

describe("where optional sections sit", () => {
  test("a present section gives its range, an absent one gives undefined", () => {
    const p = PathPattern.parse("{{Plate}}[_LC|_KC]/{{Well}}[_{{:Run}}].ab1");
    expect(p.match("P7_KC/A1.ab1")?.sections).toEqual([{ from: 2, to: 5 }, undefined]);
    expect(p.match("P7/A1_r2.ab1")?.sections).toEqual([undefined, { from: 5, to: 8 }]);
  });

  test("a section does not shift the groups of the tokens inside it", () => {
    const p = PathPattern.parse("[x_]{{Well}}[_{{Direction}}].ab1");
    const m = p.match("x_A1_R.ab1");
    expect(m?.well.value).toBe("A1");
    expect(m?.direction?.value).toBe("R");
  });
});
