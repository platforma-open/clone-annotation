<script lang="ts" setup>
import { PlBtnGhost, PlTooltip } from "@platforma-sdk/ui-vue";
import { useCssModule } from "vue";

const styles = useCssModule();

// Vue reads `{{` as an interpolation, so tokens cannot be written in the template.
const T = {
  well: "{{Well}}",
  plate: "{{Plate}}",
  chain: "{{Chain}}",
  direction: "{{Direction}}",
  tag: "{{:Name}}",
  any: "{{*}}",
  num: "{{n}}",
  flat: "{{Plate}}_{{Chain}}_{{Direction}}_{{Well}}.ab1",
  nested: "{{Plate}}/{{Well}}_{{Chain}}-{{:Run}}.ab1",
};
</script>

<template>
  <PlTooltip position="bottom" max-width="460px" :close-delay="300">
    <PlBtnGhost icon="help" aria-label="Pattern help" />
    <template #tooltip>
      <div :class="styles.help">
        <p>
          Write out what one file is called, replacing the parts that change with a token. Put
          <code>/</code> where the path has a directory.
        </p>

        <table>
          <tr>
            <td>
              <code>{{ T.well }}</code>
            </td>
            <td>The well. Required.</td>
          </tr>
          <tr>
            <td>
              <code>{{ T.plate }}</code>
            </td>
            <td>The plate, often a directory.</td>
          </tr>
          <tr>
            <td>
              <code>{{ T.chain }}</code>
            </td>
            <td>Heavy, light, or whatever the files call it.</td>
          </tr>
          <tr>
            <td>
              <code>{{ T.direction }}</code>
            </td>
            <td>
              <code>F</code>, <code>R</code>, <code>fwd</code>, <code>rev</code>, <code>R1</code>,
              <code>1</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>{{ T.tag }}</code>
            </td>
            <td>Anything else worth keeping, under a name you choose.</td>
          </tr>
          <tr>
            <td>
              <code>{{ T.any }}</code> <code>{{ T.num }}</code>
            </td>
            <td>Text or digits to skip.</td>
          </tr>
          <tr>
            <td><code>[_LC|_KC]</code></td>
            <td>
              A part that may or may not be there. Use it where each chain sits in its own folder,
              so the plate reads the same for all of them.
            </td>
          </tr>
        </table>

        <p>
          <code>{{ T.flat }}</code>
        </p>
        <p>
          <code>{{ T.nested }}</code>
        </p>

        <p>
          A token stays inside one path segment. The pattern decides how much of the path is read,
          so with one <code>/</code> the plate directory is seen whatever sits above it. Only files
          matching the pattern are imported, extension included.
        </p>
      </div>
    </template>
  </PlTooltip>
</template>

<style module>
.help {
  composes: noLigatures from "./noLigatures.module.css";
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  line-height: 16px;
}

.help p {
  margin: 0;
}

.help table {
  border-collapse: collapse;
}

.help td {
  padding: 1px 8px 1px 0;
  vertical-align: top;
}

.help code {
  font-family: var(--font-family-monospace);
  white-space: nowrap;
}
</style>
