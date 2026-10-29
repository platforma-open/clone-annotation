import type { ImportFileHandle } from "@platforma-open/milaboratories.clone-annotation.model";
import {
  getFilePathFromHandle,
  pathTail,
} from "@platforma-open/milaboratories.clone-annotation.model";
import type { PathPatternMatch } from "@platforma-open/milaboratories.clone-annotation.model";
import { PathPattern } from "@platforma-open/milaboratories.clone-annotation.model";

/** Trace formats Tracy reads. ABIF under its three naming habits, plus SCF. */
export const TRACE_EXTENSIONS = ["ab1", "abi", "ab", "scf"];

export type SelectedFile = {
  handle: ImportFileHandle;
  /** Full path as the handle reports it. */
  path: string;
  /** Path below the common root, which is what the pattern matches against. */
  relativePath: string;
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

export type CompiledPattern = { pattern?: PathPattern; error?: string };

export function compilePattern(raw: string): CompiledPattern {
  if (raw.trim() === "") return {};
  try {
    return { pattern: PathPattern.parse(raw) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
