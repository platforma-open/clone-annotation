<script setup lang="ts">
import { PlBlockPage, PlDataTableV2, usePlDataTableSettingsV2 } from "@platforma-sdk/ui-vue";
import { useApp } from "./app";

const app = useApp();

const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.clonesTable,
});
</script>

<template>
  <PlBlockPage>
    <template #title>Clones</template>

    <PlDataTableV2
      v-model="app.model.data.tableState"
      :settings="tableSettings"
      show-export-button
      not-ready-text="Run the block to annotate the clones."
      no-rows-text="No clones."
    />
  </PlBlockPage>
</template>
