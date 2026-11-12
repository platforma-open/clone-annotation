import type { GraphMakerState } from "@milaboratories/graph-maker";
import { sequenceViewerPlugin } from "@milaboratories/sequence-viewer/plugin";
import type {
  AxisId,
  ImportFileHandle,
  InferOutputsType,
  PColumnIdAndSpec,
  PFrameHandle,
  PlDataTableModel,
  PlDataTableStateV2,
  PlSelectionModel,
  PTableKey,
  TreeNodeAccessor,
} from "@platforma-sdk/model";
import {
  AccessorColumnsProvider,
  BlockModelV3,
  createPlDataTableStateV2,
  createPlDataTableV3,
  createPlSelectionModel,
  DataModelBuilder,
  getFilePathFromHandle,
} from "@platforma-sdk/model";

// The UI depends on this package, not on the SDK directly, so what it needs from
// the SDK travels through here.
export type { AxisId, ImportFileHandle, PlSelectionModel, PTableKey };
export { createPlSelectionModel, getFilePathFromHandle };
export * from "./path_pattern";
export type { Property, PropertyType } from "@platforma-open/milaboratories.clone-annotation.kind";
import { normalizeWell, PathPattern, readEnd } from "./path_pattern";

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

export const EXPORT_WELLS_OPTIONS = [
  { label: "Passed wells only", value: "passed" },
  { label: "Passed and Warning", value: "passedAndWarning" },
  { label: "All wells", value: "all" },
] as const;

export const SPECIES_OPTIONS = [
  { label: "Alpaca (Vicugna pacos)", value: "alpaca" },
  { label: "Atlantic salmon (Salmo salar)", value: "salmon" },
  { label: "Blind mole rat (Spalax galili)", value: "spalax" },
  { label: "Chicken (Gallus gallus)", value: "gallus" },
  { label: "Cynomolgus macaque (Macaca fascicularis)", value: "mfas" },
  { label: "Dog (Canis lupus familiaris)", value: "dog" },
  { label: "Human (Homo sapiens)", value: "hsa" },
  { label: "Llama (Lama glama)", value: "lama" },
  { label: "Mouse (Mus musculus)", value: "mmu" },
  { label: "Pig (Sus scrofa)", value: "pig" },
  { label: "Rabbit (Oryctolagus cuniculus)", value: "rabbit" },
  { label: "Rat (Rattus norvegicus)", value: "rat" },
  { label: "Rhesus macaque (Macaca mulatta)", value: "mmul" },
  { label: "Sheep (Ovis aries)", value: "sheep" },
] as const;

/** What Tracy made of one trace file. */
export type TraceRead = {
  /** The path the pattern matched against, which is what the files table shows. */
  path: string;
  /** Bases Tracy called, before the quality floor. */
  length: number;
  /** The stretch Mott trimming keeps at the floor. What carries on downstream. */
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
  /** What holds this pair's two chains together. */
  pairKey?: string;
  pairStatus?: "Paired" | "Single domain" | "Unpaired" | "Ambiguous" | "No sequence";
  /** The other chain of the same pair, by its key. */
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
  /** The same genes with their allele, for example IGHV3-23*01. */
  vHit?: string;
  dHit?: string;
  jHit?: string;
  /** The chain MiXCR called. Absent where no germline library covers the material. */
  mixcrChains?: string;
  vAlignment?: string;
  /** The numbered domain reaches FR4. */
  domainComplete?: boolean;
  /** The first region holding a stop codon; empty where there is none. */
  stopRegion?: string;
  /** Empty where the domain stops short and no stop codon says otherwise. */
  productive?: "yes" | "no" | "";
  /** CDR3 positions with a second peak in every read covering it. Absent where nothing was assessed. */
  mixedPositions?: number;
};

export type WellVerdict = "Passed" | "Warning" | "Failed";

/** How one well came out, from its worst chain. */
export type WellQc = {
  plate: string;
  well: string;
  verdict: WellVerdict;
  /** The first of `reasons`; "Passed" for a well with none. */
  reason: string;
  /** Every reason that applies, failures first, in priority order. */
  reasons: string[];
  /** The reasons that make a well fail. */
  failedReasons: string[];
  /** The reasons that give a well a warning. */
  warningReasons: string[];
};

/** The plate table's numbers, for the whole set. */
export type QcTotal = {
  plates: number;
  wells: number;
  passed: number;
  passedShare: number;
  heavyPassed: number;
  lightPassed: number;
  warning: number;
  failed: number;
  usableReadsShare: number;
  mergedShare: number;
  mainProblem: string;
  /** Distinct across plates, so not the sum of the plate rows. */
  uniqueAntibodies: number;
  /** Repeats across the whole set, so not an average of the plate rows. */
  redundantShare: number;
};

