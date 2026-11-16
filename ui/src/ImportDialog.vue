<script setup lang="ts">
import type {
  ImportFileHandle,
  InputForm,
} from "@platforma-open/milaboratories.clone-annotation.model";
import {
  DEFAULT_NAME,
  FILE_SHAPE_OPTIONS,
  INPUT_FORM_OPTIONS,
} from "@platforma-open/milaboratories.clone-annotation.model";
import {
  PlBtnGhost,
  PlBtnPrimary,
  PlDialogModal,
  PlDropdown,
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
import {
  ALL_EXTENSIONS,
  compilePattern,
  describeCombined,
  describeSelection,
  guessForm,
} from "./trace_set";

const app = useApp();

// The combined early-commit below writes the picked files straight to the live
// model, so prerun can read their headers. If the scientist cancels instead of
// importing, these three fields are put back to what they were before the dialog.
const saved = {
  fileShape: app.model.data.fileShape,
  traceFiles: app.model.data.traceFiles,
  fastaHeaders: app.model.data.fastaHeaders,
};
let imported = false;

// The component is mounted only while importing, so its state starts fresh each
// time: the picker is open, the form is not. The form appears once files arrive,
// and its input type is guessed from what was selected.
const draft = reactive({
  name: app.model.data.name || DEFAULT_NAME,
  form: (app.model.data.form ?? "trace") as InputForm,
  fileShape: (app.model.data.fileShape ?? "perFile") as "perFile" | "combined",
  pattern: app.model.data.namePattern ?? "",
  files: [...(app.model.data.traceFiles ?? [])],
  filePickerOpen: true,
  formOpen: false,
});

// A combined FASTA keys on the record header, so its example is a header; the
// other shapes key on the file path. Vue reads `{{` as interpolation, so the
// token examples live here, not in the template.
const example = computed(() => {
  if (draft.form === "fastaNt") {
    return draft.fileShape === "combined"
      ? "{{Name}}_{{Chain}}"
      : "{{Plate}}/{{Well}}_{{Chain}}.fasta";
  }
  return "{{Plate}}_{{Chain}}_{{Direction}}_{{Well}}.ab1";
});

const isCombined = computed(() => draft.form === "fastaNt" && draft.fileShape === "combined");
const title = computed(() => (draft.form === "fastaNt" ? "Import FASTA" : "Import traces"));

// Closing both is how the scientist cancels out of importing altogether.
watch(
  () => draft.filePickerOpen || draft.formOpen,
  (anyOpen) => {
    if (anyOpen) return;
    // Cancelled without importing: undo the combined early-commit so the model
    // does not keep a set the scientist backed out of.
    if (!imported) {
      app.model.data.fileShape = saved.fileShape;
      app.model.data.traceFiles = saved.traceFiles;
      app.model.data.fastaHeaders = saved.fastaHeaders;
    }
    app.showImportDialog = false;
  },
);

const compiled = computed(() => compilePattern(draft.pattern));

// Switching the input type or file shape changes what the pattern matches: a file
// path versus a record header. The old pattern no longer fits, so it is cleared
// and the builder re-derives from the new example. This does not fire on mount, so
// a reopened dialog keeps the saved pattern.
watch([() => draft.form, () => draft.fileShape], () => {
  draft.pattern = "";
});

// A combined set commits its files as soon as they are picked, so prerun reads
// the record headers and the scientist can build the pattern against them. The
// headers come back in BlockData.fastaHeaders. Every other shape waits for Import.
watch(
  [() => isCombined.value, () => draft.files],
  () => {
    if (isCombined.value && draft.files.length > 0) {
      app.model.data.fileShape = "combined";
      app.model.data.traceFiles = [...draft.files];
    }
  },
  { immediate: true, deep: true },
);

const headers = computed(() => (isCombined.value ? (app.model.data.fastaHeaders ?? []) : []));
const headersReady = computed(() => !isCombined.value || headers.value.length > 0);

// For combined, match each record header; otherwise match each file's path.
const parsed = computed(() =>
  isCombined.value
    ? describeCombined(headers.value, compiled.value.pattern)
    : describeSelection(draft.files, compiled.value.pattern),
);
const matchedCount = computed(() => parsed.value.filter((f) => f.match).length);

const fields = computed(() =>
  compiled.value.pattern ? summarizeFields(parsed.value, compiled.value.pattern) : [],
);

const warnings = computed(() =>
  compiled.value.pattern ? checkSelection(parsed.value, compiled.value.pattern) : [],
);

const canImport = computed(
  () =>
    draft.name.trim() !== "" &&
    compiled.value.pattern !== undefined &&
    headersReady.value &&
    matchedCount.value > 0,
);

function addFiles(handles: ImportFileHandle[]) {
  const seen = new Set(draft.files);
  draft.files = [...draft.files, ...handles.filter((h) => !seen.has(h))];
  // The selection decides the input type; the dropdown stays, to correct it.
  draft.form = guessForm(draft.files);
  draft.formOpen = true;
}

function removeFiles(handles: ImportFileHandle[]) {
  const drop = new Set(handles);
  draft.files = draft.files.filter((h) => !drop.has(h));
}

function doImport() {
  // The close watcher must not roll back once the set is actually imported.
  imported = true;
  app.model.data.name = draft.name.trim();
  app.model.data.form = draft.form;
  // Only a FASTA set can be combined; every other form is one record per file.
  app.model.data.fileShape = draft.form === "fastaNt" ? draft.fileShape : "perFile";
  app.model.data.namePattern = draft.pattern;
  app.model.data.traceFiles = draft.files;
  draft.formOpen = false;
  // The settings decide what the run does with the files, so they come next.
  app.showSettings = true;
}
</script>

<template>
  <PlDialogModal
    v-model="draft.formOpen"
    width="70%"
    :close-on-outside-click="false"
    data-testid="import-dialog"
  >
    <template #title>{{ title }}</template>

    <PlDropdown
      v-model="draft.form"
      :options="INPUT_FORM_OPTIONS"
      :required="true"
      label="Input type"
    >
      <template #tooltip>
        What the files hold. The whole set is one form. A Sanger trace is read and merged; a
        nucleotide FASTA is read as it stands.
      </template>
    </PlDropdown>

    <PlDropdown
      v-if="draft.form === 'fastaNt'"
      v-model="draft.fileShape"
      :options="FILE_SHAPE_OPTIONS"
      :required="true"
      label="File shape"
    >
      <template #tooltip>
        Whether each file holds one record (identity in the file name) or one file holds many
        records (identity in each record's header).
      </template>
    </PlDropdown>

    <PlTextField v-model="draft.name" label="Dataset Name" :clearable="() => ''" />

    <!-- One group, so its parts sit closer than the dialog's own gap between sections. -->
    <div class="pattern">
      <PatternBuilder v-if="headersReady" v-model="draft.pattern" :files="parsed" />

      <div class="pattern-row">
        <PlTextField
          v-model="draft.pattern"
          label="Pattern"
          :placeholder="example"
          :error="compiled.error"
          clearable
        />
        <PatternHelp />
      </div>

      <p v-if="isCombined && !headersReady" class="note">Reading record headers…</p>

      <FieldValues v-if="headersReady && matchedCount > 0" :fields="fields" />

      <ul v-if="headersReady && warnings.length" class="warnings" data-testid="pattern-warnings">
        <li v-for="w in warnings" :key="w">{{ w }}</li>
      </ul>
    </div>

    <ParsedFilesList :items="parsed" :unit="isCombined ? 'header' : 'file'" @remove="removeFiles" />

    <template #actions>
      <PlBtnPrimary :disabled="!canImport" @click="doImport">Import</PlBtnPrimary>
      <PlBtnGhost @click.stop="() => (draft.formOpen = false)">Cancel</PlBtnGhost>
      <PlBtnGhost class="add-files" icon="add" @click="() => (draft.filePickerOpen = true)">
        Add more files
      </PlBtnGhost>
    </template>
  </PlDialogModal>

  <PlFileDialog
    v-model="draft.filePickerOpen"
    :multi="true"
    :extensions="ALL_EXTENSIONS"
    title="Select files to import"
    @import:files="(e) => addFiles(e.files)"
  />
</template>

<style scoped>
.pattern {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pattern-row {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

.pattern-row > :first-child {
  flex: 1;
}

.add-files {
  margin-left: auto;
}

.warnings {
  margin: 0;
  padding-left: 18px;
  font-size: 14px;
  color: var(--warn-01, #b36b00);
}

.note {
  margin: 0;
  font-size: 14px;
  color: var(--txt-03, #6b7280);
}
</style>
