import type {
  FastaHeader,
  ImportFileHandle,
} from "@platforma-open/milaboratories.clone-annotation.model";
import { platforma } from "@platforma-open/milaboratories.clone-annotation.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import { computed, ref, watch } from "vue";
import MainPage from "./MainPage.vue";
import QcPage from "./QcPage.vue";
import ReadQualityPage from "./ReadQualityPage.vue";
import ResultsPage from "./ResultsPage.vue";

export const sdkPlugin = defineAppV3(platforma, (app) => {
  const showImportDialog = ref(false);
  const showPropertiesDialog = ref(false);
  const showSettings = ref(false);

  // Opens the importer on a block that has never had files, once. `suggestedImport`
  // is what keeps it from reopening every time the block is visited.
  if (app.model.data.traceFiles.length === 0 && !app.model.data.suggestedImport) {
    app.model.data.suggestedImport = true;
    showImportDialog.value = true;
  }

  // Close the importer when a set is imported by any path other than the dialog.
  // It watches the pattern, not the files: the dialog writes a combined set's files
  // before Import so prerun can read their headers, and only an import sets the pattern.
  watch(
    () => app.model.data.namePattern,
    (pattern) => {
      if (pattern && app.model.data.traceFiles.length > 0) showImportDialog.value = false;
    },
  );

  // Run closes the settings, as in other blocks. Before the first run the flag is
  // undefined rather than false, so any start counts.
  watch(
    () => app.model.outputs.isRunning,
    (isRunning, wasRunning) => {
      if (isRunning === true && wasRunning !== true) showSettings.value = false;
    },
  );

  // A combined FASTA's record headers are extracted in prerun, one list per file.
  // Flatten them into the per-record list the model matches, keyed back to each
  // file by order. This feeds the main run, not prerun, so there is no loop.
  watch(
    () => app.model.outputs.fastaFileHeaders,
    (headers) => {
      if (!headers || (app.model.data.fileShape ?? "perFile") !== "combined") return;
      const files = app.model.data.traceFiles ?? [];
      const flat: FastaHeader[] = [];
      headers.forEach((list, fileIdx) => {
        const file = files[fileIdx] as ImportFileHandle | undefined;
        if (!file) return;
        list.forEach((header, index) => flat.push({ file, index, header }));
      });
      if (JSON.stringify(flat) !== JSON.stringify(app.model.data.fastaHeaders ?? [])) {
        app.model.data.fastaHeaders = flat;
      }
    },
    { immediate: true },
  );

  const progresses = computed(() => app.model.outputs.traceImports ?? {});

  return {
    // The green running bar at the top of the block page.
    progress: () => app.model.outputs.isRunning,
    routes: {
      "/": () => MainPage,
      "/results": () => ResultsPage,
      "/qc": () => QcPage,
      "/read-quality": () => ReadQualityPage,
    },
    showImportDialog,
    showPropertiesDialog,
    showSettings,
    progresses,
  };
});

export const useApp = sdkPlugin.useApp;
