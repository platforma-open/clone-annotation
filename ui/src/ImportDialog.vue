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
  PlBtnSecondary,
  PlDialogModal,
  PlDropdown,
  PlFileDialog,
  PlProgressCell,
  PlRow,
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
  isMultiRecordForm,
} from "./trace_set";

const app = useApp();

// The combined early-commit below writes the picked files straight to the live
// model, so prerun can read their headers. The form rides along, because prerun
// reads @-lines for FASTQ and >-lines otherwise. If the scientist cancels instead
// of importing, these fields are put back to what they were before the dialog.
const saved = {
  form: app.model.data.form,
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
  fileShape: app.model.data.fileShape as "perFile" | "combined" | undefined,
  pattern: app.model.data.namePattern ?? "",
  files: [...(app.model.data.traceFiles ?? [])],
  filePickerOpen: true,
  formOpen: false,
});

// A combined FASTA keys on the record header, so its example is a header; the
// other shapes key on the file path. Vue reads `{{` as interpolation, so the
// token examples live here, not in the template.
const example = computed(() => {
  if (isMultiRecordForm(draft.form)) {
    const ext = draft.form === "fastqNt" ? ".fastq" : ".fasta";
    return draft.fileShape === "combined"
      ? "{{Name}}_{{Chain}}"
      : `{{Plate}}/{{Well}}_{{Chain}}${ext}`;
  }
  return "{{Plate}}_{{Chain}}_{{Direction}}_{{Well}}.ab1";
});

const isCombined = computed(() => isMultiRecordForm(draft.form) && draft.fileShape === "combined");

// The dropdown stays on screen for traces, so the row does not reflow when the
// input type changes. A trace is always one per file, so it shows that, locked.
const fileShapeShown = computed({
  get: () => (isMultiRecordForm(draft.form) ? draft.fileShape : "perFile"),
  set: (v) => {
    if (isMultiRecordForm(draft.form)) draft.fileShape = v;
  },
});

// Closing both is how the scientist cancels out of importing altogether.
watch(
  () => draft.filePickerOpen || draft.formOpen,
  (anyOpen) => {
    if (anyOpen) return;
    // Cancelled without importing: undo the combined early-commit so the model
    // does not keep a set the scientist backed out of.
    if (!imported) {
      app.model.data.form = saved.form;
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
  [() => isCombined.value, () => draft.files, () => draft.form],
  () => {
    if (!isCombined.value) return;
    app.model.data.form = draft.form;
    app.model.data.fileShape = "combined";
    const current = app.model.data.traceFiles ?? [];
    const changed =
      current.length !== draft.files.length || draft.files.some((f, i) => f !== current[i]);
    app.model.data.traceFiles = [...draft.files];
    // The headers belong to the previous selection. Dropping them makes Import
    // wait for prerun to read the current files, so a removed file cannot be
    // imported and an emptied selection disables Import.
    if (changed) app.model.data.fastaHeaders = [];
  },
  { immediate: true, deep: true },
);

const headers = computed(() => (isCombined.value ? (app.model.data.fastaHeaders ?? []) : []));
const headersReady = computed(() => !isCombined.value || headers.value.length > 0);

// A multi-record form shows nothing and imports nothing until its file format is
// picked. A trace is always one file per clone, so it needs no pick.
const formatChosen = computed(
  () => !isMultiRecordForm(draft.form) || draft.fileShape !== undefined,
);
const ready = computed(() => formatChosen.value && headersReady.value);

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
    ready.value &&
    matchedCount.value > 0,
);

function addFiles(handles: ImportFileHandle[]) {
  const wasEmpty = draft.files.length === 0;
  const seen = new Set(draft.files);
  draft.files = [...draft.files, ...handles.filter((h) => !seen.has(h))];
  // The first selection guesses the input type; a later addition keeps the form
  // the scientist set, so adding a file to an amino-acid set does not revert it
  // to nucleotide (guessForm cannot tell protein from DNA). The dropdown corrects it.
  if (wasEmpty) draft.form = guessForm(draft.files);
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
  // Only a FASTA or FASTQ set can be combined; a trace is one record per file.
  app.model.data.fileShape = isMultiRecordForm(draft.form) ? draft.fileShape : "perFile";
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
    <template #title>Import files</template>

    <PlRow alignCenter>
      <PlTextField
        v-model="draft.name"
        label="Dataset Name"
        :clearable="() => ''"
        class="flex-grow-1"
      />
      <PlDropdown
        v-model="draft.form"
        :options="INPUT_FORM_OPTIONS"
        :required="true"
        label="Input type"
        :style="{ flexBasis: '260px', flexShrink: 0 }"
      >
        <template #tooltip>
          What kind of sequence files you are loading; all of them are read as this one type. A
          Sanger trace is a chromatogram from Sanger sequencing. FASTA holds plain sequences,
          nucleotide or amino acid. FASTQ holds reads with a quality score for each base.
        </template>
      </PlDropdown>
      <PlDropdown
        v-model="fileShapeShown"
        :disabled="!isMultiRecordForm(draft.form)"
        :options="FILE_SHAPE_OPTIONS"
        :required="true"
        label="File format"
        :style="{ flexBasis: '220px', flexShrink: 0 }"
      >
        <template #tooltip>
          How your sequences are stored. Choose "One sequence per file" when each file holds a
          single sequence. Choose "Multi sequence file" when one file holds many sequences, each
          with its own header line.
        </template>
      </PlDropdown>
    </PlRow>

    <!-- One group, so its parts sit closer than the dialog's own gap between sections. -->
    <div class="pattern">
      <PlTextField
        v-model="draft.pattern"
        label="Pattern"
        :placeholder="example"
        :error="compiled.error"
        clearable
      >
        <template #append>
          <PatternHelp />
        </template>
      </PlTextField>

      <PatternBuilder v-if="ready" v-model="draft.pattern" :files="parsed" />

      <!-- PlProgressCell is height:100% with an absolute body, so it needs a sized parent. -->
      <div v-if="isCombined && !headersReady" class="headers-loader">
        <PlProgressCell stage="running" step="Reading record headers…" />
      </div>

      <FieldValues v-if="ready && matchedCount > 0" :fields="fields" />

      <ul v-if="ready && warnings.length" class="warnings" data-testid="pattern-warnings">
        <li v-for="w in warnings" :key="w">{{ w }}</li>
      </ul>
    </div>

    <ParsedFilesList :items="parsed" :unit="isCombined ? 'header' : 'file'" @remove="removeFiles" />

    <PlBtnSecondary @click="() => (draft.filePickerOpen = true)">+ add more files</PlBtnSecondary>

    <template #actions>
      <PlBtnPrimary :disabled="!canImport" @click="doImport">Import</PlBtnPrimary>
      <PlBtnGhost @click.stop="() => (draft.formOpen = false)">Cancel</PlBtnGhost>
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

.warnings {
  margin: 0;
  padding-left: 18px;
  font-size: 14px;
  color: var(--warn-01, #b36b00);
}

.headers-loader {
  height: 40px;
}
</style>
