<script setup lang="ts">
import type {
  ImportFileHandle,
  TraceRead,
} from "@platforma-open/milaboratories.clone-annotation.model";
import {
  basename,
  DEFAULT_QUALITY_THRESHOLD,
  getFilePathFromHandle,
} from "@platforma-open/milaboratories.clone-annotation.model";
import type { PlAgHeaderComponentParams } from "@platforma-sdk/ui-vue";
import {
  AgGridTheme,
  makeRowNumberColDef,
  PlAgCellFile,
  PlAgCellStatusTag,
  PlAgColumnHeader,
  PlAgTextAndButtonCell,
} from "@platforma-sdk/ui-vue";
import type { ColDef, GridApi, GridOptions, GridReadyEvent, IRowNode } from "ag-grid-enterprise";
import { AgGridVue } from "ag-grid-vue3";
import { computed, ref, shallowRef } from "vue";
import { useApp } from "./app";
import { cloneKey } from "./properties";
import RawTraceViewer, { type RawTraceRead } from "./RawTraceViewer.vue";
import type { SelectedFile } from "./trace_set";
import { ALL_EXTENSIONS, compilePattern } from "./trace_set";

const props = defineProps<{ files: SelectedFile[] }>();

const app = useApp();

type FileRow = {
  key: string;
  path: string;
  plate: string;
  well: string;
  chain: string;
  direction: string;
  matched: boolean;
  file: ImportFileHandle;
  /** What Tracy made of this file. Absent until the block has run. */
  read?: TraceRead;
  setAsideReason?: string;
  /** Pattern tags the file name carried, keyed by the tag's name. */
  tags: Record<string, string>;
  /** What the sheet holds for this file's well, under the names it used. */
  properties: Record<string, string>;
};

const isCombined = computed(() => (app.model.data.fileShape ?? "perFile") === "combined");

/** The sheet's columns, in the order the scientist mapped them. */
const properties = computed(() => app.model.data.properties ?? []);

// The join key must be built the same way the properties were, in `buildProperties`:
// a record id for a name-keyed set, and the plate only when the files carry one.
const pattern = computed(() => compilePattern(app.model.data.namePattern ?? "").pattern);
const identityIsName = computed(() => pattern.value?.identityIsName ?? false);
const hasPlate = computed(() => pattern.value?.hasPlate ?? false);

/** The tag names the pattern declared, over the selected files. */
const tagNames = computed(() => {
  const names = new Set<string>();
  for (const f of props.files) for (const n of Object.keys(f.match?.tags ?? {})) names.add(n);
  return [...names];
});

/** Tracy's results, keyed by the same relative path the table shows. */
const reads = computed(() => {
  const byPath = new Map<string, TraceRead>();
  for (const r of app.model.outputs.traceReport?.reads ?? []) byPath.set(r.path, r);
  return byPath;
});

const setAside = computed(() => {
  const byPath = new Map<string, string>();
  for (const s of app.model.outputs.traceReport?.setAside ?? []) byPath.set(s.path, s.reason);
  return byPath;
});

const hasReads = computed(() => (app.model.outputs.traceReport?.reads.length ?? 0) > 0);

// Separate from hasReads: a FASTA gives a read per file (so Length and Status
// show) but carries no quality, so the quality columns stay hidden.
const hasQuality = computed(() =>
  (app.model.outputs.traceReport?.reads ?? []).some(
    (r) => r.meanQuality !== undefined && r.meanQuality !== null,
  ),
);

/** The four tag colours PlAgCellStatusTag draws. */
type StatusTag = "OK" | "WARN" | "ALERT" | "HOLD";

// A read Tracy basecalled sits in `reads`, with `kept` telling a usable read
// from one trimmed too short. A read Tracy could not call at all skips `reads`
// and only leaves a set-aside reason. So `read` present-or-absent separates a
// low-quality read from one that gave nothing.

/** The tag colour for a file, or undefined before the block has read it. */
function readStatusTag(row?: FileRow): StatusTag | undefined {
  if (row?.read?.kept === true) return "OK";
  if (row?.read !== undefined) return "WARN";
  if (row?.setAsideReason !== undefined) return "ALERT";
  return undefined;
}

/** A sortable word for the status, so the column still sorts and exports. */
function readStatusLabel(row?: FileRow): string | undefined {
  if (row?.read?.kept === true) return "Kept";
  if (row?.read !== undefined) return "Low quality";
  if (row?.setAsideReason !== undefined) return "No sequence";
  return undefined;
}

