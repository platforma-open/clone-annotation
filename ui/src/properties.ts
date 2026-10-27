import type { Property, PropertyType } from "@platforma-open/milaboratories.clone-annotation.model";
import { normalizeWell } from "./sheet";
import type { Sheet } from "./sheet";

/** Keyed on plate and well together: the same well number recurs on every plate. */
export function cloneKey(plate: string, well: string): string {
  return `${plate}\u0000${normalizeWell(well)}`;
}

/**
 * What a column looks like, offered as a default the scientist can correct.
 * A guess that cannot be overridden would be the thing R23 forbids; a guess
 * shown as a starting point is not.
 */
export function guessType(values: string[]): PropertyType {
  const seen = values.filter((v) => v !== "");
  if (seen.length === 0) return "String";
  if (seen.every((v) => /^-?\d+$/.test(v))) return "Long";
  if (seen.every((v) => /^-?\d*\.?\d+(e-?\d+)?$/i.test(v))) return "Double";
  return "String";
}

const WELL_HEADER = /well|position/i;
const PLATE_HEADER = /plate/i;
/** A1 through P24 covers 96 and 384 well plates, padded or not. */
const WELL_VALUE = /^[A-Pa-p]0?\d{1,2}$/;

function firstHeaderMatching(sheet: Sheet, re: RegExp): string | undefined {
  return sheet.columns.find((c) => re.test(c));
}

/**
 * Which column holds the well. The header is tried first, then the values, so a
 * sheet whose column is called something else is still placed.
 */
export function guessWellColumn(sheet: Sheet): string | undefined {
  const byHeader = firstHeaderMatching(sheet, WELL_HEADER);
  if (byHeader) return byHeader;
  return sheet.columns.find((c) => {
    const seen = sheet.rows.map((r) => r[c]).filter((v) => v !== undefined && v !== "");
    if (seen.length < 2) return false;
    return seen.filter((v) => WELL_VALUE.test(v!)).length / seen.length >= 0.8;
  });
}

/**
 * Which column holds the plate. Only the header is tried: a plate name looks
 * like any other label, so guessing from values would be a coin toss.
 */
export function guessPlateColumn(sheet: Sheet, wellColumn?: string): string | undefined {
  const found = firstHeaderMatching(sheet, PLATE_HEADER);
  return found === wellColumn ? undefined : found;
}

/** Rows that land on a well another row already claimed. The last one wins. */
export function duplicateKeyCount(sheet: Sheet, mapping: Mapping): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of sheet.rows) {
    const well = row[mapping.wellColumn];
    if (well === undefined) continue;
    const key = cloneKey(mapping.plateColumn ? (row[mapping.plateColumn] ?? "") : "", well);
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return duplicates;
}

export type Mapping = {
  plateColumn?: string;
  wellColumn: string;
  propertyColumns: string[];
  types: Record<string, PropertyType>;
};

/** Turns the sheet and the scientist's mapping into what travels to the workflow. */
export function buildProperties(sheet: Sheet, mapping: Mapping): Property[] {
  return mapping.propertyColumns.map((name) => {
    const values: Record<string, string> = {};
    for (const row of sheet.rows) {
      const well = row[mapping.wellColumn];
      if (well === undefined) continue;
      const v = row[name];
      // An absent value stays absent. Substituting one here would make a clone
      // that was never measured indistinguishable from one measured as zero.
      if (v === undefined) continue;
      values[cloneKey(mapping.plateColumn ? (row[mapping.plateColumn] ?? "") : "", well)] = v;
    }
    return { name, type: mapping.types[name] ?? "String", values };
  });
}

/** Sheet rows that name no well, so nothing can place them. */
export function rowsWithoutWell(sheet: Sheet, mapping: Mapping): number {
  return sheet.rows.filter((r) => r[mapping.wellColumn] === undefined).length;
}
