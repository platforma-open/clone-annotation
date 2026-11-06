<script setup lang="ts">
import type { PlSelectionModel } from "@platforma-open/milaboratories.clone-annotation.model";
import { PlDataTableV2, usePlDataTableSettingsV2 } from "@platforma-sdk/ui-vue";
import { useApp } from "./app";

const app = useApp();

/** The rows picked in the table, which is what the sequence viewer opens on. */
const selection = defineModel<PlSelectionModel>("selection");

const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.clonesTable,
});
</script>

<template>
  <PlDataTableV2
    v-model="app.model.data.cloneTableState"
    v-model:selection="selection"
    :settings="tableSettings"
    show-export-button
    not-ready-text="Run the block to collapse identical clones."
    no-rows-text="No clones."
  />
</template>
