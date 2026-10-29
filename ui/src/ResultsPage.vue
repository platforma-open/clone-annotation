<script setup lang="ts">
import type { ResultsTab } from "@platforma-open/milaboratories.clone-annotation.model";
import { PlBlockPage, PlTabs } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "./app";
import ClonesTable from "./ClonesTable.vue";
import SequencesTable from "./SequencesTable.vue";
import VariantsTable from "./VariantsTable.vue";

const app = useApp();

const TABS = [
  { label: "Sequences", value: "sequences" },
  { label: "Clones", value: "clones" },
  { label: "Variants", value: "variants" },
] as const satisfies readonly { label: string; value: ResultsTab }[];

const tab = computed({
  get: () => app.model.data.resultsTab ?? "sequences",
  set: (value: ResultsTab) => (app.model.data.resultsTab = value),
});
</script>

<template>
  <PlBlockPage>
    <template #title>Results</template>

    <template #append>
      <!-- The table teleports Filters, Columns and Export into this same area, immediately
           before this slot, so the tabs would otherwise butt up against them. -->
      <div :class="$style.appended">
        <PlTabs v-model="tab" :options="TABS" :top-line="false" />
      </div>
    </template>

    <div :class="$style.body">
      <SequencesTable v-if="tab === 'sequences'" />
      <ClonesTable v-else-if="tab === 'clones'" />
      <VariantsTable v-else />
    </div>
  </PlBlockPage>
</template>

<style module>
.appended {
  display: flex;
  align-items: center;
  margin-left: 16px;
}

.body {
  flex: 1;
  min-height: 300px;
}
</style>
