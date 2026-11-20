# @platforma-open/milaboratories.clone-annotation.ui

## 1.3.0

### Minor Changes

- 9a72a13: Support scFv reads. A read that carries a whole heavy and a whole light domain in one reading frame is split into two chains of one clone, each with its own regions and germline. An scFv run exports its clones with `pl7.app/vdj/pairing: construct`.

  The clone table now shows the J gene of each chain by default, in place of the C gene and isotype. The import dialog closes when a set is imported without it.

### Patch Changes

- @platforma-open/milaboratories.clone-annotation.model@1.3.0

## 1.2.2

### Patch Changes

- f78c94f: Add a raw trace view on the Files tab. Open any uploaded Sanger file (.ab1/.scf) to
  see its full-length chromatogram and read quality, with the Mott-trimmed ends marked —
  the read as the instrument wrote it, before trimming and the consensus merge.
- Updated dependencies [f78c94f]
  - @platforma-open/milaboratories.clone-annotation.model@1.2.2

## 1.2.1

### Patch Changes

- 4a19ec9: Support remote file upload
- Updated dependencies [4a19ec9]
  - @platforma-open/milaboratories.clone-annotation.model@1.2.1

## 1.2.0

### Minor Changes

- 2721e3b: Accept FASTA and FASTQ input, beside Sanger traces:

  - FASTA, nucleotide and amino acid. An amino-acid set is numbered as protein, carries no germline, and collapses clones on the amino-acid sequence.
  - FASTQ, nucleotide (one read per clone), trimmed by the quality floor.
  - Each form reads either per-well files or one combined file, with identity taken from the file path or the record header.
  - Gzipped input files are read directly.

### Patch Changes

- Updated dependencies [2721e3b]
  - @platforma-open/milaboratories.clone-annotation.model@1.2.0

## 1.1.0

### Minor Changes

- 30a75d8: Germline annotation

### Patch Changes

- Updated dependencies [30a75d8]
  - @platforma-open/milaboratories.clone-annotation.model@1.1.0

## 1.0.6

### Patch Changes

- 1c2eec2: Minor improvements
  - @platforma-open/milaboratories.clone-annotation.model@1.0.6

## 1.0.5

### Patch Changes

- 569c38a: Sequence viewer uses the block's quality threshold and opens only over selected clones; Plate View no longer shows two offset loaders while the plate map loads
- Updated dependencies [569c38a]
  - @platforma-open/milaboratories.clone-annotation.model@1.0.5

## 1.0.4

### Patch Changes

- @platforma-open/milaboratories.clone-annotation.model@1.0.4

## 1.0.3

### Patch Changes

- 2a5612c: Sequence viewer over the clones: opens the selected clones' Sanger traces from the Clones tab
- Updated dependencies [2a5612c]
  - @platforma-open/milaboratories.clone-annotation.model@1.0.3

## 1.0.2

### Patch Changes

- 4b10a8d: Initial software release
- Updated dependencies [4b10a8d]
  - @platforma-open/milaboratories.clone-annotation.model@1.0.2

## 1.0.1

### Patch Changes

- 9d25675: Initial release
- Updated dependencies [9d25675]
  - @platforma-open/milaboratories.clone-annotation.model@1.0.1
