<script setup lang="ts">
import { PlDataTableV2, usePlDataTableSettingsV2 } from "@platforma-sdk/ui-vue";
import { useApp } from "./app";

const app = useApp();

const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.pairsTable,
});
</script>

<template>
  <PlDataTableV2
    v-model="app.model.data.pairTableState"
    :settings="tableSettings"
    show-export-button
    not-ready-text="Run the block to pair the chains."
    no-rows-text="No pairs."
  />
</template>
