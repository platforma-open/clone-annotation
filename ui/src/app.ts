import { platforma } from "@platforma-open/milaboratories.clone-annotation.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import { computed, ref } from "vue";
import MainPage from "./MainPage.vue";
import QcPage from "./QcPage.vue";
import ResultsPage from "./ResultsPage.vue";

export const sdkPlugin = defineAppV3(platforma, (app) => {
  const showImportDialog = ref(false);
  const showPropertiesDialog = ref(false);

  // Opens the importer on a block that has never had files, once. `suggestedImport`
  // is what keeps it from reopening every time the block is visited.
  if (app.model.data.traceFiles.length === 0 && !app.model.data.suggestedImport) {
    app.model.data.suggestedImport = true;
    showImportDialog.value = true;
  }

  const progresses = computed(() => app.model.outputs.traceImports ?? {});

  return {
    routes: {
      "/": () => MainPage,
      "/results": () => ResultsPage,
      "/qc": () => QcPage,
      // A project saved before the tables moved under one page opens on the
      // section it was left on, so those hrefs still have to resolve.
      "/clones": () => ResultsPage,
      "/molecules": () => ResultsPage,
      "/variants": () => ResultsPage,
      "/unmatched": () => QcPage,
    },
    showImportDialog,
    showPropertiesDialog,
    progresses,
  };
});

export const useApp = sdkPlugin.useApp;
