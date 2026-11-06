<script setup lang="ts">
import type { PredefinedGraphOption } from "@milaboratories/graph-maker";
import { GraphMaker } from "@milaboratories/graph-maker";
import type { QcTab } from "@platforma-open/milaboratories.clone-annotation.model";
import { DEFAULT_QUALITY_THRESHOLD } from "@platforma-open/milaboratories.clone-annotation.model";
import {
  PlBlockPage,
  PlBtnGhost,
  PlDataTableV2,
  PlDialogModal,
  PlMaskIcon24,
  PlTabs,
  usePlDataTableSettingsV2,
} from "@platforma-sdk/ui-vue";
import { computed, ref } from "vue";
import { useApp } from "./app";

const app = useApp();

const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.plateSummaryTable,
});

// The verdict, columns across and rows down, one panel per plate. The verdict
// column's axes are plate, row and column, in that order.
const plateMapDefaults = computed((): PredefinedGraphOption<"heatmap">[] | undefined => {
  const spec = app.model.outputs.plateMapVerdictSpec?.spec;
  const [plate, row, column] = spec?.axesSpec ?? [];
  if (!spec || !plate || !row || !column) return undefined;
  return [
    { inputName: "value", selectedSource: spec },
    { inputName: "x", selectedSource: column },
    { inputName: "y", selectedSource: row },
    { inputName: "facetBy", selectedSource: plate },
  ];
});

const plateMapNotRun = { noPframe: { title: "Run the block to see the plates" } };

const TABS = [
  { label: "Plate Map", value: "plateMap" },
  { label: "QC Metrics", value: "metrics" },
] as const satisfies readonly { label: string; value: QcTab }[];

const tab = computed({
  get: () => app.model.data.qcTab ?? "plateMap",
  set: (value: QcTab) => (app.model.data.qcTab = value),
});

const total = computed(() => app.model.outputs.annotation?.total);

const threshold = computed(() => app.model.data.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD);

const statsOpen = ref(false);
const reasonsOpen = ref(false);

// Written beside the rules in annotate.py and sent in the report, so a renamed
// reason or a moved limit cannot leave its explanation behind.
const reasonGroups = computed(() => {
  const help = app.model.outputs.annotation?.reasonHelp ?? [];
  return (["Failed", "Warning"] as const)
    .map((verdict) => ({ verdict, reasons: help.filter((r) => r.verdict === verdict) }))
    .filter((g) => g.reasons.length > 0);
});

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

const sides = computed(() => app.model.outputs.annotation?.sides ?? ["heavy", "light"]);

const stats = computed(() => {
  const t = total.value;
  const floor =
    threshold.value === DEFAULT_QUALITY_THRESHOLD
      ? `Q${threshold.value} (default)`
      : `Q${threshold.value} (default Q${DEFAULT_QUALITY_THRESHOLD})`;
  if (t === undefined) return [{ label: "Quality floor", value: floor }];
  return [
    { label: "Plates", value: String(t.plates) },
    { label: "Wells", value: String(t.wells) },
    { label: "Passed", value: `${t.passed} (${percent(t.passedShare)})` },
    // Only the sides the set has sequences for, as in the plate table.
    ...(sides.value.includes("heavy")
      ? [{ label: "Heavy passed", value: String(t.heavyPassed) }]
      : []),
    ...(sides.value.includes("light")
      ? [{ label: "Light passed", value: String(t.lightPassed) }]
      : []),
    { label: "Warning", value: String(t.warning) },
    { label: "Failed", value: String(t.failed) },
    { label: "Usable reads", value: percent(t.usableReadsShare) },
    { label: "Merged", value: percent(t.mergedShare) },
    { label: "Main problem", value: t.mainProblem || "None" },
    { label: "Unique antibodies", value: String(t.uniqueAntibodies) },
    { label: "Clonal redundancy", value: percent(t.redundantShare) },
    { label: "Quality floor", value: floor },
  ];
});

// A sheet joins on plate and well, so a typo on either side silently leaves a
// measurement behind. Both directions are listed.
const sheetLists = computed(() =>
  [
    {
      label: "Wells no property reached",
      items: app.model.outputs.wellsWithoutProperties ?? [],
    },
    {
      label: "Sheet rows that hit no well",
      items: app.model.outputs.valuesWithoutWell ?? [],
    },
  ].filter((l) => l.items.length > 0),
);
</script>

