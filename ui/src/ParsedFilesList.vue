<script setup lang="ts">
import { highlightMatch } from "@platforma-open/milaboratories.clone-annotation.model";
import { computed, useCssModule } from "vue";
import type { SelectedFile } from "./trace_set";

const props = defineProps<{ items: SelectedFile[] }>();

const formattedHtml = computed(() => {
  const styles = useCssModule();
  const wrap = (cls: string) => ({ begin: `<span class="${styles[cls]}">`, end: "</span>" });
  const opts = {
    plate: wrap("plate"),
    well: wrap("well"),
    chain: wrap("chain"),
    direction: wrap("direction"),
    tag: wrap("tag"),
  };
  return props.items
    .map((f) =>
      f.match
        ? `<pre>${highlightMatch(f.relativePath, f.match, opts)}</pre>`
        : `<pre class="${styles["unmatched"]}">${f.relativePath}</pre>`,
    )
    .join("");
});

const matched = computed(() => props.items.filter((f) => f.match).length);
const unmatched = computed(() => props.items.length - matched.value);
</script>

<template>
  <div :class="$style.container">
    <span :class="$style.matchText">
      {{ matched }} file(s) matched
      <span :class="$style.unmatchedText">
        &nbsp;&nbsp;/&nbsp;&nbsp;{{ unmatched }} file(s) not matched
      </span>
    </span>
    <div :class="$style.fileList" class="pl-scrollable" v-html="formattedHtml" />
  </div>
</template>

<style module>
.container {
  border-top: 1px solid var(--border-color-div-grey);
  max-height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.matchText {
  display: flex;
  height: 40px;
  padding: 12px 0;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.unmatchedText {
  color: var(--dis-01);
}

.fileList {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  max-height: 100%;
  gap: 0;
}

.fileList pre {
  line-height: 22px;
  margin: 0;
  font-family: var(--font-family-monospace);
}

.fileList pre span {
  line-height: inherit;
  min-height: 100%;
  display: inline-block;
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

.unmatched {
  background-color: #e1e3eb;
}
</style>
