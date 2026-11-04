<script setup lang="ts">
import {
  DEFAULT_NAME,
  DEFAULT_QUALITY_THRESHOLD,
  EXPORT_WELLS_OPTIONS,
  NUMBERING_SCHEME_OPTIONS,
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
import { computed } from "vue";
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
      <PlBtnGhost icon="settings" @click.stop="() => (app.showSettings = true)">
        Settings
      </PlBtnGhost>
    </template>

    <div class="grid-area">
      <FilesTable :files="files" />
    </div>

    <ImportDialog v-if="app.showImportDialog" />
    <PropertiesDialog v-if="app.showPropertiesDialog" />
  </PlBlockPage>

  <PlSlideModal v-model="app.showSettings" close-on-outside-click shadow>
    <template #title>Settings</template>

    <PlDropdown
      v-model="app.model.data.species"
      :options="SPECIES_OPTIONS"
      :required="true"
      :error="!app.model.data.species ? 'Species is required' : undefined"
      label="Species"
    >
      <template #tooltip>
        The germline library to align against. Regions, chain and translation do not depend on it,
        so material no library covers still annotates.
      </template>
    </PlDropdown>

    <PlDropdown
      v-model="app.model.data.numberingScheme"
      :options="NUMBERING_SCHEME_OPTIONS"
      :required="true"
      :error="!app.model.data.numberingScheme ? 'Numbering scheme is required' : undefined"
      label="Numbering scheme"
    >
      <template #tooltip>
        Where the framework and CDR boundaries fall. The three conventions draw them differently, so
        pick the one your data and collaborators use.
      </template>
    </PlDropdown>

    <PlNumberField
      v-model="app.model.data.qualityThreshold"
      label="Quality threshold"
      :min-value="0"
      :max-value="60"
      :placeholder="String(DEFAULT_QUALITY_THRESHOLD)"
    >
      <template #tooltip>
        The error rate allowed in the part of each read that is kept. At 20, the default, that is
        about 1 error in 100 bases. The block cuts off the read ends and keeps the stretch that
        stays within this rate. Raise it for fewer errors, or lower it to keep longer reads.
      </template>
    </PlNumberField>

    <PlDropdown
      v-model="app.model.data.exportWells"
      :options="EXPORT_WELLS_OPTIONS"
      :required="true"
      :error="!app.model.data.exportWells ? 'Export is required' : undefined"
      label="Export"
    >
      <template #tooltip>
        Which wells to pass on to the next blocks, based on their verdict in Plate View.
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
