<script setup lang="ts">
import { pathTail } from "@platforma-open/milaboratories.clone-annotation.model";
import { PlBtnGhost, PlTextField } from "@platforma-sdk/ui-vue";
import { computed, ref, watch } from "vue";
import type { Piece, Role } from "./pattern_builder";
import {
  addFolder,
  defaultPieces,
  dropFolder,
  fromPattern,
  guessWell,
  isSeparator,
  joinWithNext,
  markWell,
  makeOptional,
  makeRequired,
  removePiece,
  setRole,
  setSection,
  splitPiece,
  tagName,
  toPattern,
} from "./pattern_builder";
import type { SelectedFile } from "./trace_set";
import { compilePattern } from "./trace_set";

const props = defineProps<{ files: SelectedFile[] }>();
const pattern = defineModel<string>({ required: true });

// Vue reads `{{` as an interpolation, so tokens cannot be written in the template.
const HINT = { choices: "_LC|_KC", def: "_{{Direction=F}}" };

const ROLES: { role: Role; label: string }[] = [
  { role: "text", label: "Fixed text" },
  { role: "plate", label: "Plate" },
  { role: "well", label: "Well" },
  { role: "chain", label: "Chain" },
  { role: "direction", label: "Direction" },
  { role: "tag", label: "Tag" },
  { role: "skip", label: "Skip" },
];

// Parsed here, not taken from the parent: the watcher below runs before the
// parent recomputes, and would read the previous pattern.
const compiled = computed(() => compilePattern(pattern.value));

const exampleIndex = ref(0);
const emptySegments = ref(1);
const segments = computed(() =>
  pattern.value.trim() === "" ? emptySegments.value : pattern.value.split("/").length,
);
const pieces = ref<Piece[]>([]);
const selected = ref<number | undefined>(undefined);
const notes = ref<string[]>([]);
/** False while the pattern holds something the builder cannot show. */
const inSync = ref(true);
let written: string | undefined;
/** Where the piece to select after the next read starts. */
let selectAt: number | undefined;
let rereading = false;

const file = computed(() => props.files[Math.min(exampleIndex.value, props.files.length - 1)]);
const fullSegments = computed(() => (file.value ? file.value.path.split(/[\\/]/).length : 1));
const example = computed(() => (file.value ? pathTail(file.value.path, segments.value) : ""));
const firstUnmatched = computed(() => props.files.findIndex((f) => !f.match));

function readPattern() {
  // After the builder's own write, a pattern that cannot be read yet (no well so
  // far, say) leaves the pieces as they are.
  const own = rereading;
  rereading = false;
  const parsed = compiled.value.pattern;
  const read =
    parsed && pattern.value.trim() !== ""
      ? fromPattern(example.value, pattern.value, parsed)
      : undefined;
  const at = selectAt;
  selectAt = undefined;
  if (own && !read) return;

  selected.value = undefined;
  if (!own) notes.value = [];
  pieces.value = read ?? defaultPieces(example.value);
  inSync.value = read !== undefined || pattern.value.trim() === "";
  if (read && at !== undefined) {
    const i = read.findIndex((p) => p.from === at && p.section !== undefined);
    if (i >= 0) selected.value = i;
  }
}

// A pattern typed by hand, or a new example, is read back into pieces. The
// builder's own writes are not: reading would merge pieces it split as text.
watch([() => pattern.value, example], ([p], [, oldExample]) => {
  if (p === written && example.value === oldExample) return;
  readPattern();
});
readPattern();

/**
 * `reread` reads the written pattern back into pieces, for changes the pieces
 * cannot show by themselves, such as whether an optional part is present.
 */
function write(next: Piece[], reread?: { selectAt?: number }) {
  pieces.value = next;
  const built = toPattern(example.value, next);
  notes.value = built.notes;
  written = reread ? undefined : built.pattern;
  rereading = reread !== undefined && built.pattern !== pattern.value;
  selectAt = reread?.selectAt;
  pattern.value = built.pattern;
}

function startOver() {
  pieces.value = defaultPieces(example.value);
  selected.value = undefined;
  inSync.value = true;
  findWell();
}

const names = computed(() => props.files.map((f) => pathTail(f.path, segments.value)));

function findWell() {
  const guess = guessWell(example.value, names.value);
  if (guess === undefined) {
    notes.value = ["No part of the name looks like a well in all files named this way."];
  } else if (guess.kind === "unsure") {
    notes.value = [
      `More than one part looks like a well: ${guess.parts.join(", ")}. Click the right one and mark it as Well.`,
    ];
  } else {
    const at = guess.from;
    write(markWell(pieces.value, guess.from, guess.to));
    notes.value = [
      `${example.value.slice(at, guess.to)} is marked as the well: this part takes ${guess.values} different values in ${guess.files} files, and all of them look like wells. Click it to change.`,
      ...notes.value,
    ];
  }
}

