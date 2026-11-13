<script setup lang="ts">
import { computed, reactive } from "vue";
import type { FieldSummary } from "./selection_summary";

const props = defineProps<{ fields: FieldSummary[] }>();

// Folded to one line by default: the counts are what tells a wrong part apart,
// and the values themselves are there when someone wants to look.
const summary = computed(() =>
  props.fields.map((f) => `${f.label}: ${f.values.length}`).join(" · "),
);

const SHOWN = 12;
const expanded = reactive(new Set<string>());

function toggle(label: string) {
  if (expanded.has(label)) expanded.delete(label);
  else expanded.add(label);
}
</script>

<template>
  <details :class="$style.details" data-testid="field-values">
    <summary :class="$style.summary">
      Values found <span :class="$style.counts">{{ summary }}</span>
    </summary>
    <div :class="$style.fields">
      <template v-for="f in fields" :key="f.label">
        <span :class="$style.label">{{ f.label }}</span>
        <span :class="$style.values">
          <span :class="$style.distinct">{{ f.values.length }} value(s)</span>
          <span
            v-for="v in expanded.has(f.label) ? f.values : f.values.slice(0, SHOWN)"
            :key="v.value"
            :class="[$style.chip, $style[f.kind]]"
          >
            {{ v.value === "" ? "(empty)" : v.value }}
            <span :class="$style.count">{{ v.count }}</span>
          </span>
          <button
            v-if="f.values.length > SHOWN"
            type="button"
            :class="$style.more"
            @click="toggle(f.label)"
          >
            {{ expanded.has(f.label) ? "show less" : `and ${f.values.length - SHOWN} more` }}
          </button>
        </span>
      </template>
    </div>
  </details>
</template>

<style module>
.details {
  font-size: 14px;
}

.summary {
  cursor: pointer;
  font-weight: 600;
  line-height: 22px;
}

.counts {
  margin-left: 8px;
  font-weight: 400;
  color: var(--txt-03);
}

.fields {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 12px;
  margin-top: 6px;
}

.label {
  font-weight: 600;
  line-height: 22px;
}

.values {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.distinct {
  color: var(--txt-03);
  margin-right: 4px;
}

.chip {
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-family-monospace);
}

.count {
  color: var(--txt-03);
}

.more {
  border: none;
  background: none;
  padding: 0 4px;
  color: var(--txt-link, #5f31cc);
  cursor: pointer;
  font-size: 14px;
}

.plate {
  background-color: #dedbff;
}

.well {
  background-color: #d0f0c0;
}

.chain {
  background-color: #faf5aa;
}

.direction {
  background-color: #ffe0cc;
}

.tag {
  background-color: #e8e8e8;
}
</style>
