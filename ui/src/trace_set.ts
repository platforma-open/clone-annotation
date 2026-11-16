import type {
  FastaHeader,
  ImportFileHandle,
  InputForm,
} from "@platforma-open/milaboratories.clone-annotation.model";
import {
  getFilePathFromHandle,
  pathTail,
} from "@platforma-open/milaboratories.clone-annotation.model";
import type { PathPatternMatch } from "@platforma-open/milaboratories.clone-annotation.model";
import { PathPattern } from "@platforma-open/milaboratories.clone-annotation.model";

/** Trace formats Tracy reads. ABIF under its three naming habits, plus SCF. */
export const TRACE_EXTENSIONS = ["ab1", "abi", "ab", "scf"];

/** Nucleotide FASTA, under the names it arrives with. */
export const FASTA_NT_EXTENSIONS = ["fasta", "fa", "fna", "fas"];

/** Every extension the picker offers. The form is guessed from the selection, so
 * the picker is not narrowed to one form up front. */
export const ALL_EXTENSIONS = [...TRACE_EXTENSIONS, ...FASTA_NT_EXTENSIONS];

/** The form a selection looks like, from the file extensions. One set is one
 * form, so the majority wins and a trace is the default. */
export function guessForm(handles: ImportFileHandle[]): InputForm {
  let fasta = 0;
  let trace = 0;
  for (const handle of handles) {
    const ext = getFilePathFromHandle(handle).split(".").pop()?.toLowerCase() ?? "";
    if (FASTA_NT_EXTENSIONS.includes(ext)) fasta++;
    else if (TRACE_EXTENSIONS.includes(ext)) trace++;
  }
  return fasta > trace ? "fastaNt" : "trace";
}

export type SelectedFile = {
  handle: ImportFileHandle;
  /** Full path as the handle reports it. */
  path: string;
  /** Path below the common root, which is what the pattern matches against. For a
   * combined file this is the record header. */
  relativePath: string;
  /** The record's index in its file, for a combined file; absent otherwise. */
  recordIndex?: number;
  match?: PathPatternMatch;
  /** Why the pattern did not match, when it did not. */
  reason?: string;
};

/** Pairs each selected file with what the pattern captured, or nothing if it did not match. */
export function describeSelection(
  handles: ImportFileHandle[],
  pattern: PathPattern | undefined,
): SelectedFile[] {
  const segments = pattern?.segmentCount ?? 1;
  return handles.map((handle) => {
    const path = getFilePathFromHandle(handle);
    const relativePath = pathTail(path, segments);
    const match = pattern?.match(relativePath);
    const reason = pattern && !match ? pattern.explain(relativePath) : undefined;
    return { handle, path, relativePath, match, reason };
  });
}

/** The combined-file records as selected files, matching each on its header, so
 * the files table and pattern checks run per record. */
export function describeCombined(
  headers: FastaHeader[],
  pattern: PathPattern | undefined,
): SelectedFile[] {
  return headers.map((rec) => {
    const match = pattern?.match(rec.header);
    const reason = pattern && !match ? pattern.explain(rec.header) : undefined;
    // The pattern matches the header, so `path` and `relativePath` are the header
    // (the builder and preview show it). The Files table reads the file and index
    // off the handle for its own columns.
    return {
      handle: rec.file,
      path: rec.header,
      relativePath: rec.header,
      recordIndex: rec.index,
      match,
      reason,
    };
  });
}

export type CompiledPattern = { pattern?: PathPattern; error?: string };

export function compilePattern(raw: string): CompiledPattern {
  if (raw.trim() === "") return {};
  try {
    return { pattern: PathPattern.parse(raw) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
