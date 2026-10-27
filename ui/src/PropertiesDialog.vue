<script setup lang="ts">
import type {
  ImportFileHandle,
  PropertyType,
} from "@platforma-open/milaboratories.clone-annotation.model";
import type { ListOption } from "@platforma-sdk/ui-vue";
import {
  PlAlert,
  PlBtnGhost,
  PlBtnPrimary,
  PlDialogModal,
  PlDropdown,
  PlFileDialog,
  PlLogView,
  ReactiveFileContent,
} from "@platforma-sdk/ui-vue";
import { computed, reactive, watch } from "vue";
import { useApp } from "./app";
import {
  buildProperties,
  duplicateKeyCount,
  guessPlateColumn,
  guessType,
  guessWellColumn,
} from "./properties";
import type { Sheet } from "./sheet";
import { readSheet } from "./sheet";

const app = useApp();
const reactiveFileContent = ReactiveFileContent.useGlobal();

/** What one column of the sheet does: become a property of that type, or stay out. */
type Action = PropertyType | "ignore";

const IGNORE: Action = "ignore";

const ACTION_OPTIONS: ListOption<Action>[] = [
  { value: "Double", label: "Number" },
  { value: "Long", label: "Whole number" },
  { value: "String", label: "Text" },
  { value: IGNORE, label: "Do not import" },
];

const draft = reactive({
  filePickerOpen: app.model.data.propertyFile === undefined,
  formOpen: app.model.data.propertyFile !== undefined,
  plateColumn: app.model.data.propertyMapping?.plateColumn ?? "",
  wellColumn: app.model.data.propertyMapping?.wellColumn ?? "",
  actions: {} as Record<string, Action>,
});

watch(
  () => draft.filePickerOpen || draft.formOpen,
  (anyOpen) => {
    if (!anyOpen) app.showPropertiesDialog = false;
  },
);

const bytes = computed(() => {
  const handle = app.model.outputs.propertyFileContent;
  return handle ? reactiveFileContent.getContentBytes(handle.handle)?.value : undefined;
});

const sheet = computed(() => (bytes.value ? readSheet(bytes.value) : undefined));

/**
 * The identifier columns and every column's type are guessed once, when the
 * sheet arrives. They are a starting point the scientist corrects, never a
 * decision: a guess that cannot be overridden is the thing R23 forbids.
 */
watch(sheet, (s) => {
  if (!s) return;
  if (draft.wellColumn === "") draft.wellColumn = guessWellColumn(s) ?? "";
  if (draft.plateColumn === "") draft.plateColumn = guessPlateColumn(s, draft.wellColumn) ?? "";
  const chosen = app.model.data.propertyMapping?.propertyColumns;
  for (const c of s.columns) {
    if (draft.actions[c] !== undefined) continue;
    const declined = chosen !== undefined && !chosen.includes(c);
    draft.actions[c] = declined ? IGNORE : guessColumnType(s, c);
  }
});

function guessColumnType(s: Sheet, column: string): PropertyType {
  return guessType(s.rows.map((r) => r[column] ?? "").filter((v) => v !== ""));
}

const columnOptions = computed<ListOption<string>[]>(() =>
  (sheet.value?.columns ?? []).map((c) => ({ value: c, label: c })),
);

/** Columns the scientist chooses an action for: everything but the identifiers. */
const mappableColumns = computed(() =>
  (sheet.value?.columns ?? []).filter((c) => c !== draft.wellColumn && c !== draft.plateColumn),
);

const carried = computed(() => mappableColumns.value.filter((c) => draft.actions[c] !== IGNORE));

const canSave = computed(() => draft.wellColumn !== "" && carried.value.length > 0);

const duplicates = computed(() => {
  const s = sheet.value;
  if (!s || draft.wellColumn === "") return 0;
  return duplicateKeyCount(s, {
    plateColumn: draft.plateColumn || undefined,
    wellColumn: draft.wellColumn,
    propertyColumns: [],
    types: {},
  });
});

const rowsWithoutWell = computed(() => {
  const s = sheet.value;
  if (!s || draft.wellColumn === "") return 0;
  return s.rows.filter((r) => r[draft.wellColumn] === undefined).length;
});

const summary = computed(() => {
  const s = sheet.value;
  if (!s) return "";
  const skipped = mappableColumns.value.length - carried.value.length;
  let text = `Rows: ${s.rows.length}\n`;
  text += `Sheet columns: ${s.columns.length}`;
  text += ` (${carried.value.length} carried as properties, ${skipped} skipped)\n`;
  text += `Plate: ${draft.plateColumn || "one plate for the whole sheet"}`;
  return text;
});

function pickFile(handles: ImportFileHandle[]) {
  const file = handles[0];
  if (!file) return;
  app.model.data.propertyFile = file;
  draft.formOpen = true;
}

function save() {
  const s = sheet.value;
  if (!s) return;
  const types: Record<string, PropertyType> = {};
  for (const c of carried.value) types[c] = draft.actions[c] as PropertyType;
  const mapping = {
    plateColumn: draft.plateColumn || undefined,
    wellColumn: draft.wellColumn,
    propertyColumns: carried.value,
    types,
  };
  app.model.data.propertyMapping = mapping;
  // The file is parsed once, here. What reaches the workflow is the mapped
  // result, as samples-and-data does with its metadata columns.
  app.model.data.properties = buildProperties(s, mapping);
  draft.formOpen = false;
}
</script>

<template>
  <PlDialogModal v-model="draft.formOpen" width="60%" :close-on-outside-click="false">
    <template #title>Import properties</template>

    <p v-if="!sheet" class="waiting">Reading the sheet…</p>

    <template v-else>
      <PlDropdown
        v-model="draft.wellColumn"
        label="Well column"
        placeholder="Which column holds the well"
        :options="columnOptions"
      />

      <PlDropdown
        v-model="draft.plateColumn"
        label="Plate column"
        placeholder="Leave empty if the sheet covers one plate"
        :options="columnOptions"
        clearable
      />

      <PlDropdown
        v-for="column in mappableColumns"
        :key="column"
        v-model="draft.actions[column]"
        :label="column"
        :options="ACTION_OPTIONS"
      />

      <PlAlert v-if="duplicates > 0" type="warn" icon>
        {{ duplicates }} row(s) land on a well another row already claimed. The last one wins, so
        the earlier readings are lost. Add a plate column if the sheet covers more than one plate.
      </PlAlert>
      <PlAlert v-if="rowsWithoutWell > 0" type="warn" icon>
        {{ rowsWithoutWell }} row(s) name no well and reach no clone.
      </PlAlert>

      <PlLogView :value="summary" label="Import information" />
    </template>

    <template #actions>
      <PlBtnPrimary :disabled="!canSave" @click="save">Import</PlBtnPrimary>
      <PlBtnGhost @click.stop="() => (draft.formOpen = false)">Cancel</PlBtnGhost>
    </template>
  </PlDialogModal>

  <PlFileDialog
    v-model="draft.filePickerOpen"
    :extensions="['csv', 'tsv', 'xlsx', 'xls']"
    title="Select a sheet of measurements"
    @import:files="(e) => pickFile(e.files)"
  />
</template>

<style scoped>
.waiting {
  margin: 0 0 12px;
  font-size: 12px;
  opacity: 0.75;
}
</style>
