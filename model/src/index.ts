import type {
  ImportFileHandle,
  InferOutputsType,
  PlDataTableModel,
  PlDataTableStateV2,
} from "@platforma-sdk/model";
import {
  AccessorColumnsProvider,
  BlockModelV3,
  createPlDataTableStateV2,
  createPlDataTableV3,
  DataModelBuilder,
  getFilePathFromHandle,
} from "@platforma-sdk/model";

// The UI depends on this package, not on the SDK directly, so what it needs from
// the SDK travels through here.
export type { ImportFileHandle };
export { getFilePathFromHandle };
export * from "./path_pattern";
export type { Property, PropertyType } from "@platforma-open/milaboratories.clone-annotation.kind";
import { PathPattern } from "./path_pattern";

/** One well of one plate, with how many files back each chain. */
export type Clone = {
  plate: string;
  well: string;
  chains: Record<string, number>;
  fileCount: number;
  /** Values the sheet carried for this well, under the names it used. Absent until a sheet reaches it. */
  properties?: Record<string, string>;
};
import type { BlockParams, Property } from "@platforma-open/milaboratories.clone-annotation.kind";
import { kind } from "@platforma-open/milaboratories.clone-annotation.kind";

export const DEFAULT_NAME = "My Dataset";

/**
 * Phred 20 is the conventional Sanger floor — one wrong base in a hundred — so a
 * scientist who would not know what to put here never has to put anything.
 */
export const DEFAULT_QUALITY_THRESHOLD = 20;

export const NUMBERING_SCHEME_OPTIONS = [
  { label: "IMGT", value: "imgt" },
  { label: "Kabat", value: "kabat" },
  { label: "Chothia", value: "chothia" },
] as const;

export const PAIRING_MODE_OPTIONS = [
  { label: "Same plate and well", value: "plateWell" },
  { label: "Shared file-name stem", value: "name" },
] as const;

export const SPECIES_OPTIONS = [
  { label: "Human", value: "hsa" },
  { label: "Mouse", value: "mmu" },
  { label: "Rat", value: "rat" },
  { label: "Rabbit", value: "rabbit" },
  { label: "Rhesus macaque", value: "rhesus" },
  { label: "Alpaca", value: "alpaca" },
] as const;

/** What Tracy made of one trace file. */
export type TraceRead = {
  /** The path the pattern matched against, which is what the files table shows. */
  path: string;
  /** Bases Tracy called, before the quality floor. */
  length: number;
  /** The longest stretch at or above the floor. What carries on downstream. */
  usableLength: number;
  /** Mean Phred over that stretch. */
  meanQuality: number;
  kept: boolean;
};

/** A trace that produced nothing usable, and why. */
export type SetAsideTrace = { path: string; reason: string };

/** Where a molecule's sequence came from. `none` means no read survived. */
export type MoleculeSource = "merged" | "forward" | "reverse" | "none";

/** One plate, well and chain, as one sequence. */
export type Molecule = {
  id: string;
  plate: string;
  well: string;
  chain: string;
  source: MoleculeSource;
  /** The files behind it, by the path the table shows. */
  reads: string[];
  /** Reads of an end another read already held. They are counted, never used. */
  extraReads: number;
  length?: number;
  meanQuality?: number;
  /**
   * Which scale `meanQuality` is on. Tracy recomputes a consensus on its own,
   * topping out near Q26, while a single read carries the instrument's, which
   * reaches Q60. The two do not compare, so the scale travels with the number.
   */
  qualityScale?: "consensus" | "read";
  /** Positions where the two reads disagreed. Only a merged molecule has one. */
  mismatches?: number | null;
  /** Why the molecule is not merged. */
  reason?: string;
};

/** The whole numbered domain and the seven regions, in order along it. */
export const FEATURES = ["VDJRegion", "FR1", "CDR1", "FR2", "CDR2", "FR3", "CDR3", "FR4"] as const;
export type Feature = (typeof FEATURES)[number];

