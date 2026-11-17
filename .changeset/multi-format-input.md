---
"@platforma-open/milaboratories.clone-annotation.kind": minor
"@platforma-open/milaboratories.clone-annotation.software": minor
"@platforma-open/milaboratories.clone-annotation.workflow": minor
"@platforma-open/milaboratories.clone-annotation.model": minor
"@platforma-open/milaboratories.clone-annotation.ui": minor
"@platforma-open/milaboratories.clone-annotation.block": minor
---

Accept FASTA and FASTQ input, beside Sanger traces:

- FASTA, nucleotide and amino acid. An amino-acid set is numbered as protein, carries no germline, and collapses clones on the amino-acid sequence.
- FASTQ, nucleotide (one read per clone), trimmed by the quality floor.
- Each form reads either per-well files or one combined file, with identity taken from the file path or the record header.
- Gzipped input files are read directly.
