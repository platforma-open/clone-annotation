<script setup lang="ts">
import { computed } from "vue";
import type { PlateMap } from "./qc";
import { OUTCOME_LABELS, WELL_OUTCOMES } from "./qc";

const props = defineProps<{ map: PlateMap }>();

const legend = computed(() =>
  WELL_OUTCOMES.map((outcome) => ({
    outcome,
    label: OUTCOME_LABELS[outcome],
    count: props.map.counts[outcome],
  })).filter((entry) => entry.count > 0),
);
</script>

<template>
  <div :class="$style.plate">
    <div
      :class="$style.grid"
      :style="{ '--columns': map.columnLabels.length }"
      role="table"
      :aria-label="`Plate ${map.plate}`"
    >
      <div :class="$style.corner" />
      <div v-for="column in map.columnLabels" :key="column" :class="$style.columnHead">
        {{ column }}
      </div>

      <template v-for="(row, r) in map.grid" :key="map.rowLabels[r]">
        <div :class="$style.rowHead">{{ map.rowLabels[r] }}</div>
        <div
          v-for="cell in row"
          :key="cell.label"
          :class="[$style.well, $style[cell.outcome]]"
          :title="`${cell.label} — ${cell.note}`"
        />
      </template>
    </div>

    <div :class="$style.legend">
      <span v-for="entry in legend" :key="entry.outcome" :class="$style.legendItem">
        <span :class="[$style.swatch, $style[entry.outcome]]" />
        {{ entry.label }} ({{ entry.count }})
      </span>
    </div>

    <p v-if="map.offGrid.length > 0" :class="$style.offGrid">
      {{ map.offGrid.length }} well{{ map.offGrid.length === 1 ? "" : "s" }} on this plate have no
      row and column, so they sit outside the grid:
      {{ map.offGrid.map((c) => c.label).join(", ") }}
    </p>
  </div>
</template>

<style module>
.plate {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.grid {
  display: grid;
  grid-template-columns: 20px repeat(var(--columns), minmax(14px, 28px));
  gap: 2px;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
}

.corner {
  grid-column: 1;
}

.columnHead,
.rowHead {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--txt-03);
  font-family: var(--font-family-monospace);
}

.rowHead {
  justify-content: flex-end;
  padding-right: 4px;
}

.well {
  aspect-ratio: 1;
  border-radius: 3px;
  border: 1px solid transparent;
}

.well:hover {
  outline: 1px solid var(--txt-01);
}

.ok {
  background: light-dark(#c9f0b6, #305c3e);
}

.flagged {
  background: light-dark(#fee0a3, #754f2d);
}

.notDescribed {
  background: light-dark(#ffb8b8, #8f3343);
}

.noRead {
  background: light-dark(#cfd1db, #3d3d42);
}

.empty {
  background: transparent;
  border: 1px dashed var(--border-color-div-grey);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 12px;
  color: var(--txt-03);
}

.legendItem {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid transparent;
}

.offGrid {
  margin: 0;
  font-size: 12px;
  color: var(--txt-03);
}
</style>