const rowData = computed<FileRow[]>(() =>
  props.files.map((f) => {
    const plate = f.match?.plate?.value ?? "";
    // A header name with no well rides the well slot (option A), so it fills the
    // Sequence ID column.
    const well = f.match?.well?.value ?? f.match?.name?.value ?? "";
    const values: Record<string, string> = {};
    if (f.match) {
      const key = cloneKey(plate, well, identityIsName.value, hasPlate.value);
      for (const p of properties.value) {
        const v = p.values[key];
        if (v !== undefined) values[p.name] = v;
      }
    }
    // For a combined file `f.path` is the record header, so the file itself comes
    // off the handle. The reader keys each record's read as "<file>#<index>"; a
    // per-file set keys on its path.
    const filePath = getFilePathFromHandle(f.handle);
    const readKey = isCombined.value ? `${filePath}#${f.recordIndex ?? 0}` : f.relativePath;
    return {
      // The row key must be unique: a header can repeat across combined files, so
      // the file-and-index key is used, not the header. A per-file row keys on its
      // own path. The Path column shows the file alone.
      key: isCombined.value ? readKey : f.path,
      path: isCombined.value ? basename(filePath) : f.relativePath,
      plate,
      well,
      chain: f.match?.chain?.value ?? "",
      direction: f.match?.direction?.value ?? "",
      matched: f.match !== undefined,
      file: f.handle,
      tags: Object.fromEntries(Object.entries(f.match?.tags ?? {}).map(([k, m]) => [k, m.value])),
      properties: values,
      read: reads.value.get(readKey),
      setAsideReason: setAside.value.get(readKey),
    };
  }),
);

// An identity column is shown only when the pattern filled it. FASTA has no
// direction, and a set with no chain or plate token leaves those empty, so the
// column would be a blank strip.
const hasValue = (field: "plate" | "chain" | "direction") =>
  rowData.value.some((r) => r[field] !== "");

// A name-keyed set (a header with a name and no well) labels its identity by the
// record's header, the "Sequence ID". Its "plate" is the source file, which the
// Data column already shows, so that column is dropped.
const wellLabel = computed(() => (identityIsName.value ? "Sequence ID" : "Well"));

const columnDefs = computed<ColDef<FileRow>[]>(() => [
  makeRowNumberColDef(),
  {
    headerName: "Path",
    field: "path",
    flex: 2,
    minWidth: 160,
    // On an uploaded trace file, a hover button opens its raw Sanger trace. Other
    // rows keep the plain path cell.
    cellRendererSelector: (cell) =>
      canViewRaw(cell.data)
        ? {
            component: PlAgTextAndButtonCell,
            params: {
              icon: "maximize",
              btnLabel: "Trace",
              invokeRowsOnDoubleClick: false,
              onClick: (p: { data?: FileRow }) => p.data && openRawRow(p.data),
            },
          }
        : undefined,
  },
  ...(hasValue("plate") && !identityIsName.value
    ? [{ headerName: "Plate", field: "plate", flex: 1, minWidth: 100 } satisfies ColDef<FileRow>]
    : []),
  { headerName: wellLabel.value, field: "well", flex: 1, minWidth: 120 },
  ...(hasValue("chain")
    ? [{ headerName: "Chain", field: "chain", flex: 1, minWidth: 90 } satisfies ColDef<FileRow>]
    : []),
  ...(hasValue("direction")
    ? [{ headerName: "Direction", field: "direction", width: 110 } satisfies ColDef<FileRow>]
    : []),
  ...tagNames.value.map((name): ColDef<FileRow> => ({
    headerName: name,
    flex: 1,
    minWidth: 120,
    valueGetter: (row) => row.data?.tags[name],
  })),
  ...properties.value.map((p): ColDef<FileRow> => {
    const numeric = p.type !== "String";
    return {
      headerName: p.name,
      // A sheet can carry many columns with long names. A width floor keeps each
      // header readable and lets the grid scroll sideways instead of shrinking
      // every column to a letter; the full name shows on hover.
      flex: 1,
      minWidth: 140,
      headerTooltip: p.name,
      type: numeric ? "numericColumn" : undefined,
      // A well the sheet did not reach stays blank. Showing 0 would read as a
      // measurement that came out at zero.
      valueGetter: (row) => {
        const v = row.data?.properties[p.name];
        if (v === undefined) return undefined;
        return numeric ? Number(v) : v;
      },
    };
  }),
  ...(hasReads.value
    ? [
        {
          headerName: "Length",
          width: 100,
          type: "numericColumn",
          valueGetter: (row) => row.data?.read?.length,
        } satisfies ColDef<FileRow>,
      ]
    : []),
  ...(hasQuality.value
    ? [
        {
          headerName: "Trimmed Length",
          width: 130,
          type: "numericColumn",
          headerTooltip: "Bases kept after trimming the read at the quality threshold",
          valueGetter: (row) => row.data?.read?.usableLength,
        } satisfies ColDef<FileRow>,
        {
          headerName: "Mean Quality",
          width: 100,
          type: "numericColumn",
          headerTooltip: "Mean Phred quality of the trimmed read",
          valueGetter: (row) => row.data?.read?.meanQuality,
        } satisfies ColDef<FileRow>,
      ]
    : []),
  ...(hasReads.value
    ? [
        {
          headerName: "Status",
          width: 120,
          // A coloured tag, not a greyed row: green when the read is kept, amber
          // when it was basecalled but trimmed too short, red when Tracy got no
          // sequence at all. The reason shows on hover.
          cellRendererSelector: (cell) => {
            const type = readStatusTag(cell.data);
            return type ? { component: PlAgCellStatusTag, params: { type } } : undefined;
          },
          valueGetter: (row) => readStatusLabel(row.data),
          tooltipValueGetter: (row) => row.data?.setAsideReason,
        } satisfies ColDef<FileRow>,
      ]
    : []),
  {
    headerName: "Data",
    field: "file",
    flex: 2,
    minWidth: 160,
    cellClass: "files-data-cell",
    cellStyle: { padding: 0 },
    headerComponent: PlAgColumnHeader,
    headerComponentParams: { type: "File" } satisfies PlAgHeaderComponentParams,
    cellRenderer: "PlAgCellFile",
    cellRendererParams: {
      extensions: ALL_EXTENSIONS,
      resolveProgress: (handle: ImportFileHandle | undefined) =>
        handle ? app.progresses[handle] : undefined,
    },
  },
]);