export type AnnotationReport = {
  scheme: string;
  annotations: Annotation[];
  /** Sequences ANARCI could not number. They are not failed, only undescribed. */
  notNumbered: string[];
  /** Sequences no germline reference reached. Everything else about them stands. */
  notAligned: string[];
  /** Whether the set holds pairs to make. A single-domain or one-chain set does not. */
  paired?: boolean;
  /** The sides any sequence reads as. The tables carry columns only for these. */
  sides?: ("heavy" | "light")[];
  /** Sequences held to no partner, rather than paired by guess. */
  unpaired: string[];
  /** Sequences whose file name asserts one chain and whose bases read as another. */
  chainMismatch: string[];
  /** What the collapse did, stated rather than left to be counted off the table. */
  collapse?: { pairsIn?: number; clonesOut?: number };
  wells?: WellQc[];
  total?: QcTotal;
  /** Every reason a well can have, in priority order, with what it means. */
  reasonHelp?: ReasonHelp[];
};

export type ReasonHelp = { label: string; verdict: WellVerdict; help: string };

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
export type ResultsTab = "sequences" | "pairs" | "clones";

/** The Plate View page's two views, one per tab. */
export type QcTab = "plateMap" | "metrics";

/** The two read quality charts, one per tab. */
export type ReadsTab = "quality" | "length";

export type BlockData = BlockParams & {
  /** What the scientist calls this set. */
  name: string;
  /** Every trace the scientist selected, before the name pattern is applied. */
  traceFiles: ImportFileHandle[];
  /** Set once the picker has been offered, so it is not reopened on every visit. */
  suggestedImport?: boolean;
  /** A sheet of measurements, one row per well. Parsed in the UI, as samples-and-data does. */
  propertyFile?: ImportFileHandle;
  /** Which of the sheet's columns identify the well, and which are properties. */
  propertyMapping?: PropertyMapping;
  /** The mapped result. What travels to the workflow, not the file. */
  properties: Property[];
  /** Which columns the sequence table shows, how it is sorted and filtered. */
  sequenceTableState: PlDataTableStateV2;
  /** The same, for the pair table. */
  pairTableState: PlDataTableStateV2;
  /** The same, for the clone table. */
  cloneTableState: PlDataTableStateV2;
  /** Which of the three result tables is open. */
  resultsTab?: ResultsTab;
  /** The same as the other tables' state, for the QC plate table. */
  plateTableState: PlDataTableStateV2;
  /** Which Plate View tab is open. */
  qcTab?: QcTab;
  /** Which read quality chart is open. */
  readsTab?: ReadsTab;
  /** Bins, axes and title of the mean quality chart. */
  readQualityGraph: GraphMakerState;
  /** The same, for the trimmed length chart. */
  readLengthGraph: GraphMakerState;
  /** The same, for the plate map on the Plate View page. */
  plateMapGraph: GraphMakerState;
};

function histogram(title: string): GraphMakerState {
  return {
    title,
    template: "bins",
    currentTab: null,
    // Left unset, the bars render as outlines only.
    layersSettings: { bins: { fillColor: "#99e099" } },
    axesSettings: {
      axisY: { axisLabelsAngle: 0, scale: "linear" },
      other: { binsCount: 30 },
    },
  };
}

const READ_QUALITY = "pl7.app/vdj/qc/read/meanQuality";
const PLATE_MAP_VERDICT = "pl7.app/vdj/plateMap/verdict";
const READ_LENGTH = "pl7.app/vdj/qc/read/usableLength";
const READ_PLATE = "pl7.app/vdj/qc/read/plate";

function readColumn(acc: TreeNodeAccessor | undefined, name: string) {
  return acc?.getPColumns()?.find((c) => c.spec.name === name);
}

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
      well: normalizeWell(m.well.value),
      chain: m.chain?.value ?? "",
      // forward or reverse; a value neither end claims goes on as written.
      direction: m.direction ? (readEnd(m.direction.value) ?? m.direction.value) : "",
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

