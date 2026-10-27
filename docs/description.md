# Overview

Takes the sequencing files of individually picked clones, in whatever form they arrived, and returns
annotated antibody sequences carrying their plate and well identity and a quality assessment. Built
for low-throughput discovery — hybridoma supernatants, single sorted B cells, phage picks — where
every clone is one well on a plate and every well is read on a capillary sequencer. Traces are
accepted as ABIF (`.ab1`, `.abi`, `.ab`) or SCF.

The usual route for this material is a folder of files and a spreadsheet, reconciled by hand. This
block takes both and keeps the link between them, so a binding measurement stays attached to the
sequence it belongs to.

## From Files To Clones

You declare how the file names are built, for example `{{Plate}}/{{Well}}_{{Chain}}_{{Direction}}.ab1`.
The pattern matches against the whole path below the folder you selected, not just the file name, so
the plate can be a directory rather than part of the name. That is the common shape for data coming
off a sequencing service.

Only files matching the pattern are imported. Files that do not match are shown in the table rather
than dropped quietly, so you can see what will be left out before you import. Two files landing on
the same plate, well, chain and direction are reported as a collision, and files that match nothing
are listed on their own.

## Per-Well Measurements

A spreadsheet of readings — ELISA values, titres, a cluster label, anything measured per well — joins
onto the clones on plate and well. You pick the identifier columns and say which of the rest to carry
and as what type. The block guesses all of this from the sheet and lets you correct it.

Both directions of failure are reported. Sheet rows that reach no clone are listed, and clones that
no row reached are listed too, so a silent mismatch between a plate map and a file set cannot pass
unnoticed.

## Reading, Merging And Annotating

Tracy reads the traces, handling ABIF and SCF through one reader, and keeps per-position quality.
Forward and reverse reads of the same chain merge into one consensus. A quality threshold decides
what is kept, and everything set aside is listed with its reason rather than disappearing.

MiXCR then aligns each sequence, giving framework and CDR boundaries, germline V and J calls, and the
observed chain. Where the observed chain disagrees with the one the file name asserted, the block
says so instead of trusting the label. Sequences MiXCR cannot describe are listed.

## Pairing And Collapse

A clone's heavy and light reads become one molecule, matched on a convention you declare. Single
domain material passes through whole, and anything that cannot be paired is listed.

Molecules that are letter-for-letter identical collapse into one. Every well behind a molecule stays
reachable, each measurement keeps its per-well values alongside a summary, and a molecule whose wells
disagree on a reading is flagged. Collapse is exact identity only — looser grouping is the
`Redefine Clonotypes` block's job, downstream.

## Output

A standard V(D)J sequence set, in the vocabulary every other block already reads, so `Sequence
Browser`, `Sequence Properties` and the rest consume it with no special handling.

Trace reading, merging and alignment use Tracy, part of
[GEAR Genomics](https://www.gear-genomics.com/) and developed at EMBL. Please cite:

> Rausch, T., Fritz, M. H., Untergasser, A., & Benes, V. (2020). Tracy: basecalling, alignment,
> assembly and deconvolution of sanger chromatogram trace files. *BMC Genomics* **21**, 230.
> [https://doi.org/10.1186/s12864-020-6635-8](https://doi.org/10.1186/s12864-020-6635-8)
