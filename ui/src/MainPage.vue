<script setup lang="ts">
import {
  DEFAULT_NAME,
  DEFAULT_QUALITY_THRESHOLD,
  NUMBERING_SCHEME_OPTIONS,
  PAIRING_MODE_OPTIONS,
  SPECIES_OPTIONS,
} from "@platforma-open/milaboratories.clone-annotation.model";
import {
  PlBlockPage,
  PlBtnGhost,
  PlDropdown,
  PlEditableTitle,
  PlNumberField,
  PlSlideModal,
} from "@platforma-sdk/ui-vue";
import { computed, ref } from "vue";
import { useApp } from "./app";
import FilesTable from "./FilesTable.vue";
import ImportDialog from "./ImportDialog.vue";
import PropertiesDialog from "./PropertiesDialog.vue";
import { compilePattern, describeSelection } from "./trace_set";

const app = useApp();

const compiled = computed(() => compilePattern(app.model.data.namePattern ?? ""));

const files = computed(() =>
  describeSelection(app.model.data.traceFiles ?? [], compiled.value.pattern),
);

const settingsOpen = ref(false);
</script>

<template>
  <PlBlockPage>
    <template #title>
      <PlEditableTitle
        v-model="app.model.data.name"
        max-width="600px"
        :placeholder="DEFAULT_NAME"
        :max-length="40"
      />
    </template>

    <template #append>
      <PlBtnGhost icon="dna-import" @click.stop="() => (app.showImportDialog = true)">
        Add Files
      </PlBtnGhost>
      <PlBtnGhost icon="table" @click.stop="() => (app.showPropertiesDialog = true)">
        Add Properties
      </PlBtnGhost>
      <PlBtnGhost icon="settings" @click.stop="() => (settingsOpen = true)"> Settings </PlBtnGhost>
    </template>

    <div class="grid-area">
      <FilesTable :files="files" />
    </div>

    <ImportDialog v-if="app.showImportDialog" />
    <PropertiesDialog v-if="app.showPropertiesDialog" />
  </PlBlockPage>

  <PlSlideModal v-model="settingsOpen" close-on-outside-click shadow>
    <template #title>Settings</template>

    <PlNumberField
      v-model="app.model.data.qualityThreshold"
      label="Quality threshold"
      :min-value="0"
      :max-value="60"
      :placeholder="String(DEFAULT_QUALITY_THRESHOLD)"
    >
      <template #tooltip>
        Per-position Phred floor. Each read is trimmed to its longest stretch at or above it. The
        default, 20, means one wrong base in a hundred.
      </template>
    </PlNumberField>

    <PlDropdown
      v-model="app.model.data.numberingScheme"
      :options="NUMBERING_SCHEME_OPTIONS"
      label="Numbering scheme"
    >
      <template #tooltip>
        Where the framework and CDR boundaries fall. The three conventions draw them differently, so
        pick the one your data and collaborators use.
      </template>
    </PlDropdown>

    <PlDropdown
      v-model="app.model.data.pairingMode"
      :options="PAIRING_MODE_OPTIONS"
      label="Pairing"
    >
      <template #tooltip>
        What says two files are the two chains of one clone. Where each chain sits in its own
        folder, read the real plate out of the folder name using an optional section in the file
        pattern — see the help beside the pattern field.
      </template>
    </PlDropdown>

    <PlDropdown v-model="app.model.data.species" :options="SPECIES_OPTIONS" label="Species">
      <template #tooltip>
        The germline library to align against. Regions, chain and translation do not depend on it,
        so material no library covers still annotates.
      </template>
    </PlDropdown>
  </PlSlideModal>
</template>

<style scoped>
.grid-area {
  flex: 1;
  min-height: 300px;
}
</style>
