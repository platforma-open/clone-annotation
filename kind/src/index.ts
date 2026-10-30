import { assertParamsObject, defineBlockKind } from "@platforma-sdk/block-kind";
import { name, version } from "../package.json" with { type: "json" };

/** How a property's values are read. A number, a label and a date do not summarise alike. */
export type PropertyType = "Long" | "Double" | "String";

/** One column carried from the sheet, with the values it held per clone. */
export type Property = {
  /** The column name as it arrived. */
  name: string;
  type: PropertyType;
  /** Values by clone key, `plate\u0000well`. A clone with no value is simply absent. */
  values: Record<string, string>;
};

/** Region numbering conventions ANARCI implements. */
export type NumberingScheme = "imgt" | "kabat" | "chothia";

/** What says two files are the two chains of one clone. */
export type PairingMode = "plateWell" | "name";

/**
 * Species MiXCR can align against out of its bundled reference library. Spelled
 * the way MiXCR takes them, so nothing has to translate the value on the way.
 *
 * The library does not cover every locus for every species: `alpaca` and
 * `spalax` hold heavy chains only, and `gallus` has lambda but no kappa.
 */
export type Species =
  | "alpaca"
  | "salmon"
  | "spalax"
  | "gallus"
  | "mfas"
  | "dog"
  | "hsa"
  | "lama"
  | "mmu"
  | "pig"
  | "rabbit"
  | "rat"
  | "mmul"
  | "sheep";

/**
 * This block's init-params contract. Everything is optional so a block created by
 * hand starts empty; the fields exist for a project template to carry a lab's own
 * conventions.
 */
export type BlockParams = {
  /** How a path divides into plate, well and chain, e.g. `{{Plate}}/{{Well}}_{{Chain}}.ab1`. */
  namePattern?: string;

  /** Per-position Phred floor. Below it a sequence is set aside with a reason, not dropped. */
  qualityThreshold?: number;

  /** Region numbering convention; travels with the result as `pl7.app/vdj/numberingSchema`. */
  numberingScheme?: NumberingScheme;

  /** What pairs a clone's chains. Single-domain material needs none of these. */
  pairingMode?: PairingMode;

  /**
   * Which germline library to align against. Regions, chain and translation do
   * not depend on it, so material no library covers still annotates.
   */
  species?: Species;
};

const NUMBERING_SCHEMES: NumberingScheme[] = ["imgt", "kabat", "chothia"];
const PAIRING_MODES: PairingMode[] = ["plateWell", "name"];
const SPECIES: Species[] = [
  "alpaca",
  "salmon",
  "spalax",
  "gallus",
  "mfas",
  "dog",
  "hsa",
  "lama",
  "mmu",
  "pig",
  "rabbit",
  "rat",
  "mmul",
  "sheep",
];

function asString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function asOneOf<T extends string>(value: unknown, allowed: T[], field: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

/** A key the contract does not name is dropped by not being read. */
function parseInitializationParams(value: unknown): BlockParams {
  assertParamsObject(value);

  const { namePattern, qualityThreshold, numberingScheme, pairingMode, species } = value;

  if (qualityThreshold !== undefined) {
    if (typeof qualityThreshold !== "number" || !Number.isFinite(qualityThreshold))
      throw new Error("qualityThreshold must be a number");
    if (qualityThreshold < 0) throw new Error("qualityThreshold must not be negative");
  }

  return {
    namePattern: asString(namePattern, "namePattern"),
    qualityThreshold: qualityThreshold as number | undefined,
    numberingScheme: asOneOf(numberingScheme, NUMBERING_SCHEMES, "numberingScheme"),
    pairingMode: asOneOf(pairingMode, PAIRING_MODES, "pairingMode"),
    species: asOneOf(species, SPECIES, "species"),
  };
}

// Identity (`name`/`version`) comes from this package's own `package.json`, so
// the on-wire `{name}@{version}` reference can never drift from what npm
// publishes; the bundler inlines the JSON import.
export const kind = defineBlockKind<BlockParams>({
  name,
  version,
  parseInitializationParams,
});
