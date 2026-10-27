<script setup lang="ts">
import { AgGridTheme, makeRowNumberColDef, PlBlockPage } from "@platforma-sdk/ui-vue";
import type { ColDef, GridOptions } from "ag-grid-enterprise";
import { AgGridVue } from "ag-grid-vue3";
import { computed } from "vue";
import { useApp } from "./app";

const app = useApp();

type Row = { path: string };

const rows = computed<Row[]>(() => (app.model.outputs.unmatched ?? []).map((path) => ({ path })));

const columnDefs: ColDef<Row>[] = [
  makeRowNumberColDef(),
  { headerName: "Path", field: "path", flex: 1 },
];

const gridOptions: GridOptions<Row> = {
  getRowId: (row) => row.data.path,
  rowHeight: 45,
  getMainMenuItems: () => [],
};
</script>

<template>
  <PlBlockPage>
    <template #title>Unplaced files</template>

    <p class="note">
      The pattern did not match these, so they carry no plate or well and are in no clone. They are
      listed rather than dropped: a file nobody can place is a result, not an absence.
    </p>

    <div class="grid-area">
      <AgGridVue
        :theme="AgGridTheme"
        :style="{ height: '100%' }"
        :rowData="rows"
        :columnDefs="columnDefs"
        :defaultColDef="{ suppressHeaderMenuButton: true }"
        :gridOptions="gridOptions"
      />
    </div>
  </PlBlockPage>
</template>

<style scoped>
.note {
  margin: 0 0 12px;
  font-size: 12px;
  opacity: 0.75;
}

.grid-area {
  flex: 1;
  min-height: 300px;
}
</style>
