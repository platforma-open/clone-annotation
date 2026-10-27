<script setup lang="ts">
import type { ImportFileHandle } from "@platforma-open/milaboratories.clone-annotation.model";
import { DEFAULT_NAME } from "@platforma-open/milaboratories.clone-annotation.model";
import {
  PlBtnGhost,
  PlBtnPrimary,
  PlBtnSecondary,
  PlDialogModal,
  PlFileDialog,
  PlTextField,
} from "@platforma-sdk/ui-vue";
import { computed, reactive, watch } from "vue";
import { useApp } from "./app";
import ParsedFilesList from "./ParsedFilesList.vue";
import PatternHelp from "./PatternHelp.vue";
import { compilePattern, describeSelection, TRACE_EXTENSIONS } from "./trace_set";

const app = useApp();

// Vue's template compiler reads `{{` as an interpolation, so token examples
// cannot be written literally in the template.
const EXAMPLE = "{{Plate}}_{{Chain}}_{{Direction}}_{{Well}}.ab1";

// The component is mounted only while importing, so its state starts fresh each
// time: the picker is open, the form is not. The form appears once files arrive.
const draft = reactive({
  name: app.model.data.name || DEFAULT_NAME,
  pattern: app.model.data.namePattern ?? "",
  files: [...(app.model.data.traceFiles ?? [])],
  filePickerOpen: true,
  formOpen: false,
});

// Closing both is how the scientist cancels out of importing altogether.
watch(
  () => draft.filePickerOpen || draft.formOpen,
  (anyOpen) => {
    if (!anyOpen) app.showImportDialog = false;
  },
);

const compiled = computed(() => compilePattern(draft.pattern));
const parsed = computed(() => describeSelection(draft.files, compiled.value.pattern));
const matchedCount = computed(() => parsed.value.filter((f) => f.match).length);

/** Two files claiming one identity means one of them will be lost silently. */
const collisions = computed(() => {
  const seen = new Map<string, number>();
  for (const f of parsed.value) {
    if (!f.match) continue;
    const key = [
      f.match.plate?.value ?? "",
      f.match.well.value,
      f.match.chain?.value ?? "",
      f.match.direction?.value ?? "",
    ].join("\u0000");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].filter((n) => n > 1).length;
});

const canImport = computed(
  () => draft.name.trim() !== "" && compiled.value.pattern !== undefined && matchedCount.value > 0,
);

function addFiles(handles: ImportFileHandle[]) {
  const seen = new Set(draft.files);
  draft.files = [...draft.files, ...handles.filter((h) => !seen.has(h))];
  draft.formOpen = true;
}

function doImport() {
  app.model.data.name = draft.name.trim();
  app.model.data.namePattern = draft.pattern;
  app.model.data.traceFiles = draft.files;
  draft.formOpen = false;
}
</script>

<template>
  <PlDialogModal
    v-model="draft.formOpen"
    width="70%"
    :close-on-outside-click="false"
    data-testid="import-dialog"
  >
    <template #title>Import traces</template>

    <PlTextField v-model="draft.name" label="Dataset Name" :clearable="() => ''" />

    <div class="pattern-row">
      <PlTextField
        v-model="draft.pattern"
        label="Pattern"
        :placeholder="EXAMPLE"
        :error="compiled.error"
        clearable
      />
      <PatternHelp />
    </div>

    <p v-if="collisions" class="collisions">
      {{ collisions }} identity collision(s): more than one file claims the same plate, well, chain
      and direction.
    </p>

    <ParsedFilesList :items="parsed" />

    <PlBtnSecondary @click="() => (draft.filePickerOpen = true)">Add more files</PlBtnSecondary>

    <template #actions>
      <PlBtnPrimary :disabled="!canImport" @click="doImport">Import</PlBtnPrimary>
      <PlBtnGhost @click.stop="() => (draft.formOpen = false)">Cancel</PlBtnGhost>
    </template>
  </PlDialogModal>

  <PlFileDialog
    v-model="draft.filePickerOpen"
    :multi="true"
    :extensions="TRACE_EXTENSIONS"
    title="Select files to import"
    @import:files="(e) => addFiles(e.files)"
  />
</template>

<style scoped>
.pattern-row {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

.pattern-row > :first-child {
  flex: 1;
}

.collisions {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--err-01, #c0392b);
}
</style>
