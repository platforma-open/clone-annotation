import { platforma } from "@platforma-open/milaboratories.clone-annotation.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import { computed, ref } from "vue";
import ClonesPage from "./ClonesPage.vue";
import MainPage from "./MainPage.vue";
import MoleculesPage from "./MoleculesPage.vue";
import VariantsPage from "./VariantsPage.vue";
import UnmatchedPage from "./UnmatchedPage.vue";

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
      "/clones": () => ClonesPage,
      "/molecules": () => MoleculesPage,
      "/variants": () => VariantsPage,
      "/unmatched": () => UnmatchedPage,
    },
    showImportDialog,
    showPropertiesDialog,
    progresses,
  };
});

export const useApp = sdkPlugin.useApp;