// Only once, on a fresh dialog: guessing again after the scientist cleared the
// pattern would write back what they just removed.
let guessed = false;
watch(
  () => props.files.length,
  (n) => {
    if (guessed || n < 2 || pattern.value.trim() !== "") return;
    guessed = true;
    findWell();
  },
  { immediate: true },
);

const hasWell = computed(() => pieces.value.some((p) => p.role === "well"));

function pick(role: Role) {
  if (selected.value === undefined) return;
  const current = pieces.value[selected.value]!;
  if (current.role === role && role === "tag") return;
  const usedTags = pieces.value.filter((p) => p.role === "tag").length;
  const tag = role === "tag" ? `Tag${usedTags + 1}` : undefined;
  write(setRole(pieces.value, selected.value, role, tag));
}

function renameTag(raw: string) {
  if (selected.value === undefined) return;
  write(setRole(pieces.value, selected.value, "tag", tagName(raw)));
}

function split() {
  if (selected.value === undefined) return;
  const next = splitPiece(example.value, pieces.value, selected.value);
  if (next !== pieces.value) write(next);
}

function join() {
  if (selected.value === undefined) return;
  const next = joinWithNext(example.value, pieces.value, selected.value);
  if (next !== pieces.value) write(next);
}

function optional() {
  if (selected.value === undefined) return;
  const at = pieces.value[selected.value]!.from;
  const next = makeOptional(example.value, pieces.value, selected.value);
  const part = next.find((p) => p.section !== undefined && p.from <= at && at < p.to);
  if (next !== pieces.value) write(next, { selectAt: part?.from });
}

function required() {
  if (selected.value === undefined) return;
  write(makeRequired(pieces.value, selected.value), {});
}

const sectionDraft = ref("");
watch(
  () => (selected.value === undefined ? undefined : pieces.value[selected.value]?.section),
  (inner) => (sectionDraft.value = inner ?? ""),
);

function applySection() {
  if (selected.value === undefined || sectionDraft.value === "") return;
  const at = pieces.value[selected.value]!.from;
  write(setSection(pieces.value, selected.value, sectionDraft.value), { selectAt: at });
}

function removeSection() {
  if (selected.value === undefined) return;
  write(removePiece(pieces.value, selected.value), {});
}

function moreFolders() {
  const folder = file.value?.path.split(/[\\/]/).at(-segments.value - 1) ?? "";
  if (pattern.value.trim() === "") emptySegments.value++;
  else pattern.value = addFolder(pattern.value, folder);
}

function fewerFolders() {
  if (pattern.value.trim() === "") emptySegments.value--;
  else pattern.value = dropFolder(pattern.value);
}

function step(by: number) {
  const n = props.files.length;
  exampleIndex.value = (((exampleIndex.value + by) % n) + n) % n;
}

const outOfSyncReason = computed(() => {
  if (compiled.value.error) return "The pattern has an error. Fix the text below, or start over.";
  return "This example does not fit the pattern. Pick another example, or start over.";
});

const piece = computed(() =>
  selected.value === undefined ? undefined : pieces.value[selected.value],
);
const canJoin = computed(
  () =>
    selected.value !== undefined &&
    joinWithNext(example.value, pieces.value, selected.value) !== pieces.value,
);

function isSeparatorPiece(p: Piece): boolean {
  return p.section === undefined && isSeparator(example.value.slice(p.from, p.to));
}

function pieceLabel(p: Piece): string {
  if (p.section !== undefined)
    return p.from === p.to ? `[${p.section}]` : example.value.slice(p.from, p.to);
  return example.value.slice(p.from, p.to);
}

function pieceTitle(p: Piece): string | undefined {
  if (p.section !== undefined)
    return p.from === p.to
      ? `Optional part [${p.section}], absent from this file`
      : `Optional part [${p.section}]`;
  return p.role === "tag" ? p.tag : ROLES.find((r) => r.role === p.role)?.label;
}
</script>