const dataModel = new DataModelBuilder({ kind })
  .from<BlockData>("v1")
  // v1 -> v2: the plate map's title went from "Plate Map" to empty (see the default
  // below). The page never lets it be edited, so every v1 block holds the old default.
  .migrate<BlockData>("v2", (prev) => ({
    ...prev,
    plateMapGraph: { ...prev.plateMapGraph, title: "" },
  }))
  .init(({ params }) => ({
    name: DEFAULT_NAME,
    traceFiles: [],
    properties: [],
    sequenceTableState: createPlDataTableStateV2(),
    pairTableState: createPlDataTableStateV2(),
    cloneTableState: createPlDataTableStateV2(),
    plateTableState: createPlDataTableStateV2(),
    readQualityGraph: histogram("Mean Quality per Read"),
    readLengthGraph: histogram("Trimmed Length per Read"),
    plateMapGraph: {
      // Empty, not hidden: the tab already names the map. Hiding graph-maker's title row
      // instead moves its chart loader up while the overlay loader stays put, so the two
      // draw as two offset charts during loading.
      title: "",
      template: "heatmap",
      currentTab: null,
      // A well shows its own value: the heatmap's default z-scores each row and
      // draws a missing value as 0, which reads as a measurement.
      layersSettings: { heatmap: { NAValueAs: null, normalizationDirection: null } },
      // Row letters and column numbers explain themselves. In "auto" mode the heatmap
      // keeps 72px above the plot for a title even when it has none to show.
      axesSettings: {
        title: { mode: "hidden" },
        axisX: { titleMode: "hidden", axisLabelsAngle: 0 },
        axisY: { titleMode: "hidden" },
      },
    },
    qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
    numberingScheme: "imgt",
    species: "hsa",
    exportWells: "passed",
    ...(params ?? {}),
  }));

const sequenceViewer = sequenceViewerPlugin.create({ pluginId: "sequenceViewer" });

