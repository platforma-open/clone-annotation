import * as XLSX from "xlsx";

export type Sheet = {
  columns: string[];
  rows: Record<string, string>[];
};

/**
 * Reads a long-format sheet: one row per well, one column per field.
 *
 * Values come back as strings. What a column means — a number, a label, a date —
 * is the scientist's to say, and guessing here would make the type depend on
 * which rows happened to parse.
 */
export function readSheet(bytes: ArrayBuffer | Uint8Array, fileName?: string): Sheet {
  const wb = XLSX.read(
    bytes,
    fileName?.endsWith(".csv") ? { type: "array", raw: true } : { type: "array" },
  );
  const first = wb.SheetNames[0];
  if (!first) return { columns: [], rows: [] };

  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first]!, {
    header: 1,
    blankrows: false,
  });
  const header = (grid[0] ?? []).map((c) => String(c ?? "").trim());
  const columns = header.filter((c) => c !== "");

  const rows: Record<string, string>[] = [];
  for (const line of grid.slice(1)) {
    const row: Record<string, string> = {};
    let any = false;
    header.forEach((name, i) => {
      if (name === "") return;
      const v = line[i];
      // An empty cell stays absent rather than becoming "": a property with no
      // value must stay distinguishable from one measured as blank.
      if (v === undefined || v === null || String(v).trim() === "") return;
      row[name] = String(v).trim();
      any = true;
    });
    if (any) rows.push(row);
  }
  return { columns, rows };
}

/** A well as the sheet writes it, normalised so A1 and A01 are one well. */
export function normalizeWell(well: string): string {
  const m = well.trim().match(/^([A-Za-z]+)0*(\d+)$/);
  return m ? `${m[1]!.toUpperCase()}${m[2]}` : well.trim();
}
