<script setup lang="ts">
import { DEFAULT_QUALITY_THRESHOLD } from "@platforma-open/milaboratories.clone-annotation.model";
import {
  PlAccordion,
  PlAccordionSection,
  PlBlockPage,
  PlChartHistogram,
  PlDropdown,
} from "@platforma-sdk/ui-vue";
import { computed } from "vue";
import { useApp } from "./app";
import PlateMap from "./PlateMap.vue";
import type { QcInput } from "./qc";
import { buildFunnel, buildLists, buildPlateMaps } from "./qc";

const app = useApp();

const input = computed<QcInput>(() => ({
  fileCount: app.model.data.traceFiles?.length ?? 0,
  unmatched: app.model.outputs.unmatched ?? [],
  trace: app.model.outputs.traceReport,
  clones: app.model.outputs.clones ?? [],
  annotation: app.model.outputs.annotation,
  clonesWithoutProperties: app.model.outputs.clonesWithoutProperties ?? [],
  valuesWithoutClone: app.model.outputs.valuesWithoutClone ?? [],
}));

const hasRun = computed(() => app.model.outputs.traceReport !== undefined);

const funnel = computed(() => buildFunnel(input.value));
const lists = computed(() => buildLists(input.value));
const plates = computed(() => buildPlateMaps(input.value));

const plateOptions = computed(() =>
  plates.value.map((p) => ({ label: p.plate === "" ? "No plate" : p.plate, value: p.plate })),
);

const plate = computed({
  get: () => {
    const chosen = app.model.data.qcPlate;
    const known = plates.value.some((p) => p.plate === chosen);
    return known ? chosen : plates.value[0]?.plate;
  },
  set: (value: string | undefined) => (app.model.data.qcPlate = value),
});

const shown = computed(() => plates.value.find((p) => p.plate === plate.value));

const reads = computed(() => app.model.outputs.traceReport?.reads ?? []);

const qualitySettings = computed(() => ({
  type: "basic" as const,
  numbers: reads.value.map((r) => r.meanQuality),
  threshold: app.model.data.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD,
  nBins: 30,
  title: "Mean quality per read",
  xAxisLabel: "Phred",
  yAxisLabel: "Reads",
  totalWidth: 380,
  totalHeight: 220,
}));

const lengthSettings = computed(() => ({
  type: "basic" as const,
  numbers: reads.value.filter((r) => r.usableLength > 0).map((r) => r.usableLength),
  nBins: 30,
  title: "Usable length per read",
  xAxisLabel: "Bases",
  yAxisLabel: "Reads",
  totalWidth: 380,
  totalHeight: 220,
}));
</script>

<template>
  <PlBlockPage>
    <template #title>QC</template>

    <p v-if="!hasRun" :class="$style.note">
      Run the block to see where the files went. Until then there is nothing to check.
    </p>

    <template v-else>
      <section :class="$style.section">
        <header :class="$style.header">
          <h3 :class="$style.heading">Plate map</h3>
          <PlDropdown
            v-if="plateOptions.length > 1"
            v-model="plate"
            :options="plateOptions"
            :class="$style.platePicker"
          />
        </header>
        <PlateMap v-if="shown" :map="shown" />
        <p v-else :class="$style.note">No well carries a plate and a position.</p>
      </section>

      <section :class="$style.section">
        <h3 :class="$style.heading">Where the files went</h3>
        <div :class="$style.funnel">
          <div v-for="step in funnel" :key="step.label" :class="$style.step">
            <span :class="$style.stepLabel">{{ step.label }}</span>
            <span :class="$style.stepCount">{{ step.count }}</span>
            <span :class="$style.parts">
              <span
                v-for="part in step.parts"
                :key="part.label"
                :class="[$style.part, part.bad && $style.bad]"
              >
                {{ part.label }} {{ part.count }}
              </span>
            </span>
          </div>
        </div>
      </section>

      <section :class="$style.section">
        <h3 :class="$style.heading">Read quality</h3>
        <div :class="$style.charts">
          <PlChartHistogram :settings="qualitySettings" />
          <PlChartHistogram :settings="lengthSettings" />
        </div>
        <p :class="$style.note">
          The line on the first chart is the quality floor. Each read is trimmed to its longest
          stretch at or above it, and the second chart is what that leaves.
        </p>
      </section>

      <section v-if="lists.length > 0" :class="$style.section">
        <h3 :class="$style.heading">Worth a look</h3>
        <PlAccordion multiple>
          <PlAccordionSection
            v-for="list in lists"
            :key="list.label"
            :label="`${list.label} (${list.items.length})`"
          >
            <ul :class="$style.items">
              <li v-for="item in list.items" :key="item">{{ item }}</li>
            </ul>
          </PlAccordionSection>
        </PlAccordion>
      </section>
    </template>
  </PlBlockPage>
</template>

<style module>
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 32px;
}

.header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.heading {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.platePicker {
  width: 200px;
}

.note {
  margin: 0;
  font-size: 12px;
  color: var(--txt-03);
}

.funnel {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step {
  display: grid;
  grid-template-columns: 160px 64px 1fr;
  align-items: baseline;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color-div-grey);
}

.stepLabel {
  font-size: 13px;
}

.stepCount {
  font-size: 18px;
  font-family: var(--font-family-monospace);
  text-align: right;
}

.parts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
  color: var(--txt-03);
}

.part {
  white-space: nowrap;
}

.bad {
  color: var(--txt-error);
}

.charts {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}

.items {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  font-family: var(--font-family-monospace);
  max-height: 260px;
  overflow-y: auto;
}
</style>
