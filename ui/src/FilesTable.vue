<script setup lang="ts">
import type {
  ImportFileHandle,
  TraceRead,
} from "@platforma-open/milaboratories.clone-annotation.model";
import type { PlAgHeaderComponentParams } from "@platforma-sdk/ui-vue";
import {
  AgGridTheme,
  makeRowNumberColDef,
  PlAgCellFile,
  PlAgCellStatusTag,
  PlAgColumnHeader,
} from "@platforma-sdk/ui-vue";
import type { ColDef, GridApi, GridOptions, GridReadyEvent, IRowNode } from "ag-grid-enterprise";
import { AgGridVue } from "ag-grid-vue3";
import { computed, shallowRef } from "vue";
import { useApp } from "./app";
import { cloneKey } from "./properties";
import type { SelectedFile } from "./trace_set";
import { TRACE_EXTENSIONS } from "./trace_set";

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
  /** What the sheet holds for this file's well, under the names it used. */
  properties: Record<string, string>;
};

/** The sheet's columns, in the order the scientist mapped them. */
const properties = computed(() => app.model.data.properties ?? []);

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
    const well = f.match?.well.value ?? "";
    const values: Record<string, string> = {};
    if (f.match) {
      const key = cloneKey(plate, well);
      for (const p of properties.value) {
        const v = p.values[key];
        if (v !== undefined) values[p.name] = v;
      }
    }
    return {
      key: f.path,
      path: f.relativePath,
      plate,
      well,
      chain: f.match?.chain?.value ?? "",
      direction: f.match?.direction?.value ?? "",
      matched: f.match !== undefined,
      file: f.handle,
      properties: values,
      read: reads.value.get(f.relativePath),
      setAsideReason: setAside.value.get(f.relativePath),
    };
  }),
);

const columnDefs = computed<ColDef<FileRow>[]>(() => [
  makeRowNumberColDef(),
  { headerName: "Path", field: "path", flex: 2 },
  { headerName: "Plate", field: "plate", flex: 1 },
  { headerName: "Well", field: "well", flex: 1 },
  { headerName: "Chain", field: "chain", flex: 1 },
  { headerName: "Direction", field: "direction", width: 110 },
  ...properties.value.map((p): ColDef<FileRow> => {
    const numeric = p.type !== "String";
    return {
      headerName: p.name,
      flex: 1,
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
    cellStyle: { padding: 0 },
    headerComponent: PlAgColumnHeader,
    headerComponentParams: { type: "File" } satisfies PlAgHeaderComponentParams,
    cellRenderer: "PlAgCellFile",
    cellRendererParams: {
      extensions: TRACE_EXTENSIONS,
      resolveProgress: (handle: ImportFileHandle | undefined) =>
        handle ? app.progresses[handle] : undefined,
    },
  },
]);

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
</template>

<style>
.row-unmatched {
  opacity: 0.45;
}
</style>
