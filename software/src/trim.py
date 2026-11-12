"""Trim each consensus to its antibody domain before MiXCR align.

A Sanger read of an antibody construct runs from the signal peptide through the V domain
and on into the constant region. With that 3' tail present, MiXCR over-extends V across the
whole read and never aligns D or J, so CDR3, FR4 and the D and J genes come back as
not-covered. ANARCI finds the domain by shape, so this cuts each read to the numbered
domain plus a small margin, and MiXCR then aligns D and J normally. Only MiXCR's input is
trimmed; the annotation and the viewer still use the full consensus.

Usage: trim.py --sequences sequences.fasta --csv_h anarci_H.csv --csv_kl anarci_KL.csv --out trimmed.fasta
"""
import argparse

from annotate import BUCKETS, pick_frame, read_anarci, read_fasta, reverse_complement
from regions import _is_gap

# Keep a few codons past each end of the numbered domain, so MiXCR aligns V from its start
# and J to its end while the constant-region tail that derails V is gone.
MARGIN_NT = 9


def domain_nt_span(frame, start, residues):
    """The nucleotides the numbered domain spans on the strand, as (first, last).

    The protein ANARCI numbered begins at nucleotide `frame % 3`; its residue `i` is the
    codon at `offset + 3 * i`. The domain runs from `start` for as many residues as number."""
    count = sum(1 for r in residues if not _is_gap(r))
    offset = frame % 3
    return offset + 3 * start, offset + 3 * (start + count)


def trim(nucleotide, best):
    """The consensus cut to its domain, on the strand ANARCI numbered. The whole read is
    returned unchanged when there is no numbering to cut by, or the cut would be empty."""
    if best is None or not nucleotide:
        return nucleotide
    _bucket, frame, (_labels, residues, _score, start), _ = best
    strand = nucleotide if frame < 3 else reverse_complement(nucleotide)
    first, last = domain_nt_span(frame, start, residues)
    first = max(0, first - MARGIN_NT)
    last = min(len(strand), last + MARGIN_NT)
    return strand[first:last] if last > first else nucleotide


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--sequences", required=True, help="The consensus nucleotides, one per id")
    p.add_argument("--out", required=True, help="The trimmed FASTA for MiXCR align")
    for bucket in BUCKETS:
        p.add_argument("--csv_%s" % bucket.lower(), required=False)
    args = p.parse_args(argv)

    by_bucket = {b: read_anarci(getattr(args, "csv_%s" % b.lower())) for b in BUCKETS}
    nucleotides = read_fasta(args.sequences)
    with open(args.out, "w") as handle:
        for sid, nt in nucleotides.items():
            handle.write(">%s\n%s\n" % (sid, trim(nt, pick_frame(sid, by_bucket))))


if __name__ == "__main__":
    main()