export const platforma = BlockModelV3.create({ dataModel, kind })
  /**
   * The viewer reads the variants this block exports, from its own outputs, and nothing
   * else: the result pool holds the same columns under other ids, and discovering them
   * would put every clone in twice. The reads are one `.ab1` per variant and chain.
   */
  .plugin(sequenceViewer, {
    anchorColumns: (ctx) => {
      const columns = ctx.outputs
        ?.resolve({ field: "variants", allowPermanentAbsence: true })
        ?.getPColumns()
        ?.filter((c) => c.spec.axesSpec.length === 1);
      return columns && { columns, isFinal: true };
    },
    sources: () => [],
    traceFiles: (ctx) => {
      const columns = ctx.outputs
        ?.resolve({ field: "traceFiles", allowPermanentAbsence: true })
        ?.getPColumns();
      return columns && { columns, isFinal: true };
    },
  })

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
      species: data.species,
      exportWells: data.exportWells,
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
  .output("wellsWithoutProperties", (ctx) =>
    ctx.outputs?.resolve("wellsWithoutProperties")?.getDataAsJson<string[]>(),
  )

  /** Sheet rows that landed on no trace. */
  .output("valuesWithoutWell", (ctx) =>
    ctx.outputs?.resolve("valuesWithoutWell")?.getDataAsJson<string[]>(),
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

  /** One row per pair: its two chains side by side. */
  .outputWithStatus("pairsTable", (ctx): PlDataTableModel | undefined => {
    const acc = ctx.outputs?.resolve({ field: "pairsTable", allowPermanentAbsence: true });
    if (acc === undefined) return undefined;
    const provider = AccessorColumnsProvider(acc);
    const anchor = provider
      .getColumns()
      .find((c) => c.getSpec().name === "pl7.app/vdj/pair/well")
      ?.getSpec();
    if (anchor === undefined) return undefined;
    return createPlDataTableV3(ctx, {
      columns: { sources: [provider], anchors: { main: anchor }, selector: { maxHops: 0 } },
      tableState: ctx.data.pairTableState,
    });
  })

  /** One row per distinct clone, with every well it was seen in. */
  .outputWithStatus("clonesTable", (ctx): PlDataTableModel | undefined => {
    const acc = ctx.outputs?.resolve({ field: "clonesTable", allowPermanentAbsence: true });
    if (acc === undefined) return undefined;
    const provider = AccessorColumnsProvider(acc);
    const anchor = provider
      .getColumns()
      .find((c) => c.getSpec().name === "pl7.app/vdj/clone/wellCount")
      ?.getSpec();
    if (anchor === undefined) return undefined;
    return createPlDataTableV3(ctx, {
      columns: { sources: [provider], anchors: { main: anchor }, selector: { maxHops: 0 } },
      tableState: ctx.data.cloneTableState,
    });
  })

  /** One row per plate: how its wells came out. */
  .outputWithStatus("plateSummaryTable", (ctx): PlDataTableModel | undefined => {
    const acc = ctx.outputs?.resolve({ field: "plateSummaryTable", allowPermanentAbsence: true });
    if (acc === undefined) return undefined;
    const provider = AccessorColumnsProvider(acc);
    const anchor = provider
      .getColumns()
      .find((c) => c.getSpec().name === "pl7.app/vdj/qc/wells")
      ?.getSpec();
    if (anchor === undefined) return undefined;
    return createPlDataTableV3(ctx, {
      columns: { sources: [provider], anchors: { main: anchor }, selector: { maxHops: 0 } },
      tableState: ctx.data.plateTableState,
    });
  })

  // Each chart's frame holds its value and the plate, and nothing else. GraphMaker
  // binds any further sibling to a colour or facet slot of its own accord, which
  // overlays or empties the plot; the UI binds both columns it is given.
  .outputWithStatus("readQualityPf", (ctx): PFrameHandle | undefined => {
    const acc = ctx.outputs?.resolve({ field: "readsTable", allowPermanentAbsence: true });
    const col = readColumn(acc, READ_QUALITY);
    const plate = readColumn(acc, READ_PLATE);
    return col && plate ? ctx.createPFrame([col, plate]) : undefined;
  })

  .output("readQualitySpec", (ctx): PColumnIdAndSpec | undefined => {
    const acc = ctx.outputs?.resolve({ field: "readsTable", allowPermanentAbsence: true });
    const col = readColumn(acc, READ_QUALITY);
    return col ? { columnId: col.id, spec: col.spec } : undefined;
  })

  .outputWithStatus("readLengthPf", (ctx): PFrameHandle | undefined => {
    const acc = ctx.outputs?.resolve({ field: "readsTable", allowPermanentAbsence: true });
    const col = readColumn(acc, READ_LENGTH);
    const plate = readColumn(acc, READ_PLATE);
    return col && plate ? ctx.createPFrame([col, plate]) : undefined;
  })

  .output("readLengthSpec", (ctx): PColumnIdAndSpec | undefined => {
    const acc = ctx.outputs?.resolve({ field: "readsTable", allowPermanentAbsence: true });
    const col = readColumn(acc, READ_LENGTH);
    return col ? { columnId: col.id, spec: col.spec } : undefined;
  })

  .output("readPlateSpec", (ctx): PColumnIdAndSpec | undefined => {
    const acc = ctx.outputs?.resolve({ field: "readsTable", allowPermanentAbsence: true });
    const col = readColumn(acc, READ_PLATE);
    return col ? { columnId: col.id, spec: col.spec } : undefined;
  })

  // Every well-level column, so the scientist can colour the plate by any of them.
  .outputWithStatus("plateMapPf", (ctx): PFrameHandle | undefined => {
    const columns = ctx.outputs
      ?.resolve({ field: "plateMap", allowPermanentAbsence: true })
      ?.getPColumns();
    return columns && columns.length > 0 ? ctx.createPFrame(columns) : undefined;
  })

  /** The verdict column, which the plate map shows first. Its axes are plate, row and column. */
  .output("plateMapVerdictSpec", (ctx): PColumnIdAndSpec | undefined => {
    const acc = ctx.outputs?.resolve({ field: "plateMap", allowPermanentAbsence: true });
    const col = readColumn(acc, PLATE_MAP_VERDICT);
    return col ? { columnId: col.id, spec: col.spec } : undefined;
  })

  /**
   * The axis the viewer's rows are keyed on. The clones table carries the same keys
   * under its own axis, so its selection is re-keyed onto this one to open the viewer.
   */
  .output(
    "variantAxisSpec",
    (ctx) =>
      ctx.outputs
        ?.resolve({ field: "variants", allowPermanentAbsence: true })
        ?.getPColumns()
        ?.find((c) => c.spec.axesSpec.length === 1)?.spec.axesSpec[0],
  )

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
    species: data.species,
    exportWells: data.exportWells,
  }))

  .title(() => "Clone Annotation")

  .subtitle((ctx) => ctx.data.name.trim() || DEFAULT_NAME)

  // Always offered, so a block that has not run yet shows where the results
  // will appear rather than hiding it.
  .sections(() => [
    { type: "link" as const, href: "/" as const, label: "Files" },
    { type: "link" as const, href: "/qc" as const, label: "Plate View" },
    { type: "link" as const, href: "/read-quality" as const, label: "Read Quality" },
    { type: "link" as const, href: "/results" as const, label: "Results" },
  ])
  .done();

export type BlockOutputs = InferOutputsType<typeof platforma>;
