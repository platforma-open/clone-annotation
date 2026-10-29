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

/** Where a sequence's bases came from. `none` means no read survived. */
export type SequenceSource = "merged" | "forward" | "reverse" | "none";

/** One plate, well and chain, as one sequence. */
export type Sequence = {
  id: string;
  plate: string;
  well: string;
  chain: string;
  source: SequenceSource;
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
  /** Positions where the two reads disagreed. Only a merged sequence has one. */
  mismatches?: number | null;
  /** Why the sequence is not merged. */
  reason?: string;
};

/** The whole numbered domain and the seven regions, in order along it. */
export const FEATURES = ["VDJRegion", "FR1", "CDR1", "FR2", "CDR2", "FR3", "CDR3", "FR4"] as const;
export type Feature = (typeof FEATURES)[number];

/** What the two annotators made of one sequence. */
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
  pairStatus?: "Paired" | "Single domain" | "Unpaired" | "Ambiguous" | "No sequence";
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
  /** Sequences ANARCI could not number. They are not failed, only undescribed. */
  notNumbered: string[];
  /** Sequences no germline reference reached. Everything else about them stands. */
  notAligned: string[];
  /** Sequences held to no partner, rather than paired by guess. */
  unpaired: string[];
  /** Sequences whose file name asserts one chain and whose bases read as another. */
  chainMismatch: string[];
  /** What the collapse did, stated rather than left to be counted off the table. */
  collapse?: { clonesIn?: number; variantsOut?: number };
};

export type TraceReport = {
  reads: TraceRead[];
  setAside: SetAsideTrace[];
  sequences: Sequence[];
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

/** The three tables the Results page holds, one per tab. */
export type ResultsTab = "sequences" | "clones" | "variants";

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
  /** Which columns the sequence table shows, how it is sorted and filtered. */
  sequenceTableState: PlDataTableStateV2;
  /** The same, for the clone table. */
  cloneTableState: PlDataTableStateV2;
  /** The same, for the variant table. */
  variantTableState: PlDataTableStateV2;
  /** Which of the three result tables is open. */
  resultsTab?: ResultsTab;
  /** Which plate the QC map draws. Falls back to the first where the plate is gone. */
  qcPlate?: string;
};

function splitSegments(path: string): string[] {
  return path.split(/[\\/]/).filter((s) => s !== "");
}

/** The last `segments` segments of a path, which is what the pattern matches. */
export function pathTail(path: string, segments: number): string {
  const seg = splitSegments(path);
  return seg.slice(Math.max(0, seg.length - segments)).join("/");
}

function parsePattern(pattern: string | undefined): PathPattern | undefined {
  if (!pattern || pattern.trim() === "") return undefined;
  try {
    return PathPattern.parse(pattern);
  } catch {
    return undefined;
  }
}

/**
 * Each trace with the fields its path gave, or no fields if the pattern missed it.
 * The pattern is matched here and only here: defaults and the agreement between
 * two copies of a field are not something a regex says, and the workflow's regexp
 * panics on a group an absent `[ ]` section left out.
 */
function tracesWithFields(data: BlockData, pattern: PathPattern | undefined) {
  const segments = pattern?.segmentCount ?? 1;
  return (data.traceFiles ?? []).map((handle) => {
    const path = pathTail(getFilePathFromHandle(handle), segments);
    const m = pattern?.match(path);
    const fields = m && {
      plate: m.plate?.value ?? "",
      well: m.well.value,
      chain: m.chain?.value ?? "",
      direction: m.direction?.value ?? "",
    };
    return { handle, path, fields };
  });
}

function declaredFields(pattern: PathPattern | undefined) {
  return (
    pattern && {
      plate: pattern.hasPlate,
      chain: pattern.hasChain,
      direction: pattern.hasDirection,
    }
  );
}

/** The field exists only once the block has run on a set that holds files. */
const TRACE_REPORT = { field: "traceReport", allowPermanentAbsence: true } as const;
const ANNOTATION = { field: "annotation", allowPermanentAbsence: true } as const;

const dataModel = new DataModelBuilder({ kind }).from<BlockData>("v1").init(({ params }) => ({
  name: DEFAULT_NAME,
  traceFiles: [],
  properties: [],
  sequenceTableState: createPlDataTableStateV2(),
  cloneTableState: createPlDataTableStateV2(),
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

  .args((data) => {
    const pattern = parsePattern(data.namePattern);
    return {
      name: data.name,
      traces: tracesWithFields(data, pattern),
      properties: data.properties,
      namePattern: data.namePattern,
      declaredFields: declaredFields(pattern),
      qualityThreshold: data.qualityThreshold,
      numberingScheme: data.numberingScheme,
      pairingMode: data.pairingMode,
      species: data.species,
    };
  })

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
   * The sequence table as p-columns. The page renders it with the platform's own
   * table, which brings filtering, sorting and the column chooser with it.
   */
  .outputWithStatus("sequencesTable", (ctx): PlDataTableModel | undefined => {
    const acc = ctx.outputs?.resolve({ field: "sequencesTable", allowPermanentAbsence: true });
    if (acc === undefined) return undefined;
    const provider = AccessorColumnsProvider(acc);
    // Every column we emit is keyed on the sequence axis, so any of them anchors
    // the table. `well` is the one that is never empty.
    const anchor = provider
      .getColumns()
      .find((c) => c.getSpec().name === "pl7.app/vdj/sequence/well")
      ?.getSpec();
    if (anchor === undefined) return undefined;
    return createPlDataTableV3(ctx, {
      // maxHops 0: the frame is self-contained, so no linker chains to follow.
      columns: { sources: [provider], anchors: { main: anchor }, selector: { maxHops: 0 } },
      tableState: ctx.data.sequenceTableState,
    });
  })

  /** One row per clone: its two chains side by side. */
  .outputWithStatus("clonesTable", (ctx): PlDataTableModel | undefined => {
    const acc = ctx.outputs?.resolve({ field: "clonesTable", allowPermanentAbsence: true });
    if (acc === undefined) return undefined;
    const provider = AccessorColumnsProvider(acc);
    const anchor = provider
      .getColumns()
      .find((c) => c.getSpec().name === "pl7.app/vdj/clone/well")
      ?.getSpec();
    if (anchor === undefined) return undefined;
    return createPlDataTableV3(ctx, {
      columns: { sources: [provider], anchors: { main: anchor }, selector: { maxHops: 0 } },
      tableState: ctx.data.cloneTableState,
    });
  })

  /** One row per distinct clone, with every well it was seen in. */
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

  /** Regions from ANARCI and germline from MiXCR, joined onto each sequence. */
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

  // Always offered, so a block that has not run yet shows where the results
  // will appear rather than hiding it.
  .sections(() => [
    { type: "link" as const, href: "/" as const, label: "Files" },
    { type: "link" as const, href: "/results" as const, label: "Results" },
    { type: "link" as const, href: "/qc" as const, label: "QC" },
  ])
  .done();

export type BlockOutputs = InferOutputsType<typeof platforma>;
