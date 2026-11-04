<script setup lang="ts">
import type { ImportFileHandle } from "@platforma-open/milaboratories.clone-annotation.model";
import { highlightMatch } from "@platforma-open/milaboratories.clone-annotation.model";
import { computed, useCssModule } from "vue";
import { groupSelection } from "./selection_summary";
import type { SelectedFile } from "./trace_set";

const props = defineProps<{ items: SelectedFile[] }>();
const emit = defineEmits<{ remove: [handles: ImportFileHandle[]] }>();

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const styles = useCssModule();

const position = computed(() => new Map(props.items.map((f, i) => [f, i])));

const toHtml = computed(() => {
  const wrap = (cls: string) => ({
    begin: `<span class="${styles[cls]}">`,
    end: "</span>",
  });
  const opts = {
    plate: wrap("plate"),
    well: wrap("well"),
    chain: wrap("chain"),
    direction: wrap("direction"),
    tag: wrap("tag"),
  };
  return (files: SelectedFile[]) =>
    files
      .map((f) => {
        const text = f.match
          ? `<pre>${highlightMatch(f.relativePath, f.match, opts)}</pre>`
          : `<pre class="${styles["unmatched"]}">${escapeHtml(f.relativePath)}</pre>`;
        const remove = `<button type="button" class="${styles["remove"]}" data-remove="${position.value.get(f)}" title="Remove from the list" aria-label="Remove ${escapeHtml(f.relativePath)}">×</button>`;
        return `<div class="${styles["row"]}">${remove}${text}</div>`;
      })
      .join("");
});

const groups = computed(() => groupSelection(props.items));
const collidingFiles = computed(() => groups.value.collisions.flat().length);
const unmatchedFiles = computed(() =>
  groups.value.unmatched.reduce((n, g) => n + g.files.length, 0),
);
const hasProblems = computed(() => collidingFiles.value + unmatchedFiles.value > 0);

// The rows are plain HTML, so one listener on the list serves every remove button.
function onListClick(e: MouseEvent) {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-remove]");
  const file = button ? props.items[Number(button.dataset["remove"])] : undefined;
  if (file) emit("remove", [file.handle]);
}
</script>

<template>
  <div :class="$style.container">
    <span :class="$style.matchText">
      {{ items.length - unmatchedFiles }} file(s) matched
      <span :class="$style.unmatchedText">
        &nbsp;&nbsp;/&nbsp;&nbsp;{{ unmatchedFiles }} file(s) not matched
      </span>
    </span>
    <div :class="$style.fileList" class="pl-scrollable" @click="onListClick">
      <details v-if="groups.collisions.length" open data-testid="collisions">
        <summary :class="$style.problem">
          {{ collidingFiles }} file(s) claim the same plate, well, chain and direction
        </summary>
        <div
          v-for="(g, i) in groups.collisions"
          :key="i"
          :class="$style.collision"
          v-html="toHtml(g)"
        />
      </details>
      <details v-for="g in groups.unmatched" :key="g.reason ?? ''" open data-testid="unmatched">
        <summary :class="$style.problem">
          {{ g.files.length }} file(s) not matched{{ g.reason ? `: ${g.reason}` : "" }}
          <button
            v-if="g.reason"
            type="button"
            :class="$style.removeAll"
            @click.prevent.stop="
              emit(
                'remove',
                g.files.map((f) => f.handle),
              )
            "
          >
            Remove these files
          </button>
        </summary>
        <div v-html="toHtml(g.files)" />
      </details>
      <details v-if="groups.matched.length" :open="!hasProblems" data-testid="matched">
        <summary>{{ groups.matched.length }} file(s) matched without problems</summary>
        <div v-html="toHtml(groups.matched)" />
      </details>
    </div>
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

.fileList summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  line-height: 28px;
}

.problem {
  color: var(--err-01, #c0392b);
}

.collision {
  border-left: 2px solid var(--err-01, #c0392b);
  padding-left: 6px;
  margin-bottom: 6px;
}

.row {
  display: flex;
  align-items: center;
}

.remove {
  flex: none;
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  color: var(--txt-03);
  cursor: pointer;
  font-size: 14px;
  visibility: hidden;
}

.row:hover .remove,
.remove:focus-visible {
  visibility: visible;
}

.remove:hover {
  color: var(--err-01, #c0392b);
}

.removeAll {
  margin-left: 8px;
  border: none;
  background: none;
  padding: 0;
  color: var(--txt-link, #5f31cc);
  cursor: pointer;
  font-size: 12px;
  font-weight: 400;
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
