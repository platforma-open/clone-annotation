import type { Property, PropertyType } from "@platforma-open/milaboratories.clone-annotation.model";
import { propertyKey } from "@platforma-open/milaboratories.clone-annotation.model";
import type { Sheet } from "./sheet";

// The join key has one definition, in the model. Every caller passes both flags:
// no defaults, so a caller that forgets one is a compile error, not a silently
// wrong key.
export const cloneKey = propertyKey;

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
// `id` only as a whole token (id, clone_id, sample_id), not a substring of
// avidity, candidate, midpoint; `name` and `seq` anywhere.
const IDENTITY_HEADER = /name|seq|(?:^|_)id(?:$|_)/i;
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

/**
 * Which column holds the record id, for a name-keyed set. A header naming an id
 * is tried first, then the first column as a fallback. A guess the scientist
 * corrects, never a decision (R23).
 */
export function guessIdentityColumn(sheet: Sheet): string | undefined {
  return firstHeaderMatching(sheet, IDENTITY_HEADER) ?? sheet.columns[0];
}

/** Rows that land on an id another row already claimed. The last one wins. */
export function duplicateKeyCount(sheet: Sheet, mapping: Mapping): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of sheet.rows) {
    const well = row[mapping.wellColumn];
    if (well === undefined) continue;
    const key = cloneKey(
      mapping.plateColumn ? (row[mapping.plateColumn] ?? "") : "",
      well,
      mapping.identityIsName ?? false,
      mapping.plateInKey ?? false,
    );
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return duplicates;
}

export type Mapping = {
  plateColumn?: string;
  /** The column that identifies the clone: a well, or a record id for a name set. */
  wellColumn: string;
  propertyColumns: string[];
  types: Record<string, PropertyType>;
  /** The set is keyed on a record id, not a well, so the id is not normalised. */
  identityIsName?: boolean;
  /** The files carry a real plate, so the plate is part of the join key. */
  plateInKey?: boolean;
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
      values[
        cloneKey(
          mapping.plateColumn ? (row[mapping.plateColumn] ?? "") : "",
          well,
          mapping.identityIsName ?? false,
          mapping.plateInKey ?? false,
        )
      ] = v;
    }
    return { name, type: mapping.types[name] ?? "String", values };
  });
}

/** Sheet rows that name no well, so nothing can place them. */
export function rowsWithoutWell(sheet: Sheet, mapping: Mapping): number {
  return sheet.rows.filter((r) => r[mapping.wellColumn] === undefined).length;
}
