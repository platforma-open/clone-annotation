<script setup lang="ts">
import { PlBlockPage, PlDataTableV2, usePlDataTableSettingsV2 } from "@platforma-sdk/ui-vue";
import { useApp } from "./app";

const app = useApp();

const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.variantsTable,
});
</script>

<template>
  <PlBlockPage>
    <template #title>Variants</template>

    <PlDataTableV2
      v-model="app.model.data.variantTableState"
      :settings="tableSettings"
      show-export-button
      not-ready-text="Run the block to collapse identical molecules."
      no-rows-text="No variants."
    />
  </PlBlockPage>
</template>
