# @platforma-open/milaboratories.clone-annotation.kind

## 1.1.0

### Minor Changes

- 2721e3b: Accept FASTA and FASTQ input, beside Sanger traces:

  - FASTA, nucleotide and amino acid. An amino-acid set is numbered as protein, carries no germline, and collapses clones on the amino-acid sequence.
  - FASTQ, nucleotide (one read per clone), trimmed by the quality floor.
  - Each form reads either per-well files or one combined file, with identity taken from the file path or the record header.
  - Gzipped input files are read directly.

## 1.0.2

### Patch Changes

- 4b10a8d: Initial software release

## 1.0.1

### Patch Changes

- 9d25675: Initial release
