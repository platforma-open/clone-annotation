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

  // Run closes the settings, as in other blocks. Before the first run the flag is
  // undefined rather than false, so any start counts.
  watch(
    () => app.model.outputs.isRunning,
    (isRunning, wasRunning) => {
      if (isRunning === true && wasRunning !== true) showSettings.value = false;
    },
  );

  const progresses = computed(() => app.model.outputs.traceImports ?? {});

  return {
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
