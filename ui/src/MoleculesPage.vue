<script setup lang="ts">
import { PlBlockPage, PlDataTableV2, usePlDataTableSettingsV2 } from "@platforma-sdk/ui-vue";
import { useApp } from "./app";

const app = useApp();

const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.moleculesTable,
});
</script>

<template>
  <PlBlockPage>
    <template #title>Molecules</template>

    <PlDataTableV2
      v-model="app.model.data.moleculeTableState"
      :settings="tableSettings"
      show-export-button
      not-ready-text="Run the block to pair the chains."
      no-rows-text="No molecules."
    />
  </PlBlockPage>
</template>
