<script setup lang="ts">
import { SequenceViewerPluginModal } from "@milaboratories/sequence-viewer";
import {
  createPlSelectionModel,
  DEFAULT_QUALITY_THRESHOLD,
  type PlSelectionModel,
  type ResultsTab,
} from "@platforma-open/milaboratories.clone-annotation.model";
import { PlBlockPage, PlBtnGhost, PlMaskIcon24, PlTabs } from "@platforma-sdk/ui-vue";
import { computed, ref } from "vue";
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

// Selection is view state, not block data: it is per-viewer and means nothing to the
// workflow.
const cloneSelection = ref<PlSelectionModel>(createPlSelectionModel());
const selectedCount = computed(() => cloneSelection.value.selectedKeys.length);

// The selected clones as stacked tracks with their reads; every clone, up to the
// viewer's limit, when none is selected. The clones table is keyed on its own axis
// and the viewer on the exported one; the keys are the same variant keys, so only
// the axis changes.
const viewerOpen = ref(false);
// The block's threshold, so the viewer marks the same bases low as the QC page does.
const qualityThreshold = computed(
  () => app.model.data.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD,
);
const viewerSelection = computed((): PlSelectionModel | undefined => {
  const axis = app.model.outputs.variantAxisSpec;
  if (axis === undefined || selectedCount.value === 0) return undefined;
  return { axesSpec: [axis], selectedKeys: cloneSelection.value.selectedKeys };
});
</script>

<template>
  <PlBlockPage>
    <template #title>Results</template>
    <template #append>
      <PlBtnGhost
        v-if="tab === 'clones'"
        :disabled="!app.model.outputs.variantAxisSpec"
        @click.stop="viewerOpen = true"
      >
        Sequence viewer{{ selectedCount ? ` (${selectedCount})` : "" }}
        <template #append><PlMaskIcon24 name="dna" /></template>
      </PlBtnGhost>
      <!-- After the table's own controls (Filters, Columns), as in Plate View. -->
      <PlTabs v-model="tab" :class="$style.tabs" :options="tabs" :top-line="false" />
    </template>

    <div :class="$style.body">
      <ClonesTable v-if="tab === 'clones'" v-model:selection="cloneSelection" />
      <PairsTable v-else-if="tab === 'pairs'" />
      <SequencesTable v-else />
    </div>

    <SequenceViewerPluginModal
      v-model="viewerOpen"
      :handle="app.plugins.sequenceViewer.handle"
      :selection="viewerSelection"
      :quality-threshold="qualityThreshold"
    />
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