/** What the two annotators made of one clone. */
export type Annotation = {
  id: string;
  plate: string;
  well: string;
  /** The chain the file name asserted. */
  declaredChain: string;
  /** Which of the six reading frames turned out to be the variable domain. */
  frame?: number;
  /** What holds this clone's two chains together. */
  pairKey?: string;
  pairStatus?: "Paired" | "Single domain" | "Unpaired" | "Ambiguous";
  /** The other chain of the same clone, by its key. */
  pairedWith?: string;
  /** The name says one chain and the sequence reads as another. */
  chainMismatch?: boolean;
  /** The chain class ANARCI recognised, from the sequence rather than the label. */
  observedChain?: string;
  /** Amino acids per feature, under the scheme the scientist chose. */
  aa?: Record<Feature, string>;
  /**
   * The same stretches as nucleotide. Derived from the codons behind the very
   * residues ANARCI numbered, so the two alphabets always describe the same
   * span.
   */
  nt?: Record<Feature, string>;
  status: "Annotated" | "Failed";
  vGene?: string;
  dGene?: string;
  jGene?: string;
  /** The chain MiXCR called. Absent where no germline library covers the material. */
  mixcrChains?: string;
  vAlignment?: string;
};

export type AnnotationReport = {
  scheme: string;
  annotations: Annotation[];
  /** Clones ANARCI could not number. They are not failed clones, only undescribed. */
  notNumbered: string[];
  /** Clones no germline reference reached. Everything else about them stands. */
  notAligned: string[];
  /** Clones whose chains could not be held together, rather than paired by guess. */
  unpaired: string[];
  /** Clones whose file name asserts one chain and whose sequence reads as another. */
  chainMismatch: string[];
  /** What the collapse did, stated rather than left to be counted off the table. */
  collapse?: { moleculesIn?: number; variantsOut?: number };
};

export type TraceReport = {
  reads: TraceRead[];
  setAside: SetAsideTrace[];
  molecules: Molecule[];
};

/**
 * How a sheet's columns are read. Stated by the scientist rather than guessed
 * from the headers, on the same terms as the name pattern.
 */
export type PropertyMapping = {
  /** Column holding the plate, where the sheet covers more than one. */
  plateColumn?: string;
  /** Column holding the well. */
  wellColumn: string;
  /** Columns to carry as properties, each keeping the name it arrived under. */
  propertyColumns: string[];
};

export type BlockData = BlockParams & {
  /** What the scientist calls this set. */
  name: string;
  /** Every trace the scientist selected, before the name pattern is applied. */
  traceFiles: ImportFileHandle[];
  /** Set once the picker has been offered, so it is not reopened on every visit. */
  suggestedImport?: boolean;
  /** A sheet of measurements, one row per well. Parsed in the UI, as samples-and-data does. */
  propertyFile?: ImportFileHandle;
  /** Which of the sheet's columns identify the clone, and which are properties. */
  propertyMapping?: PropertyMapping;
  /** The mapped result. What travels to the workflow, not the file. */
  properties: Property[];
  /** Which columns the clone table shows, how it is sorted and filtered. */
  tableState: PlDataTableStateV2;
  /** The same, for the molecule table. */
  moleculeTableState: PlDataTableStateV2;
  /** The same, for the variant table. */
  variantTableState: PlDataTableStateV2;
};

function splitSegments(path: string): string[] {
  return path.split(/[\\/]/).filter((s) => s !== "");
}

/** The last `segments` segments of a path, which is what the pattern matches. */
export function pathTail(path: string, segments: number): string {
  const seg = splitSegments(path);
  return seg.slice(Math.max(0, seg.length - segments)).join("/");
}

function tracesWithPaths(data: BlockData) {
  let segments = 1;
  try {
    if (data.namePattern) segments = PathPattern.parse(data.namePattern).segmentCount;
  } catch {
    segments = 1;
  }
  return (data.traceFiles ?? []).map((handle) => ({
    handle,
    path: pathTail(getFilePathFromHandle(handle), segments),
  }));
}

function compileSpec(pattern: string | undefined) {
  if (!pattern || pattern.trim() === "") return undefined;
  try {
    return PathPattern.parse(pattern).compiled;
  } catch {
    return undefined;
  }
}