// Downloadable handle per uploaded read, keyed by its import handle. Present only
// after the block has run (reads upload in the main run), so the raw-trace action
// is offered only for files that are already there.
const traceContent = computed(() => app.model.outputs.traceContent ?? {});
const isTraceForm = computed(() => (app.model.data.form ?? "trace") === "trace");
const qualityThreshold = computed(
  () => app.model.data.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD,
);

const rawOpen = ref(false);
const rawReads = ref<RawTraceRead[]>([]);

function rawLabel(row: FileRow): string {
  return [row.plate, row.well, row.chain, row.direction].filter(Boolean).join(" / ") || row.path;
}

function rawReadsOf(rows: FileRow[]): RawTraceRead[] {
  return rows.flatMap((row) => {
    const handle = traceContent.value[row.file];
    return handle
      ? [
          {
            key: row.key,
            label: rawLabel(row),
            chainLabel: "",
            handle: handle.handle,
            trimmed: row.read?.trimmed,
          },
        ]
      : [];
  });
}

/** True once a file's read is uploaded, so its raw trace can be opened. */
function canViewRaw(row: FileRow | undefined): boolean {
  return isTraceForm.value && row !== undefined && traceContent.value[row.file] !== undefined;
}

function openRawRow(row: FileRow) {
  const reads = rawReadsOf([row]);
  if (reads.length === 0) return;
  rawReads.value = reads;
  rawOpen.value = true;
}

const gridApi = shallowRef<GridApi<FileRow>>();

function onGridReady(params: GridReadyEvent) {
  gridApi.value = params.api;
}

/** The selected rows, or the row the menu was opened on when nothing is selected. */
function targetRows(node: IRowNode<FileRow> | null): FileRow[] {
  const selected = gridApi.value?.getSelectedRows() ?? [];
  if (selected.length !== 0) return selected;
  return node?.data ? [node.data] : [];
}

function removeFiles(rows: FileRow[]) {
  const dropped = new Set(rows.map((r) => r.file));
  app.model.data.traceFiles = (app.model.data.traceFiles ?? []).filter((h) => !dropped.has(h));
}

const gridOptions: GridOptions<FileRow> = {
  getRowId: (row) => row.data.key,
  rowHeight: 45,
  getMainMenuItems: () => [],
  // Native browser tooltips, so the set-aside reason on the Status tag shows at
  // once on hover. The grid's own tooltip waits two seconds before it appears.
  enableBrowserTooltips: true,
  components: { PlAgCellFile },
  rowSelection: { mode: "multiRow", checkboxes: false, headerCheckbox: false },
  getContextMenuItems: (params) => {
    const rows = targetRows(params.node);
    if (rows.length === 0) return [];
    return [
      {
        name: rows.length > 1 ? `Remove ${rows.length} files` : `Remove ${rows[0]!.path}`,
        action: () => removeFiles(rows),
      },
    ];
  },
  // A file the pattern did not capture is shown rather than hidden: the scientist
  // needs to see what will be left out before importing. A read the block set
  // aside keeps its full colour now; the Status tag flags it instead.
  rowClassRules: {
    "row-unmatched": (p) => p.data?.matched === false,
  },
};
</script>

<template>
  <AgGridVue
    :theme="AgGridTheme"
    :style="{ height: '100%' }"
    :rowData="rowData"
    :columnDefs="columnDefs"
    :defaultColDef="{ suppressHeaderMenuButton: true }"
    :gridOptions="gridOptions"
    @grid-ready="onGridReady"
  />
  <RawTraceViewer v-model="rawOpen" :reads="rawReads" :quality-threshold="qualityThreshold" />
</template>

<style>
.row-unmatched {
  opacity: 0.45;
}

/* The Data cell only previews the imported file. The file input under it is made
   pointer-transparent, so a click falls through to the row (select, context-menu
   Remove) instead of opening a file dialog; its clear (✕) is also hidden. */
.files-data-cell [data-testid="pl-file-input-control"] {
  pointer-events: none;
}

.files-data-cell [data-testid="pl-file-input-clear"] {
  display: none;
}
</style>
