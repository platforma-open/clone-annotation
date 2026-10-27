import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import type { Sheet } from "../sheet";
import { normalizeWell, readSheet } from "../sheet";
import {
  buildProperties,
  cloneKey,
  duplicateKeyCount,
  guessPlateColumn,
  guessType,
  guessWellColumn,
} from "../properties";

function xlsx(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

describe("readSheet", () => {
  test("reads the header and one row per line", () => {
    const s = readSheet(
      xlsx([
        ["plate", "well", "elisa"],
        ["Plate1", "A1", 2.538],
        ["Plate1", "A2", 0.081],
      ]),
    );
    expect(s.columns).toEqual(["plate", "well", "elisa"]);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toEqual({ plate: "Plate1", well: "A1", elisa: "2.538" });
  });

  test("an empty cell stays absent, not an empty string", () => {
    const s = readSheet(
      xlsx([
        ["well", "elisa", "note"],
        ["A1", 2.538, "hit"],
        ["A2", 0.081, ""],
      ]),
    );
    expect(s.rows[1]).toEqual({ well: "A2", elisa: "0.081" });
    expect("note" in s.rows[1]!).toBe(false);
  });

  test("a row with nothing in it is dropped", () => {
    const s = readSheet(
      xlsx([
        ["well", "elisa"],
        ["A1", 1],
        ["", ""],
      ]),
    );
    expect(s.rows).toHaveLength(1);
  });

  test("an empty sheet gives no columns and no rows", () => {
    expect(readSheet(xlsx([]))).toEqual({ columns: [], rows: [] });
  });
});

describe("normalizeWell", () => {
  test("zero padding does not make a different well", () => {
    expect(normalizeWell("A01")).toBe("A1");
    expect(normalizeWell("A1")).toBe("A1");
    expect(normalizeWell("h012")).toBe("H12");
  });

  test("anything that is not a well is left alone", () => {
    expect(normalizeWell(" chamber-3 ")).toBe("chamber-3");
  });
});

describe("buildProperties", () => {
  const sheet: Sheet = {
    columns: ["plate", "well", "elisa"],
    rows: [
      { plate: "Plate1", well: "A1", elisa: "2.538" },
      { plate: "Plate1", well: "A02" },
      { plate: "Plate2", well: "A1", elisa: "0.081" },
    ],
  };
  const mapping = {
    plateColumn: "plate",
    wellColumn: "well",
    propertyColumns: ["elisa"],
    types: { elisa: "Double" as const },
  };

  test("keys values on plate and well together", () => {
    const [p] = buildProperties(sheet, mapping);
    expect(p?.values[cloneKey("Plate1", "A1")]).toBe("2.538");
    expect(p?.values[cloneKey("Plate2", "A1")]).toBe("0.081");
  });

  test("a row with no value contributes nothing", () => {
    const [p] = buildProperties(sheet, mapping);
    expect(cloneKey("Plate1", "A2") in (p?.values ?? {})).toBe(false);
  });

  test("the type the scientist chose is carried", () => {
    expect(buildProperties(sheet, mapping)[0]?.type).toBe("Double");
  });

  test("without a plate column every well shares one plate", () => {
    const [p] = buildProperties(sheet, { ...mapping, plateColumn: undefined });
    expect(p?.values[cloneKey("", "A1")]).toBe("0.081");
  });
});

describe("guessType", () => {
  test("whole numbers are Long, decimals Double, anything else String", () => {
    expect(guessType(["1", "2", "-3"])).toBe("Long");
    expect(guessType(["2.538", "0.081"])).toBe("Double");
    expect(guessType(["hit", "weak"])).toBe("String");
  });

  test("an empty column is a String rather than a guess", () => {
    expect(guessType([])).toBe("String");
  });
});

describe("guessWellColumn", () => {
  test("a header naming the well wins", () => {
    const s: Sheet = { columns: ["id", "Well", "elisa"], rows: [{ id: "x", Well: "A1" }] };
    expect(guessWellColumn(s)).toBe("Well");
  });

  test("without such a header the values decide", () => {
    const s: Sheet = {
      columns: ["id", "location"],
      rows: [
        { id: "x", location: "A1" },
        { id: "y", location: "B12" },
        { id: "z", location: "H7" },
      ],
    };
    expect(guessWellColumn(s)).toBe("location");
  });

  test("a column of labels is not a well column", () => {
    const s: Sheet = {
      columns: ["label"],
      rows: [{ label: "control" }, { label: "sample" }, { label: "blank" }],
    };
    expect(guessWellColumn(s)).toBeUndefined();
  });

  test("one well-shaped value is too little to go on", () => {
    const s: Sheet = { columns: ["note"], rows: [{ note: "A1" }] };
    expect(guessWellColumn(s)).toBeUndefined();
  });
});

describe("guessPlateColumn", () => {
  test("a header naming the plate is taken", () => {
    const s: Sheet = { columns: ["Plate", "well"], rows: [{ Plate: "Plate1", well: "A1" }] };
    expect(guessPlateColumn(s, "well")).toBe("Plate");
  });

  test("the well column is never also the plate", () => {
    const s: Sheet = { columns: ["plate_well"], rows: [{ plate_well: "P1-A1" }] };
    expect(guessPlateColumn(s, "plate_well")).toBeUndefined();
  });

  test("nothing is guessed from the values", () => {
    const s: Sheet = { columns: ["batch", "well"], rows: [{ batch: "Plate1", well: "A1" }] };
    expect(guessPlateColumn(s, "well")).toBeUndefined();
  });
});

describe("duplicateKeyCount", () => {
  const mapping = {
    plateColumn: "plate",
    wellColumn: "well",
    propertyColumns: [],
    types: {},
  };

  test("two rows on one well are a collision", () => {
    const s: Sheet = {
      columns: ["plate", "well"],
      rows: [
        { plate: "Plate1", well: "A1" },
        { plate: "Plate1", well: "A01" },
      ],
    };
    expect(duplicateKeyCount(s, mapping)).toBe(1);
  });

  test("the same well on another plate is not", () => {
    const s: Sheet = {
      columns: ["plate", "well"],
      rows: [
        { plate: "Plate1", well: "A1" },
        { plate: "Plate2", well: "A1" },
      ],
    };
    expect(duplicateKeyCount(s, mapping)).toBe(0);
  });

  test("without a plate column every well shares one plate", () => {
    const s: Sheet = {
      columns: ["plate", "well"],
      rows: [
        { plate: "Plate1", well: "A1" },
        { plate: "Plate2", well: "A1" },
      ],
    };
    expect(duplicateKeyCount(s, { ...mapping, plateColumn: undefined })).toBe(1);
  });
});