/** The field exists only once the block has run on a set that holds files. */
const TRACE_REPORT = { field: "traceReport", allowPermanentAbsence: true } as const;
const ANNOTATION = { field: "annotation", allowPermanentAbsence: true } as const;

const dataModel = new DataModelBuilder({ kind }).from<BlockData>("v1").init(({ params }) => ({
  name: DEFAULT_NAME,
  traceFiles: [],
  properties: [],
  tableState: createPlDataTableStateV2(),
  moleculeTableState: createPlDataTableStateV2(),
  variantTableState: createPlDataTableStateV2(),
  qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
  numberingScheme: "imgt",
  species: "hsa",
  pairingMode: "plateWell",
  ...(params ?? {}),
}));

export const platforma = BlockModelV3.create({ dataModel, kind })
  // Each trace arrives with the path the pattern is matched against, computed
  // here so the path rule exists once rather than in both TypeScript and Tengo.
  .prerunArgs((data) => ({ propertyFile: data.propertyFile }))

  .args((data) => ({
    name: data.name,
    traces: tracesWithPaths(data),
    properties: data.properties,
    namePattern: data.namePattern,
    patternSpec: compileSpec(data.namePattern),
    qualityThreshold: data.qualityThreshold,
    numberingScheme: data.numberingScheme,
    pairingMode: data.pairingMode,
    species: data.species,
  }))

  // Reads from the main run, not prerun, so nothing uploads until the block is
  // run. getImportProgress() is the side effect that starts each transfer, and
  // `isActive` makes the lambda run with nothing subscribed to it.
  .output(
    "traceImports",
    (ctx) =>
      Object.fromEntries(
        ctx.outputs
          ?.resolve({ field: "fileImports", assertFieldType: "Input" })
          ?.mapFields((handle, acc) => [handle as ImportFileHandle, acc.getImportProgress()], {
            skipUnresolved: true,
          }) ?? [],
      ),
    { isActive: true },
  )

  // Drives the sheet's upload and lets the UI read its bytes to offer the columns.
  // The field exists only once a sheet has been picked, so its absence is normal.
  .output(
    "propertyFileImports",
    (ctx) =>
      Object.fromEntries(
        ctx.prerun
          ?.resolve({
            field: "propertyFileImports",
            assertFieldType: "Input",
            allowPermanentAbsence: true,
          })
          ?.mapFields((handle, acc) => [handle as ImportFileHandle, acc.getImportProgress()], {
            skipUnresolved: true,
          }) ?? [],
      ),
    { isActive: true },
  )

  .output("propertyFileContent", (ctx) =>
    ctx.prerun
      ?.resolve({ field: "propertyFile", assertFieldType: "Input", allowPermanentAbsence: true })
      ?.getFileHandle(),
  )

  .output("isRunning", (ctx) => ctx.outputs?.getIsReadyOrError() === false)

  /** One row per clone, produced by the run. Undefined until the block has run. */
  .output("clones", (ctx) => ctx.outputs?.resolve("clones")?.getDataAsJson<Clone[]>())

  /** Paths the pattern did not place. A file nobody can place is a result, not an absence. */
  .output("unmatched", (ctx) => ctx.outputs?.resolve("unmatched")?.getDataAsJson<string[]>())

  /** Clones no property reached. An absent reading and a poor one are different results. */
  .output("clonesWithoutProperties", (ctx) =>
    ctx.outputs?.resolve("clonesWithoutProperties")?.getDataAsJson<string[]>(),
  )

  /** Sheet rows that landed on no trace. */
  .output("valuesWithoutClone", (ctx) =>
    ctx.outputs?.resolve("valuesWithoutClone")?.getDataAsJson<string[]>(),
  )

  /**
   * What Tracy read, per file. The field exists only once the block has run on a
   * set that holds files, so its absence is normal rather than an error.
   */
  .output("traceReport", (ctx) =>
    ctx.outputs?.resolve(TRACE_REPORT)?.getDataAsJsonOrUndefined<TraceReport>(),
  )

  /**
   * The clone table as p-columns. The page renders it with the platform's own
   * table, which brings filtering, sorting and the column chooser with it.
   */
  .outputWithStatus("clonesTable", (ctx): PlDataTableModel | undefined => {
    const acc = ctx.outputs?.resolve({ field: "clonesTable", allowPermanentAbsence: true });
    if (acc === undefined) return undefined;
    const provider = AccessorColumnsProvider(acc);
    // Every column we emit is keyed on the clone axis, so any of them anchors
    // the table. `well` is the one that is never empty.
    const anchor = provider
      .getColumns()
      .find((c) => c.getSpec().name === "pl7.app/vdj/clone/well")
      ?.getSpec();
    if (anchor === undefined) return undefined;
    return createPlDataTableV3(ctx, {
      // maxHops 0: the frame is self-contained, so no linker chains to follow.
      columns: { sources: [provider], anchors: { main: anchor }, selector: { maxHops: 0 } },
      tableState: ctx.data.tableState,
    });
  })

  /** One row per molecule: a clone's two chains side by side. */
  .outputWithStatus("moleculesTable", (ctx): PlDataTableModel | undefined => {
    const acc = ctx.outputs?.resolve({ field: "moleculesTable", allowPermanentAbsence: true });
    if (acc === undefined) return undefined;
    const provider = AccessorColumnsProvider(acc);
    const anchor = provider
      .getColumns()
      .find((c) => c.getSpec().name === "pl7.app/vdj/molecule/well")
      ?.getSpec();
    if (anchor === undefined) return undefined;
    return createPlDataTableV3(ctx, {
      columns: { sources: [provider], anchors: { main: anchor }, selector: { maxHops: 0 } },
      tableState: ctx.data.moleculeTableState,
    });
  })

  /** One row per distinct molecule, with every well it was seen in. */
  .outputWithStatus("variantsTable", (ctx): PlDataTableModel | undefined => {
    const acc = ctx.outputs?.resolve({ field: "variantsTable", allowPermanentAbsence: true });
    if (acc === undefined) return undefined;
    const provider = AccessorColumnsProvider(acc);
    const anchor = provider
      .getColumns()
      .find((c) => c.getSpec().name === "pl7.app/vdj/variant/wellCount")
      ?.getSpec();
    if (anchor === undefined) return undefined;
    return createPlDataTableV3(ctx, {
      columns: { sources: [provider], anchors: { main: anchor }, selector: { maxHops: 0 } },
      tableState: ctx.data.variantTableState,
    });
  })

  /** Regions from ANARCI and germline from MiXCR, joined onto each clone. */
  .output("annotation", (ctx) =>
    ctx.outputs?.resolve(ANNOTATION)?.getDataAsJsonOrUndefined<AnnotationReport>(),
  )

  // A project exported as a template and re-applied comes back with the settings
  // it went out with. Deliberately without `traceFiles`: handles belong to the
  // machine that uploaded them.
  .templateParams((data) => ({
    namePattern: data.namePattern,
    qualityThreshold: data.qualityThreshold,
    numberingScheme: data.numberingScheme,
    pairingMode: data.pairingMode,
    species: data.species,
  }))

  .title(() => "Clone Annotation")

  .subtitle((ctx) => {
    const n = ctx.data.traceFiles.length;
    if (n === 0) return "No traces";
    return n === 1 ? "1 trace" : `${n} traces`;
  })

  // The clones list only exists once the block has run, so its section appears then.
  .sections((ctx) => [
    { type: "link" as const, href: "/" as const, label: "Files" },
    // Always offered, so a block that has not run yet shows the table empty
    // rather than hiding where the results will appear.
    { type: "link" as const, href: "/clones" as const, label: "Clones" },
    { type: "link" as const, href: "/molecules" as const, label: "Molecules" },
    { type: "link" as const, href: "/variants" as const, label: "Variants" },
    // Unplaced stays conditional: it is an exception list, and an empty one
    // would read as a problem on a set where every file was placed.
    ...((ctx.outputs?.resolve("unmatched")?.getDataAsJson<string[]>()?.length ?? 0) > 0
      ? [{ type: "link" as const, href: "/unmatched" as const, label: "Unplaced" }]
      : []),
  ])
  .done();

export type BlockOutputs = InferOutputsType<typeof platforma>;
