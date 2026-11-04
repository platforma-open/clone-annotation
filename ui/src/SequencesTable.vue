<script setup lang="ts">
import { PlDataTableV2, usePlDataTableSettingsV2 } from "@platforma-sdk/ui-vue";
import { useApp } from "./app";

const app = useApp();

const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.sequencesTable,
});
</script>

<template>
  <PlDataTableV2
    v-model="app.model.data.sequenceTableState"
    :settings="tableSettings"
    show-export-button
    not-ready-text="Run the block to read the sequences."
    no-rows-text="No sequences."
  />
</template>
