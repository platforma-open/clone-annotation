<script setup lang="ts">
import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import { GraphMaker } from "@milaboratories/graph-maker";
import type { ReadsTab } from "@platforma-open/milaboratories.clone-annotation.model";
import { DEFAULT_QUALITY_THRESHOLD } from "@platforma-open/milaboratories.clone-annotation.model";
import { PlTabs } from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "./app";

const app = useApp();

const TABS = [
  { label: "Mean Quality", value: "quality" },
  { label: "Trimmed Length", value: "length" },
] as const satisfies readonly { label: string; value: ReadsTab }[];

const tab = computed({
  get: () => app.model.data.readsTab ?? "quality",
  set: (value: ReadsTab) => (app.model.data.readsTab = value),
});

const threshold = computed(() => app.model.data.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD);

const floorNote = computed(() =>
  threshold.value === DEFAULT_QUALITY_THRESHOLD
    ? `Quality floor Q${threshold.value} (default)`
    : `Quality floor Q${threshold.value} (default Q${DEFAULT_QUALITY_THRESHOLD})`,
);

// One panel per plate, so a plate whose reads failed stands apart from the rest.
function withPlateFacet(
  value: PredefinedGraphOption<"histogram">["selectedSource"],
): PredefinedGraphOption<"histogram">[] {
  const plate = app.model.outputs.readPlateSpec?.spec;
  const options: PredefinedGraphOption<"histogram">[] = [
    { inputName: "value", selectedSource: value },
  ];
  if (plate) options.push({ inputName: "facetBy", selectedSource: plate });
  return options;
}

const qualityDefaults = computed((): PredefinedGraphOption<"histogram">[] | undefined => {
  const spec = app.model.outputs.readQualitySpec?.spec;
  return spec ? withPlateFacet(spec) : undefined;
});

const lengthDefaults = computed((): PredefinedGraphOption<"histogram">[] | undefined => {
  const spec = app.model.outputs.readLengthSpec?.spec;
  return spec ? withPlateFacet(spec) : undefined;
});

const notRun = { noPframe: { title: "Run the block to see how the reads came out" } };
</script>

<template>
  <GraphMaker
    v-if="tab === 'quality'"
    key="quality"
    v-model="app.model.data.readQualityGraph"
    chart-type="histogram"
    :data-state-key="app.model.outputs.readQualityPf"
    :p-frame="app.model.outputs.readQualityPf"
    :default-options="qualityDefaults"
    :status-text="notRun"
  >
    <template #titleLineSlot>
      <div :class="$style.titleLine">
        <span :class="$style.note">{{ floorNote }}</span>
        <PlTabs v-model="tab" :options="TABS" :top-line="false" />
      </div>
    </template>
  </GraphMaker>

  <GraphMaker
    v-else
    key="length"
    v-model="app.model.data.readLengthGraph"
    chart-type="histogram"
    :data-state-key="app.model.outputs.readLengthPf"
    :p-frame="app.model.outputs.readLengthPf"
    :default-options="lengthDefaults"
    :status-text="notRun"
  >
    <template #titleLineSlot>
      <div :class="$style.titleLine">
        <span :class="$style.note">{{ floorNote }}</span>
        <PlTabs v-model="tab" :options="TABS" :top-line="false" />
      </div>
    </template>
  </GraphMaker>
</template>

<style module>
.titleLine {
  display: flex;
  align-items: center;
  gap: 16px;
}

.note {
  font-size: 12px;
  color: var(--txt-03);
}
</style>
