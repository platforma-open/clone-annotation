# @platforma-open/milaboratories.clone-annotation.workflow

## 1.2.2

### Patch Changes

- f78c94f: Add a raw trace view on the Files tab. Open any uploaded Sanger file (.ab1/.scf) to
  see its full-length chromatogram and read quality, with the Mott-trimmed ends marked —
  the read as the instrument wrote it, before trimming and the consensus merge.

## 1.2.1

### Patch Changes

- 4a19ec9: Support remote file upload

## 1.2.0

### Minor Changes

- 2721e3b: Accept FASTA and FASTQ input, beside Sanger traces:

  - FASTA, nucleotide and amino acid. An amino-acid set is numbered as protein, carries no germline, and collapses clones on the amino-acid sequence.
  - FASTQ, nucleotide (one read per clone), trimmed by the quality floor.
  - Each form reads either per-well files or one combined file, with identity taken from the file path or the record header.
  - Gzipped input files are read directly.

### Patch Changes

- Updated dependencies [2721e3b]
  - @platforma-open/milaboratories.clone-annotation.software@1.2.0

## 1.1.0

### Minor Changes

- 30a75d8: Germline annotation

### Patch Changes

- Updated dependencies [30a75d8]
  - @platforma-open/milaboratories.clone-annotation.software@1.1.0

## 1.0.6

### Patch Changes

- 1c2eec2: Minor improvements
- Updated dependencies [1c2eec2]
  - @platforma-open/milaboratories.clone-annotation.software@1.0.5

## 1.0.5

## 1.0.4

### Patch Changes

- 3ae2b42: Improve trimming
- Updated dependencies [3ae2b42]
  - @platforma-open/milaboratories.clone-annotation.software@1.0.4

## 1.0.3

### Patch Changes

- 2a5612c: Sequence viewer over the clones: opens the selected clones' Sanger traces from the Clones tab
- Updated dependencies [2a5612c]
  - @platforma-open/milaboratories.clone-annotation.software@1.0.3

## 1.0.2

### Patch Changes

- 4b10a8d: Initial software release
- Updated dependencies [4b10a8d]
  - @platforma-open/milaboratories.clone-annotation.software@1.0.2

## 1.0.1

### Patch Changes

- 9d25675: Initial release
- Updated dependencies [9d25675]
  - @platforma-open/milaboratories.clone-annotation.software@1.0.1
