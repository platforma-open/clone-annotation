<script setup lang="ts">
import type { ResultsTab } from "@platforma-open/milaboratories.clone-annotation.model";
import { PlBlockPage, PlTabs } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "./app";
import ClonesTable from "./ClonesTable.vue";
import PairsTable from "./PairsTable.vue";
import SequencesTable from "./SequencesTable.vue";

const app = useApp();

// On a set with nothing to pair, every pair holds one chain and repeats the
// sequence table, so the tab is left out.
const paired = computed(() => app.model.outputs.annotation?.paired !== false);

const tabs = computed(() => [
  { label: "Clones", value: "clones" as const },
  ...(paired.value ? [{ label: "Pairs", value: "pairs" as const }] : []),
  { label: "Sequences", value: "sequences" as const },
]);

// A stored tab the set no longer offers opens as Clones. Only the read falls
// back: writing the fallback into the data from here would be a hairpin.
const tab = computed({
  get: (): ResultsTab => {
    const stored = app.model.data.resultsTab ?? "clones";
    return tabs.value.some((t) => t.value === stored) ? stored : "clones";
  },
  set: (value: ResultsTab) => (app.model.data.resultsTab = value),
});
</script>

<template>
  <PlBlockPage>
    <template #title>Results</template>

    <template #append>
      <!-- After the table's own controls (Filters, Columns), as in Plate View. -->
      <PlTabs v-model="tab" :class="$style.tabs" :options="tabs" :top-line="false" />
    </template>

    <div :class="$style.body">
      <ClonesTable v-if="tab === 'clones'" />
      <PairsTable v-else-if="tab === 'pairs'" />
      <SequencesTable v-else />
    </div>
  </PlBlockPage>
</template>

<style module>
/* The table's last button has 12px padding at its edge. The tabs have none at
   their underline, so they get the other 12px here. */
.tabs {
  margin-left: 12px;
}

.body {
  flex: 1;
  min-height: 300px;
}
</style>
