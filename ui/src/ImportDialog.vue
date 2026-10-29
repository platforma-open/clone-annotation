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
import FieldValues from "./FieldValues.vue";
import PatternBuilder from "./PatternBuilder.vue";
import PatternHelp from "./PatternHelp.vue";
import { checkSelection, summarizeFields } from "./selection_summary";
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

const fields = computed(() =>
  compiled.value.pattern ? summarizeFields(parsed.value, compiled.value.pattern) : [],
);

const warnings = computed(() =>
  compiled.value.pattern ? checkSelection(parsed.value, compiled.value.pattern) : [],
);

const canImport = computed(
  () => draft.name.trim() !== "" && compiled.value.pattern !== undefined && matchedCount.value > 0,
);

function addFiles(handles: ImportFileHandle[]) {
  const seen = new Set(draft.files);
  draft.files = [...draft.files, ...handles.filter((h) => !seen.has(h))];
  draft.formOpen = true;
}

function removeFiles(handles: ImportFileHandle[]) {
  const drop = new Set(handles);
  draft.files = draft.files.filter((h) => !drop.has(h));
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

    <PatternBuilder v-model="draft.pattern" :files="parsed" />

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

    <FieldValues v-if="matchedCount > 0" :fields="fields" />

    <ul v-if="warnings.length" class="warnings" data-testid="pattern-warnings">
      <li v-for="w in warnings" :key="w">{{ w }}</li>
    </ul>

    <ParsedFilesList :items="parsed" @remove="removeFiles" />

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

.warnings {
  margin: 0 0 8px;
  padding-left: 18px;
  font-size: 12px;
  color: var(--warn-01, #b36b00);
}
</style>