<template>
  <div v-if="file" :class="$style.builder" data-testid="pattern-builder">
    <div :class="$style.header">
      <span :class="$style.title">
        Click the parts of the name
        <button v-if="inSync && !hasWell" type="button" :class="$style.link" @click="findWell">
          Find the well
        </button>
      </span>
      <span :class="$style.nav">
        <PlBtnGhost
          size="small"
          icon="chevron-left"
          aria-label="Previous example"
          @click="step(-1)"
        />
        Example {{ Math.min(exampleIndex, files.length - 1) + 1 }} of {{ files.length }}
        <PlBtnGhost size="small" icon="chevron-right" aria-label="Next example" @click="step(1)" />
        <button
          v-if="firstUnmatched >= 0 && file.match"
          type="button"
          :class="$style.link"
          @click="exampleIndex = firstUnmatched"
        >
          Show a file that does not fit
        </button>
      </span>
    </div>

    <div :class="$style.name">
      <button
        v-if="segments < fullSegments"
        type="button"
        :class="$style.link"
        title="Read one more folder level"
        @click="moreFolders"
      >
        + folder
      </button>
      <template v-for="(p, i) in pieces" :key="`${i}-${p.from}-${p.to}`">
        <span v-if="isSeparatorPiece(p)" :class="$style.separator">{{
          example.slice(p.from, p.to)
        }}</span>
        <button
          v-else
          type="button"
          :disabled="!inSync"
          :class="[
            $style.piece,
            p.section === undefined ? $style[p.role] : $style.optional,
            { [$style.absent]: p.section !== undefined && p.from === p.to },
            { [$style.selected]: selected === i },
          ]"
          :title="pieceTitle(p)"
          @click="selected = selected === i ? undefined : i"
        >
          {{ pieceLabel(p) }}
        </button>
      </template>
      <button
        v-if="segments > 1"
        type="button"
        :class="$style.link"
        title="Read one folder level less"
        @click="fewerFolders"
      >
        − folder
      </button>
    </div>

    <p v-if="!inSync" :class="$style.note">
      {{ outOfSyncReason }}
      <button type="button" :class="$style.link" @click="startOver">
        Start over from this example
      </button>
    </p>

    <div v-if="piece && inSync && piece.section !== undefined" :class="$style.toolbar">
      <PlTextField v-model="sectionDraft" label="Optional part" :class="$style.sectionText" />
      <button type="button" :class="$style.link" @click="applySection">Apply</button>
      <button v-if="piece.from < piece.to" type="button" :class="$style.link" @click="required">
        Make required
      </button>
      <button v-else type="button" :class="$style.link" @click="removeSection">Remove</button>
      <p :class="$style.hint">
        Separate choices with |, like {{ HINT.choices }}. A token can give a value for files without
        the part, like {{ HINT.def }}.
      </p>
    </div>

    <div v-else-if="piece && inSync" :class="$style.toolbar">
      <button
        v-for="r in ROLES"
        :key="r.role"
        type="button"
        :class="[$style.role, $style[r.role], { [$style.active]: piece.role === r.role }]"
        @click="pick(r.role)"
      >
        {{ r.label }}
      </button>
      <span :class="$style.gap" />
      <button type="button" :class="$style.link" @click="split">Split</button>
      <button v-if="canJoin" type="button" :class="$style.link" @click="join">
        Join with next
      </button>
      <button
        v-if="piece.role !== 'well'"
        type="button"
        :class="$style.link"
        title="Files may have this part or not"
        @click="optional"
      >
        Optional
      </button>
      <PlTextField
        v-if="piece.role === 'tag'"
        :model-value="piece.tag ?? ''"
        label="Tag name"
        :class="$style.tagName"
        @update:model-value="(v) => renameTag(v ?? '')"
      />
    </div>

    <ul v-if="notes.length" :class="$style.notes">
      <li v-for="n in notes" :key="n">{{ n }}</li>
    </ul>
  </div>
</template>

<style module>
.builder {
  margin: 8px 0 12px;
  font-size: 12px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.title {
  font-weight: 600;
}

.nav {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--txt-03);
}

.name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 8px;
  border: 1px solid var(--border-color-div-grey);
  border-radius: 6px;
  font-family: var(--font-family-monospace);
  font-size: 13px;
}

.separator {
  color: var(--txt-03);
}

.piece {
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 4px;
  font: inherit;
  cursor: pointer;
}

.piece:disabled {
  cursor: default;
  opacity: 0.6;
}

.selected {
  border-color: var(--txt-01);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}

.role {
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
  cursor: pointer;
}

.active {
  border-color: var(--txt-01);
  font-weight: 600;
}

.gap {
  width: 8px;
}

.tagName {
  width: 160px;
}

.sectionText {
  width: 240px;
}

.hint {
  flex-basis: 100%;
  margin: 2px 0 0;
  color: var(--txt-03);
}

.optional {
  background-color: #ffffff;
  border: 1px dashed #5f31cc;
}

.absent {
  color: var(--txt-03);
  font-style: italic;
}

.link {
  border: none;
  background: none;
  padding: 0 4px;
  color: var(--txt-link, #5f31cc);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-family-base);
}

.note {
  margin: 6px 0 0;
  color: var(--txt-03);
}

.notes {
  margin: 6px 0 0;
  padding-left: 18px;
  color: var(--warn-01, #b36b00);
}

.text {
  background-color: #f4f4f6;
}

.skip {
  background-color: #ffffff;
  border-style: dashed;
  border-color: var(--txt-03);
}

.plate {
  background-color: #dedbff;
}

.well {
  background-color: #d0f0c0;
}

.chain {
  background-color: #faf5aa;
}

.direction {
  background-color: #ffe0cc;
}

.tag {
  background-color: #e8e8e8;
}

.optional.selected {
  border-style: solid;
  border-color: var(--txt-01);
}
</style>
