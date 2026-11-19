<script setup lang="ts">
/**
 * Shows raw Sanger reads: each `.ab1` as its own row, drawn against its own base
 * calls, at full length, before trimming or the consensus merge. It uses the
 * sequence viewer's bare renderer, not the plugin: the plugin lays one consensus
 * trace per chain, which is the opposite of what this view is for.
 */
import {
  parseAb1,
  SequenceViewerView,
  traceFromRead,
  type ChainData,
  type ChainTrace,
  type SequenceEntry,
  type SequenceViewerData,
  type SequenceViewerSettings,
} from "@milaboratories/sequence-viewer";
import { PlAlert, PlSlideModal, ReactiveFileContent } from "@platforma-sdk/ui-vue";
import { computed, ref } from "vue";

const reactiveFileContent = ReactiveFileContent.useGlobal();

/** The blob handle `ReactiveFileContent` reads bytes from; `traceContent` carries one
 * per uploaded read (via each handle's `.handle`). */
type TraceHandle = NonNullable<Parameters<typeof reactiveFileContent.getContentBytes>[0]>;

/** One raw read to draw. */
export type RawTraceRead = {
  /** Stable, unique row key. */
  key: string;
  /** Row label: plate, well, chain and direction. */
  label: string;
  /** Short chain tag beside the label (`VH`, `VL`), or empty. */
  chainLabel: string;
  /** Downloadable handle from the model's `traceContent` output. */
  handle: TraceHandle;
  /** Bases Mott trimming cut from the start and the end, to mark on the read. */
  trimmed?: [number, number];
};

const props = defineProps<{
  reads: RawTraceRead[];
  /** Phred below which read quality is drawn red; Q20 when not given. */
  qualityThreshold?: number;
  title?: string;
}>();

const open = defineModel<boolean>({ required: true });

// View state only (decision D4): nothing is written back to the block.
const settings = ref<SequenceViewerSettings>({});

/** Most reads drawn at once; mirrors the viewer's own row limit. */
const ROW_LIMIT = 200;

// Self-placement needs no consensus, so a read placed once serves every clone it
// backs. The cost is the Smith-Waterman in `traceFromRead`; the cache pays it once
// per file for the page's life.
const cache = new Map<string, { nt?: string; trace: ChainData["trace"] }>();

function miss(reason: string): { status: "missing"; reason: string } {
  return { status: "missing", reason };
}

// The trimmed ends as regions on the read, so the kept middle stands out. Each
// trim is counted from its own end, so it stays right even where the ab1's base
// count differs a little from Tracy's.
function trimRegions(ntLen: number, trimmed?: [number, number]): ChainData["regions"] {
  if (trimmed === undefined || ntLen === 0) return miss("raw read, not annotated");
  const [left, right] = trimmed;
  const spans: { name: string; start: number; end: number }[] = [];
  if (left > 0) spans.push({ name: "Trimmed", start: 0, end: Math.min(left, ntLen) });
  if (right > 0) spans.push({ name: "Trimmed", start: Math.max(0, ntLen - right), end: ntLen });
  return spans.length > 0 ? { status: "ok", value: spans } : miss("nothing trimmed");
}

function placeOf(handle: string, bytes: Uint8Array) {
  let hit = cache.get(handle);
  if (hit === undefined) {
    try {
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const read = parseAb1(buffer);
      const trace: ChainTrace | undefined = traceFromRead(read, read.bases);
      hit = {
        nt: read.bases,
        trace: trace ? { status: "ok", value: trace } : miss("read too short to place"),
      };
    } catch {
      hit = { trace: miss("could not read the file") };
    }
    cache.set(handle, hit);
  }
  return hit;
}

const data = computed<SequenceViewerData>(() => {
  const entries: SequenceEntry[] = [];
  for (const read of props.reads.slice(0, ROW_LIMIT)) {
    const bytes = reactiveFileContent.getContentBytes(read.handle)?.value;
    if (bytes === undefined) continue;
    const { nt, trace } = placeOf(read.handle, bytes);
    const chain: ChainData = {
      label: read.chainLabel,
      nt,
      aaOffset: 0,
      regions: trimRegions(nt?.length ?? 0, read.trimmed),
      segments: miss("raw read, not annotated"),
      germline: miss("raw read, not annotated"),
      liabilities: miss("raw read, not annotated"),
      trace,
    };
    entries.push({ key: read.key, name: read.label, chains: [chain], properties: {} });
  }
  return { entries, properties: [] };
});

const loading = computed(() =>
  props.reads
    .slice(0, ROW_LIMIT)
    .some((read) => reactiveFileContent.getContentBytes(read.handle)?.value === undefined),
);

const exceedsLimit = computed(() => props.reads.length > ROW_LIMIT);
</script>

<template>
  <PlSlideModal v-model="open" width="100%" :close-on-outside-click="false">
    <template #title>{{ title ?? "Raw traces" }}</template>
    <div v-if="open" :class="$style.root">
      <PlAlert v-if="reads.length === 0" type="warn" icon>No raw reads to show.</PlAlert>
      <template v-else>
        <PlAlert v-if="exceedsLimit" type="warn" icon label="Not every read is shown">
          At most {{ ROW_LIMIT }} reads are shown at once. Select fewer to choose which.
        </PlAlert>
        <SequenceViewerView
          v-model="settings"
          :data="data"
          :loading="loading"
          :quality-threshold="qualityThreshold"
          export-name="raw-traces"
          :class="$style.view"
        />
      </template>
    </div>
  </PlSlideModal>
</template>

<style module>
.root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.view {
  flex: 1;
  min-height: 0;
}
</style>
