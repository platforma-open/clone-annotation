import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import type { Sheet } from "../sheet";
import { readSheet } from "../sheet";
import {
  buildProperties,
  cloneKey,
  duplicateKeyCount,
  guessIdentityColumn,
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

  test("delimited text keeps every value as written", () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    for (const [name, text] of [
      ["plates.csv", "plate,well,elisa\n001,A1,2.50\n"],
      ["plates.tsv", "plate\twell\telisa\n001\tA1\t2.50\n"],
    ] as const) {
      expect(readSheet(bytes(text), name).rows[0]).toEqual({
        plate: "001",
        well: "A1",
        elisa: "2.50",
      });
    }
  });

  test("an empty sheet gives no columns and no rows", () => {
    expect(readSheet(xlsx([]))).toEqual({ columns: [], rows: [] });
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
    plateInKey: true,
  };

  test("keys values on plate and well together", () => {
    const [p] = buildProperties(sheet, mapping);
    expect(p?.values[cloneKey("Plate1", "A1", false, true)]).toBe("2.538");
    expect(p?.values[cloneKey("Plate2", "A1", false, true)]).toBe("0.081");
  });

  test("a row with no value contributes nothing", () => {
    const [p] = buildProperties(sheet, mapping);
    expect(cloneKey("Plate1", "A2", false, true) in (p?.values ?? {})).toBe(false);
  });

  test("the type the scientist chose is carried", () => {
    expect(buildProperties(sheet, mapping)[0]?.type).toBe("Double");
  });

  test("with no real plate the well alone is the key", () => {
    const [p] = buildProperties(sheet, { ...mapping, plateColumn: undefined, plateInKey: false });
    expect(p?.values[cloneKey("", "A1", false, false)]).toBe("0.081");
  });
});

describe("buildProperties for a name-keyed set", () => {
  const sheet: Sheet = {
    columns: ["clone_id", "elisa"],
    rows: [
      { clone_id: "clone_A01", elisa: "2.5" },
      { clone_id: "clone_B02", elisa: "0.1" },
    ],
  };
  const mapping = {
    wellColumn: "clone_id",
    propertyColumns: ["elisa"],
    types: { elisa: "Double" as const },
    identityIsName: true,
    plateInKey: false,
  };

  test("keys on the id alone: no plate, no well normalisation", () => {
    const [p] = buildProperties(sheet, mapping);
    // Matches the software's property_key with no real plate: the id as it stands.
    expect(p?.values[cloneKey("", "clone_A01", true, false)]).toBe("2.5");
    expect(p?.values["clone_A01"]).toBe("2.5");
    // The id is not read as a well, so A01 is never collapsed to A1.
    expect(p?.values["clone_B02"]).toBe("0.1");
  });
});

describe("the Files-table preview key matches buildProperties", () => {
  // The preview keys each file by its parsed plate/well and the pattern flags;
  // buildProperties keys the sheet the same way. If the two drift, the preview
  // shows blanks. Both go through cloneKey, so this pins that contract.
  test("plate/well set: the file's plate+well finds the sheet value", () => {
    const sheet: Sheet = {
      columns: ["plate", "well", "e"],
      rows: [{ plate: "P1", well: "A1", e: "9" }],
    };
    const [p] = buildProperties(sheet, {
      plateColumn: "plate",
      wellColumn: "well",
      propertyColumns: ["e"],
      types: { e: "Double" },
      plateInKey: true,
    });
    expect(p?.values[cloneKey("P1", "A1", false, true)]).toBe("9");
  });

  test("name set: the record id alone finds the sheet value", () => {
    const sheet: Sheet = { columns: ["clone_id", "e"], rows: [{ clone_id: "X1", e: "9" }] };
    const [p] = buildProperties(sheet, {
      wellColumn: "clone_id",
      propertyColumns: ["e"],
      types: { e: "Double" },
      identityIsName: true,
      plateInKey: false,
    });
    expect(p?.values[cloneKey("", "X1", true, false)]).toBe("9");
  });
});

describe("guessIdentityColumn", () => {
  test("a header naming an id is taken", () => {
    const sheet: Sheet = { columns: ["clone_id", "elisa"], rows: [] };
    expect(guessIdentityColumn(sheet)).toBe("clone_id");
  });

  test("otherwise the first column is the starting point", () => {
    const sheet: Sheet = { columns: ["label", "elisa"], rows: [] };
    expect(guessIdentityColumn(sheet)).toBe("label");
  });

  test("an id substring like avidity is not mistaken for the id column", () => {
    const sheet: Sheet = { columns: ["avidity", "clone_id"], rows: [] };
    expect(guessIdentityColumn(sheet)).toBe("clone_id");
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
    plateInKey: true,
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

  test("with no real plate the same well on another plate collides", () => {
    const s: Sheet = {
      columns: ["plate", "well"],
      rows: [
        { plate: "Plate1", well: "A1" },
        { plate: "Plate2", well: "A1" },
      ],
    };
    expect(duplicateKeyCount(s, { ...mapping, plateColumn: undefined, plateInKey: false })).toBe(1);
  });
});