<template>
  <!-- The map takes the full width, so the gutters come off on its tab. -->
  <PlBlockPage :no-body-gutters="tab === 'plateMap'">
    <template #title>Plate View</template>

    <template #append>
      <!-- The table puts its own controls (Filters, Columns) right before this slot.
           Every button's own padding spaces the row evenly. -->
      <div :class="$style.appended">
        <PlBtnGhost v-if="reasonGroups.length > 0" @click.stop="() => (reasonsOpen = true)">
          QC Reasons
          <template #append>
            <PlMaskIcon24 name="info-outline" />
          </template>
        </PlBtnGhost>
        <PlBtnGhost @click.stop="() => (statsOpen = true)">
          Stats
          <template #append>
            <PlMaskIcon24 name="statistics" />
          </template>
        </PlBtnGhost>
        <PlTabs v-model="tab" :class="$style.tabs" :options="TABS" :top-line="false" />
      </div>
    </template>

    <PlDataTableV2
      v-if="tab === 'metrics'"
      v-model="app.model.data.plateTableState"
      :settings="tableSettings"
      not-ready-text="Run the block to see how each plate came out."
      no-rows-text="No plates."
    />

    <GraphMaker
      v-else
      v-model="app.model.data.plateMapGraph"
      chart-type="heatmap"
      :data-state-key="app.model.outputs.plateMapPf"
      :p-frame="app.model.outputs.plateMapPf"
      :default-options="plateMapDefaults"
      :status-text="plateMapNotRun"
    />

    <!-- The title already ends in 24px of padding, so the content adds none on top. -->
    <PlDialogModal v-model="reasonsOpen" width="560px" no-top-content-gutter close-on-outside-click>
      <template #title>QC Reasons</template>
      <div :class="$style.reasons">
        <p :class="$style.note">
          Each well takes the first reason any of its chains has, in the order below.
        </p>
        <div :class="$style.groups">
          <section v-for="group in reasonGroups" :key="group.verdict" :class="$style.sheetList">
            <h3 :class="$style.heading">{{ group.verdict }}</h3>
            <dl :class="$style.help">
              <template v-for="r in group.reasons" :key="r.label">
                <dt>{{ r.label }}</dt>
                <dd>{{ r.help }}</dd>
              </template>
            </dl>
          </section>
        </div>
      </div>
    </PlDialogModal>

    <PlDialogModal v-model="statsOpen" width="448px" close-on-outside-click>
      <template #title>Stats</template>
      <table :class="$style.stats">
        <tbody>
          <tr v-for="s in stats" :key="s.label">
            <td>{{ s.label }}</td>
            <td :class="$style.value">{{ s.value }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="total && total.plates > 1" :class="$style.note">
        An antibody found on two plates counts on each plate's row, so the rows add up to more than
        the total here.
      </p>
      <section v-for="list in sheetLists" :key="list.label" :class="$style.sheetList">
        <h3 :class="$style.heading">{{ list.label }} ({{ list.items.length }})</h3>
        <ul :class="$style.items">
          <li v-for="item in list.items" :key="item">{{ item }}</li>
        </ul>
      </section>
    </PlDialogModal>
  </PlBlockPage>
</template>

<style module>
.appended {
  display: flex;
  align-items: center;
}

/* The buttons' own 12px padding already spaces them. The tabs have no side
   padding at their underline, so they get the button's 12px here. */
.tabs {
  margin-left: 12px;
}

.heading {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

/* The dialog already puts 24px between its children, so the blocks inside
   carry no margin of their own. */
.note {
  margin: 0;
  font-size: 12px;
  color: var(--txt-03);
}

.stats {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.stats td {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color-div-grey);
}

/* The note belongs to the lists below it, so it sits closer to them than the
   lists sit to each other. */
.reasons {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.sheetList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.value {
  text-align: right;
  font-family: var(--font-family-monospace);
}

.help {
  margin: 0;
}

.help dt {
  font-weight: 600;
  margin-top: 12px;
}

.help dt:first-child {
  margin-top: 0;
}

.help dd {
  margin: 2px 0 0;
  color: var(--txt-02);
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

<style scoped>
/* The heatmap has no cell border setting. Its cells are the only rects that set
   fill-opacity, so a white stroke on them draws a gap between wells. */
:deep(#chartSvgContainer rect[fill-opacity]) {
  stroke: #ffffff;
  stroke-width: 2px;
}

/* A well with no value is drawn white, which the border would hide. */
:deep(#chartSvgContainer rect[fill-opacity][fill="white"]) {
  fill: #eceef2;
}
</style>
