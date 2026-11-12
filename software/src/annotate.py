"""Join what ANARCI numbered and what MiXCR aligned onto each sequence.

The two run independently. ANARCI finds the reading frame and the chain from the
shape of the sequence, so regions survive with no reference at all; MiXCR adds
the germline, and only when a reference covers the material. A sequence MiXCR
could not place keeps everything ANARCI gave it.

Usage: annotate.py --report report.json --scheme imgt --out annotation.json
                   [--csv_h F] [--csv_kl F] [--csv_a F] [--csv_b F] [--csv_g F]
                   [--csv_d F] [--mixcr F]
"""

import argparse
import base64
import csv
import difflib
import hashlib
import json
import pathlib
import re
import sys

from regions import (
    FEATURES,
    BUCKET_TABLE,
    BUCKETS,
    REGION_RANGES,
    REGIONS,
    SCHEMES,
    STATUS_ANNOTATED,
    STATUS_FAILED,
    build_regions,
    position_columns,
)

COMPLEMENT = str.maketrans("ACGTNacgtn", "TGCANtgcan")

CODONS = {}
_BASES = "TCAG"
_AMINO = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
for _i, _aa in enumerate(_AMINO):
    CODONS[_BASES[_i // 16] + _BASES[_i // 4 % 4] + _BASES[_i % 4]] = _aa

# More mixed positions than this inside CDR3 make a chain Mixed. Provisional:
# nothing published says when a whole read is mixed.
MIXED_LIMIT = 5

# The same double-peak test over the whole domain, not only the CDR3: a second
# template shows second peaks along the framework too. Higher than MIXED_LIMIT
# because the domain is far longer than the CDR3. Provisional until calibrated
# against a block run on known-mixed wells.
DOMAIN_MIXED_LIMIT = 15

# FR1 and FR4 are conserved frameworks, about 24 and 11 residues. A shorter one
# means the read started inside FR1 or stopped inside FR4, so the VDJRegion is
# clipped even though CDR3 and the genes are sound.
MIN_FR1 = 20
MIN_FR4 = 9

# A read runs from the signal peptide through the V domain and on into the constant region,
# so most reads carry a 3' tail the domain view leaves out. `flank5Nt`/`flank3Nt` report how
# much read sits outside the VDJRegion on each side, so nothing the clone omits is hidden.
# A combined flank larger than a V-plus-constant read explains is unusual and gets a note: it
# can mean a second domain (an scFv read through the linker) or vector past the constant. The
# threshold is a guide, not a rule, and the flag is information, not a fault.
FLANK_UNUSUAL_NT = 230

PASSED = "Passed"
WARNING = "Warning"
FAILED = "Failed"

# In priority order. A well takes the first reason any of its chains has.
FAILED_REASONS = ["Low read quality", "Annotation failed", "Incomplete domain", "Non productive",
                  "Missing chain"]
WARNING_REASONS = ["Mixed sequence", "Chain label disagrees", "Ambiguous pairing"]

# Which well verdicts reach the variants and abundance tables. None lets every well through.
EXPORT_VERDICTS = {"passed": {PASSED}, "passedAndWarning": {PASSED, WARNING}, "all": None}

# What each reason means, for the page. Kept beside the rules so a renamed
# reason or a moved limit cannot leave its explanation behind.
REASON_HELP = {
    "Low read quality": "No read from this well kept enough good bases after trimming, or the file "
                        "could not be read.",
    "Annotation failed": "A read passed the quality threshold, but no variable domain was found "
                         "in the merged sequence or in either read. Often, read errors shift the "
                         "reading frame.",
    "Incomplete domain": "The variable domain stops before CDR3 or FR4, usually because the read "
                         "ended early.",
    "Non productive": "The variable domain has a stop codon.",
    "Missing chain": "Only one chain of a paired antibody was found.",
    "Mixed sequence": "More than %d double peaks in CDR3, or more than %d across the whole "
                      "domain. Usually two templates in one well." % (MIXED_LIMIT, DOMAIN_MIXED_LIMIT),
    "Chain label disagrees": "The file name says one chain, and the sequence reads as another.",
    "Ambiguous pairing": "A well holds more than one candidate for a chain, so the pair cannot be "
                         "chosen.",
}


def reason_help():
    """Every reason in priority order, with its verdict and what it means."""
    return ([{"label": r, "verdict": FAILED, "help": REASON_HELP[r]} for r in FAILED_REASONS]
            + [{"label": r, "verdict": WARNING, "help": REASON_HELP[r]} for r in WARNING_REASONS])

NO_PLATE = "No plate"

# What the file name's chain label means, in ANARCI's buckets. Only a label this
# knows is evidence; anything else is a name we cannot read, not a contradiction.
# Every chain word the name pattern reads has a class here. An isotype names
# the constant region of a heavy chain.
DECLARED_CLASS = {
    "igh": "H", "h": "H", "heavy": "H", "vh": "H", "hc": "H", "vhh": "H",
    "igg": "H", "igg1": "H", "igg2": "H", "igg3": "H", "igg4": "H", "igm": "H",
    "iga": "H", "iga1": "H", "iga2": "H", "igd": "H", "ige": "H",
    "igl": "KL", "igk": "KL", "l": "KL", "k": "KL", "light": "KL", "kappa": "KL",
    "lambda": "KL", "vl": "KL", "vk": "KL", "lc": "KL", "kc": "KL",
    "tra": "A", "alpha": "A", "trb": "B", "beta": "B",
    "trg": "G", "gamma": "G", "trd": "D", "delta": "D",
}

# ANARCI tells kappa from lambda only as one class. MiXCR, where it aligned the
# sequence, names the locus.
CLASS_NAME = {"H": "IGH", "KL": "IGK/IGL", "A": "TRA", "B": "TRB", "G": "TRG", "D": "TRD"}
LOCUS_CLASS = {"IGH": "H", "IGK": "KL", "IGL": "KL", "TRA": "A", "TRB": "B", "TRG": "G",
               "TRD": "D"}


def detected_chain(entry):
    """The chain the sequence itself shows: MiXCR's locus where it agrees with
    ANARCI's class, else ANARCI's class. Empty where nothing was numbered."""
    observed = entry.get("observedChain", "")
    locus = entry.get("mixcrChains", "")
    if observed and LOCUS_CLASS.get(locus) == observed:
        return locus
    return CLASS_NAME.get(observed, "")

PAIRED = "Paired"
SINGLE_DOMAIN = "Single domain"
UNPAIRED = "Unpaired"
AMBIGUOUS = "Ambiguous"
NO_SEQUENCE = "No sequence"


def chain_class(entry):
    """What the sequence is, preferring what ANARCI saw over what the name said."""
    observed = entry.get("observedChain")
    if observed:
        return observed
    return DECLARED_CLASS.get(entry["declaredChain"].strip().lower(), "")


def pairing_applies(annotations, declared):
    """Whether the set holds pairs to make.

    A set that names no chain, or names only one across every file, does not.
    Calling those clones unpaired would report a whole heavy-only plate as
    ninety-six failures (R20).
    """
    # Counted by class, so a heavy-only plate labelled IgG1 and IgG2 is still
    # one chain. A word with no class counts as its own.
    labels = {e["declaredChain"].strip().lower() for e in annotations}
    labels.discard("")
    return declared and len({DECLARED_CLASS.get(label, label) for label in labels}) >= 2


def pair_up(annotations, declared):
    """Hold a clone's two chains together, and say so when they cannot be.

    `declared` is whether the set states a chain at all. Where it does not, the
    material is already one sequence and nothing is held up waiting for a
    partner it was never going to have (R20).
    """
    # Labels are checked whether or not there are pairs to make: a heavy-only
    # plate that holds a light chain is wrong all the same.
    mismatched = check_labels(annotations)
    if not pairing_applies(annotations, declared):
        for entry in annotations:
            entry["pairStatus"] = SINGLE_DOMAIN
        return [], mismatched

    groups = {}
    for entry in annotations:
        groups.setdefault(entry.get("pairKey", ""), []).append(entry)

    unpaired = []
    for members in groups.values():
        # Only a read the sequence itself identifies can be a chain of this
        # clone. A protocol fires every primer at every well, so a file that
        # yielded nothing is a failed attempt, not a competing chain, and
        # counting it would make a clean well look ambiguous.
        candidates = [m for m in members if m.get("observedChain")]
        for member in members:
            if member not in candidates:
                member["pairStatus"] = NO_SEQUENCE

        classes = [chain_class(m) for m in candidates]
        if len(candidates) == 1:
            candidates[0]["pairStatus"] = UNPAIRED
            unpaired.append(where(candidates[0]))
        elif len(candidates) == 2 and classes[0] != classes[1]:
            for one, other in ((candidates[0], candidates[1]), (candidates[1], candidates[0])):
                one["pairStatus"] = PAIRED
                one["pairedWith"] = sequence_key(other)
        elif len(candidates) > 1:
            # Two of the same chain, or more than two. Pairing one of them with
            # a neighbour would be a guess.
            for member in candidates:
                member["pairStatus"] = AMBIGUOUS
                unpaired.append(where(member))

    return sorted(unpaired), mismatched


def check_labels(annotations):
    """Mark every sequence whose file name says one chain and whose bases read
    as another, and list them. Only a clear contradiction counts: an unread
    label on either side is not evidence of anything."""
    mismatched = []
    for entry in annotations:
        declared_as = DECLARED_CLASS.get(entry["declaredChain"].strip().lower(), "")
        observed = entry.get("observedChain", "")
        if declared_as and observed and declared_as != observed:
            entry["chainMismatch"] = True
            mismatched.append("%s (name says %s, sequence says %s)"
                              % (where(entry), entry["declaredChain"], observed))
    return sorted(mismatched)


def where(entry):
    return " ".join(x for x in (entry["plate"], entry["well"], entry["declaredChain"]) if x)


# Read by header name. The preset contributes its own columns first and the
# fields the workflow asks for are appended after them, so a column's position
# is not ours to predict.
MIXCR_FIELDS = {
    "id": "descrsR1",
    "chains": "topChains",
    "vGene": "bestVGene",
    "dGene": "bestDGene",
    "jGene": "bestJGene",
    "cGene": "bestCGene",
    "vHit": "bestVHit",
    "dHit": "bestDHit",
    "jHit": "bestJHit",
    "cHit": "bestCHit",
    "isotype": "isotypePrimary",
    "vScore": "bestVHitScore",
    # The V/D/J alignments and the read, for the germline mismatch track. MiXCR's
    # germline feature export cannot render CDR3; the alignments carry the per-gene
    # ranges and mutations needed to rebuild it.
    "vAlignment": "bestVAlignment",
    "dAlignment": "bestDAlignment",
    "jAlignment": "bestJAlignment",
    "readSequence": "targetSequences",
}

# The V/D/J/C coverage markup is read by prefix, not a fixed name: MiXCR renames the
# window feature in the header (e.g. `{CDR1Begin:CDR3End}` becomes `CDR1_TO_CDR3`).
# read_mixcr finds the one `nAnnotationOfSegmentsFor...` column and pairs it with its
# `nSeq...`.
MIXCR_SEGMENTS_PREFIX = "nAnnotationOfSegmentsFor"

# The gene features MiXCR counts mutations over, matching mixcr-clonotyping so the
# columns mean the same thing. A read that does not cover a feature gets MiXCR's
# not-covered token, which the p-column spec turns into NA.
V_CORE = "{FR1Begin:FR3End}"
J_CORE = "FR4"

# MiXCR writes each of these under a header that joins the field and the gene
# feature with no separator, for example "nMutationsCount{FR1Begin:FR3End}" or
# "nMutationsCountFR4". The feature strings here must match the arguments the
# workflow passes to exportAlignments. read_mixcr finds each column by joining
# them; if the header format ever differs it reports the real headers instead of
# guessing (see read_mixcr).
MIXCR_PARAM_FIELDS = {
    "vNtMutCount": ("nMutationsCount", V_CORE),
    "vNtMutRate": ("nMutationsRate", V_CORE),
    "vAaMutCount": ("aaMutationsCount", V_CORE),
    "vAaMutRate": ("aaMutationsRate", V_CORE),
    "jNtMutCount": ("nMutationsCount", J_CORE),
    "jNtMutRate": ("nMutationsRate", J_CORE),
    "jAaMutCount": ("aaMutationsCount", J_CORE),
    "jAaMutRate": ("aaMutationsRate", J_CORE),
    "nMutations": ("nMutationsCount", V_CORE + "," + J_CORE),
    "nAaMutCDR": ("aaMutationsCount", "CDR1,CDR2"),
    "nAaMutFWR": ("aaMutationsCount", "FR1,FR2,FR3,FR4"),
    "vjJunctionLen": ("nLength", "VJJunction"),
    "vdJunctionLen": ("nLength", "VDJunction"),
    "djJunctionLen": ("nLength", "DJJunction"),
}


def _to_number(value):
    """A mutation count or rate as a number, or None for empty / not-covered."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# The germline and mutation fields added for mixcr-clonotyping parity, in one
# place so the sequence table's header and row cannot drift apart. `productive`
# is not here: the sequence table already carries it.
MIXCR_EXTRA_COLUMNS = ["cGene", "cHit", "isotype",
                       "vNtMutCount", "vNtMutRate", "vAaMutCount", "vAaMutRate",
                       "jNtMutCount", "jNtMutRate", "jAaMutCount", "jAaMutRate",
                       "nMutations", "nAaMutCDR", "nAaMutFWR", "fractionCDRMutations"]


# The sequence viewer reads V/D/J/C coverage from a markup string,
# "<id>:<start>+<length>|...", start and length in base 36, positions on the
# sequence it marks. MiXCR writes this for its own VDJRegion; the block re-bases
# it onto its own VDJRegion, in nucleotides.
_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"

# The shared run two VDJRegions of the same molecule must have before their
# offset is trusted. One codon is far too little; a real pair shares most of the
# region, so this only rejects sequences that do not correspond at all.
MIN_SEGMENT_OVERLAP = 30

# The germline-over-read and the block's VDJRegion are the same molecule, but every
# mutation breaks their shared run, so on a heavily mutated V the longest clean run is
# short. This is low enough to still place it, high enough to reject a read that does
# not correspond at all.
MIN_GERMLINE_NT_OVERLAP = 9

# Marks a position the germline does not cover — the non-templated CDR3 junction and
# the flanks. The viewer draws it as "no germline" so a gap is not read as a match.
GERMLINE_GAP = "."


def _to_b36(n):
    if n <= 0:
        return "0"
    out = ""
    while n > 0:
        out = _B36[n % 36] + out
        n //= 36
    return out


def parse_markup(value):
    """The (id, start, length) spans of a markup string. Unreadable parts are skipped."""
    entries = []
    for part in (value or "").split("|"):
        m = re.match(r"^([^:]*):([0-9A-Za-z]+)(?:\+([0-9A-Za-z]+))?$", part)
        if m:
            length = int(m.group(3), 36) if m.group(3) else 1
            entries.append((m.group(1), int(m.group(2), 36), length))
    return entries


def encode_markup(entries):
    return "|".join("%s:%s+%s" % (i, _to_b36(s), _to_b36(n)) for i, s, n in entries)


def project_segments(markup, mixcr_vdj, own_vdj):
    """MiXCR's V/D/J/C spans, moved from the window MiXCR measured them on onto
    the block's own VDJRegion, clipped to it, and stretched to cover the frame.

    The window is CDR1Begin:FR4End, so it is a substring of the block's VDJRegion
    offset by FR1. They are the same molecule, so they share a long run, but
    neither need be a substring of the other: the block's VDJRegion is built
    codon by codon from ANARCI's numbering, so it is a whole number of codons,
    while MiXCR's window is not, and the two are trimmed differently at each end.
    The longest shared run fixes the offset and tolerates staggered ends and the
    odd differing base. `own[i]` is `mixcr[i + offset]`.

    FR1 sits before the window and is part of V; FR4 may run past it and is part
    of J. So the first span is stretched to the start of the block's region and
    the last to its end, which is what shows the whole chain as V(D)J. Returns ""
    when too little is shared to line them up, so a true mismatch shows nothing
    rather than a wrong span.
    """
    if not markup:
        return ""
    offset = _longest_match_offset(mixcr_vdj, own_vdj, MIN_SEGMENT_OVERLAP)
    if offset is None:
        return ""
    n = len(own_vdj)
    out = []
    for seg_id, start, length in parse_markup(markup):
        s = max(0, start - offset)
        e = min(n, start - offset + length)
        if e > s:
            out.append([seg_id, s, e])
    if not out:
        return ""
    out.sort(key=lambda span: span[1])
    out[0][1] = 0
    out[-1][2] = n
    return encode_markup((seg_id, s, e - s) for seg_id, s, e in out)


def project_germline(window, own_vdj, min_overlap=MIN_GERMLINE_NT_OVERLAP):
    """A germline string aligned position-by-position to the block's own VDJRegion,
    for the viewer's mismatch track.

    The window is the germline over the read, with `GERMLINE_GAP` where no gene is
    templated. It and the block's own VDJRegion are the same molecule except at the
    mutations, so their longest shared run fixes the offset (`own[i]` is
    `window[i + offset]`). Positions the window does not cover stay `GERMLINE_GAP`,
    which the viewer draws as "no germline" rather than a match. Returns "" when the
    window does not line up.
    """
    offset = _longest_match_offset(window, own_vdj, min_overlap)
    if offset is None:
        return ""
    out = [GERMLINE_GAP] * len(own_vdj)
    for i in range(len(out)):
        p = i + offset
        if 0 <= p < len(window):
            out[i] = window[p]
    return "".join(out)


def _longest_match_offset(window, own_vdj, min_overlap):
    """The offset that lines a read-coordinate string up with the block's own VDJRegion:
    `own[i]` is `window[i + offset]`. The two are the same molecule, so their longest
    shared run fixes it. None when too little is shared to trust."""
    if not own_vdj or not window:
        return None
    match = difflib.SequenceMatcher(
        None, own_vdj, window, autojunk=False
    ).find_longest_match(0, len(own_vdj), 0, len(window))
    return (match.b - match.a) if match.size >= min_overlap else None


# MiXCR's compact alignment: `seq1From|seq1To|seq1Size|seq2From|seq2To|mutations|score`
# (`Alignment.toCompactString`). seq1 is the germline, seq2 the read; mutations are in
# germline coordinates, encoded `([SDI])([ACGTN]?)(\d+)([ACGTN]?)` (MutationsUtil).
_MUT_RE = re.compile(r"([SDI])([ACGTNacgtn]?)([0-9]+)([ACGTNacgtn]?)")


def parse_alignment(value):
    """(germlineFrom, germlineTo, readFrom, readTo, mutations) or None. Each mutation
    is (type, germlinePosition, germlineBase, readBase)."""
    if not value or "|" not in value:
        return None
    parts = value.split("|")
    if len(parts) < 6:
        return None
    try:
        g0, g1, r0, r1 = int(parts[0]), int(parts[1]), int(parts[3]), int(parts[4])
    except ValueError:
        return None
    muts = [(m.group(1), int(m.group(3)), m.group(2).upper(), m.group(4).upper())
            for m in _MUT_RE.finditer(parts[5])]
    return (g0, g1, r0, r1, muts)


def _walk_alignment(read_len, alignment):
    """Step one gene's alignment in read order, yielding `(read_index, kind, germline_base)`.
    `kind` is "tpl" for a templated base, where `germline_base` is None at a match (germline
    equals the read) or the germline base at a substitution; "ins" for an inserted read base
    with no germline. A deletion is a germline base the read lacks: it advances the germline
    without a read position, so it yields nothing."""
    g0, g1, r0, r1, muts = alignment
    subs, dels, ins = {}, set(), {}
    for typ, pos, germ_base, _read_base in muts:
        if typ == "S":
            subs[pos] = germ_base
        elif typ == "D":
            dels.add(pos)
        elif typ == "I":
            ins[pos] = ins.get(pos, 0) + 1
    g, r = g0, r0
    while g < g1 and r < r1 and r < read_len:
        if ins.get(g, 0) > 0:
            ins[g] -= 1
            yield r, "ins", None
            r += 1
        elif g in dels:
            g += 1
        else:
            yield r, "tpl", subs.get(g)
            g += 1
            r += 1


def _fill_germline_from_alignment(germline, read, alignment):
    """Write one gene's germline over the read, in place (see `_walk_alignment`)."""
    for r, kind, germ_base in _walk_alignment(len(read), alignment):
        germline[r] = GERMLINE_GAP if kind == "ins" else (read[r] if germ_base is None else germ_base)


def reconstruct_germline_over_read(read, alignments):
    """The germline aligned to the read, from the V/D/J alignments. Positions no gene
    covers (the non-templated junction, flanks) stay `GERMLINE_GAP`. This is the path
    MiXCR's pretty-print uses, and it works across CDR3 where the feature-based
    germline export fails."""
    if not read:
        return ""
    germline = [GERMLINE_GAP] * len(read)
    found = False
    for value in alignments:
        alignment = parse_alignment(value)
        if alignment is not None:
            _fill_germline_from_alignment(germline, read, alignment)
            found = True
    return "".join(germline) if found else ""


def translate_germline(germline_nt):
    """The germline amino acids, codon by codon in frame with the block's VDJRegion.
    A codon holding a gap has no germline residue, so it stays a gap."""
    out = []
    for i in range(0, len(germline_nt) - 2, 3):
        codon = germline_nt[i:i + 3]
        out.append(GERMLINE_GAP if GERMLINE_GAP in codon
                   else CODONS.get(codon.upper(), "X"))
    return "".join(out)


# Segment markup ids, matching the mapping the export declares for the viewer
# (`SEGMENTS_MAPPING` in export-specs.lib.tengo): 1=V, 2=D, 3=J, 4=C.
SEGMENT_IDS = {"V": "1", "D": "2", "J": "3", "C": "4"}


def _templated_runs(read_len, alignment):
    """Read spans one gene templates, as `(start, end)` runs (see `_walk_alignment`). An
    insertion has no germline, so it breaks a run; a deletion yields nothing, so it does not."""
    runs = []
    cur = None
    for r, kind, _germ in _walk_alignment(read_len, alignment):
        if kind == "tpl":
            cur = [r, r + 1] if cur is None else [cur[0], r + 1]
        elif cur:
            runs.append(tuple(cur))
            cur = None
    if cur:
        runs.append(tuple(cur))
    return runs


def segments_from_alignments(read, genes, own_vdj, min_overlap=MIN_GERMLINE_NT_OVERLAP):
    """A V/D/J segments markup for the viewer, from the gene alignments, for when MiXCR's
    own markup is absent (its CDR3 window was not covered though V still aligned).

    `genes` is `[(name, alignment_string), ...]`. Each gene's longest templated run (its
    real body; a short spurious match past a long insertion is left out) is projected onto
    the block's own VDJRegion. The earliest span is stretched back to the region start,
    since FR1 is V. No span is stretched forward: an absent J leaves CDR3 and FR4 unlabelled,
    rather than painting them as V. Returns "" when nothing lines up.
    """
    if not read or not own_vdj:
        return ""
    over_read = reconstruct_germline_over_read(read, [a for _, a in genes])
    offset = _longest_match_offset(over_read, own_vdj, min_overlap)
    if offset is None:
        return ""
    n = len(own_vdj)
    spans = []
    for name, alignment in genes:
        parsed = parse_alignment(alignment)
        if parsed is None:
            continue
        runs = _templated_runs(len(read), parsed)
        if not runs:
            continue
        start, end = max(runs, key=lambda run: run[1] - run[0])
        s, e = max(0, start - offset), min(n, end - offset)
        if e > s:
            spans.append([SEGMENT_IDS[name], s, e])
    if not spans:
        return ""
    spans.sort(key=lambda span: span[1])
    spans[0][1] = 0
    return encode_markup((seg_id, s, e - s) for seg_id, s, e in spans)


def read_anarci(path):
    """Numbering by record id, for one bucket. The best-scoring domain wins."""
    numbering = {}
    if path is None or not pathlib.Path(path).exists():
        return numbering
    with open(path, newline="") as handle:
        rows = list(csv.reader(handle))
    if len(rows) < 2:
        return numbering
    header = rows[0]
    labels = position_columns(header)
    first = len(header) - len(labels)
    score_at = header.index("score") if "score" in header else None
    start_at = header.index("seqstart_index") if "seqstart_index" in header else None
    for row in rows[1:]:
        if not row:
            continue
        record = row[0]
        score = float(row[score_at]) if score_at is not None and row[score_at] else 0.0
        if record in numbering and numbering[record]["score"] >= score:
            continue
        numbering[record] = {
            "score": score,
            "residues": row[first:],
            # Where the domain starts inside the protein ANARCI was given, which
            # is what maps a residue back to its codon.
            "start": int(row[start_at]) if start_at is not None and row[start_at] else 0,
        }
    return {
        k: (labels, v["residues"], v["score"], v["start"]) for k, v in numbering.items()
    }


def read_fasta(path):
    if path is None or not pathlib.Path(path).exists():
        return {}
    out, name, chunks = {}, None, []
    for line in pathlib.Path(path).read_text().splitlines():
        if line.startswith(">"):
            if name is not None:
                out[name] = "".join(chunks)
            name, chunks = line[1:].split()[0], []
        elif name is not None:
            chunks.append(line.strip())
    if name is not None:
        out[name] = "".join(chunks)
    return out


def codon_reader(nucleotide, frame):
    """The three bases behind residue `i` of the protein for this frame."""
    strand = nucleotide if frame < 3 else nucleotide.translate(COMPLEMENT)[::-1]
    offset = frame % 3

    def codon(i):
        at = offset + 3 * i
        return strand[at : at + 3]

    return codon


def read_mixcr(path):
    if path is None or not pathlib.Path(path).exists():
        return {}
    with open(path, newline="") as handle:
        rows = list(csv.reader(handle, delimiter="\t"))
    if len(rows) < 2:
        return {}
    header = rows[0]
    where = {name: header.index(column) for name, column in MIXCR_FIELDS.items()
             if column in header}
    if "id" not in where:
        return {}

    # The segments markup and the window nucleotides it is measured on, matched by
    # prefix because MiXCR renames the window feature in the header.
    seg_col = next((c for c in header if c.startswith(MIXCR_SEGMENTS_PREFIX)), None)
    if seg_col is not None:
        where["mixcrSegmentsNt"] = header.index(seg_col)
        window = seg_col[len(MIXCR_SEGMENTS_PREFIX):]
        vdj_col = "nSeq" + window
        if vdj_col in header:
            where["mixcrVdjNt"] = header.index(vdj_col)

    for name, (prefix, feature) in MIXCR_PARAM_FIELDS.items():
        column = prefix + feature
        if column in header:
            where[name] = header.index(column)
    missing = [name for name in MIXCR_PARAM_FIELDS if name not in where]
    if missing:
        # A parameterised header did not match the "field" + "feature" form. The
        # block still runs without those columns; this names the real headers so
        # the feature strings can be corrected without guessing.
        print("mutation fields not found: %s; MiXCR headers: %s"
              % (", ".join(missing), ", ".join(header)), file=sys.stderr)

    out = {}
    for row in rows[1:]:
        if not row:
            continue
        record = {name: row[i] if i < len(row) else "" for name, i in where.items()}
        # `descrsR1` carries the FASTA header, which is the sequence id.
        key = record["id"].split()
        if key:
            out[key[0]] = record
    return out


def translate(nucleotide):
    return "".join(
        CODONS.get(nucleotide[i : i + 3].upper(), "X")
        for i in range(0, len(nucleotide) - 2, 3)
    )


def stop_region(entry):
    """The first region holding a stop codon, or "" where there is none.

    Each region's nucleotide is the codons behind its numbered residues, so it
    translates in frame on its own. Without nucleotide the residues are all
    there is to look at.
    """
    bases = entry.get("nt") or {}
    amino = entry.get("aa") or {}
    for region in REGIONS:
        protein = translate(bases[region]) if bases.get(region) else amino.get(region, "")
        if "*" in protein:
            return region
    return ""


def domain_complete(entry):
    """A domain that reaches FR4. A read that stops before it cannot be expressed
    as it stands, whatever else it carries."""
    amino = entry.get("aa") or {}
    return bool(amino.get("CDR3")) and bool(amino.get("FR4"))


def region_status(entry):
    """The value of the Regions column. "Truncated" where the domain numbered but
    FR1 or FR4 is clipped: CDR3 and the genes are sound, the VDJRegion is not
    whole. A read that failed to number at all keeps its status."""
    if entry.get("status") != STATUS_ANNOTATED:
        return entry.get("status", "")
    amino = entry.get("aa") or {}
    if len(amino.get("FR1", "")) < MIN_FR1 or len(amino.get("FR4", "")) < MIN_FR4:
        return "Truncated"
    return STATUS_ANNOTATED


def reverse_complement(bases):
    return bases.translate(COMPLEMENT)[::-1]


def read_flanks(nucleotide, frame, vdj_nt):
    """The read nucleotides outside the domain, as `(5', 3')`, or None when the domain is
    not placed. The VDJRegion is a run of the read's codons on the numbered strand, so it is
    a substring of that strand; what comes before it is the 5' leader (signal peptide or
    vector), what comes after is the 3' tail (usually the constant region)."""
    if not nucleotide or not vdj_nt:
        return None
    strand = nucleotide if frame < 3 else reverse_complement(nucleotide)
    at = strand.find(vdj_nt)
    if at < 0:
        return None
    return at, len(strand) - at - len(vdj_nt)


def mixed_positions(target, reads):
    """How many positions of `target` carry a second peak, or None where no read
    shows `target` to look at. `target` is the CDR3 or the whole domain nucleotide.

    `reads` are the trimmed reads behind the sequence, each with the indexes of
    its mixed calls. A position counts only when every read that covers `target`
    shows a second peak there: noise rarely repeats at the same spot in two
    reactions, and a second molecule does.
    """
    if not target:
        return None
    found = []
    for read in reads:
        bases, mixed = read["bases"], set(read["mixed"])
        at = bases.find(target)
        if at >= 0:
            found.append({i for i in range(len(target)) if at + i in mixed})
            continue
        at = reverse_complement(bases).find(target)
        if at >= 0:
            last = len(bases) - 1
            found.append({i for i in range(len(target)) if last - (at + i) in mixed})
    if not found:
        return None
    return len(set.intersection(*found))


def pick_frame(seq_id, by_bucket):
    """The frame and bucket ANARCI numbered best.

    Six frames go in and at most one is a variable domain, so the winner is the
    frame the sequence is actually in. That is the reading frame decided by
    shape rather than by a reference.
    """
    best = None
    for bucket, numbering in by_bucket.items():
        for frame in range(6):
            found = numbering.get("%s|%d" % (seq_id, frame))
            if found is None:
                continue
            if best is None or found[2] > best[3]:
                best = (bucket, frame, found, found[2])
    return best


def domain_score(candidate_id, by_bucket, scheme):
    """Whether the candidate numbers a whole domain, and how many residues number."""
    best = pick_frame(candidate_id, by_bucket)
    if best is None:
        return False, 0
    bucket, _, (labels, residues, _, start), _ = best
    amino, _ = build_regions(labels, residues, REGION_RANGES[scheme][BUCKET_TABLE[bucket]],
                             None, start)
    return domain_complete({"aa": amino}), sum(len(v) for v in amino.values())


def choose_candidate(sequence, by_bucket, scheme):
    """Keep whichever of the merge and the single reads numbers best.

    A merge can break a frame neither read had, and a fallback picked by length
    can be the worse read. A whole domain wins; among whole domains the merge
    does, since two reads vouch for it; otherwise the most residues numbered.
    Returns the id the numbering and the nucleotide are read under.
    """
    options = [sequence] + sequence.get("alternatives", [])
    if len(options) == 1:
        return sequence["id"]

    def rank(option):
        complete, numbered = domain_score(option["id"], by_bucket, scheme)
        return (complete, complete and option.get("source") == "merged", numbered)

    winner = max(options, key=rank)
    if winner is sequence:
        return sequence["id"]
    was = "The merge" if sequence.get("source") == "merged" else "The %s read" % sequence.get("source")
    sequence.update({k: winner[k] for k in ("source", "reads", "length", "meanQuality",
                                             "qualityScale")})
    sequence.pop("mismatches", None)
    sequence["reason"] = "%s numbered less of the domain than the %s read" % (was, winner["source"])
    return winner["id"]


# A sequence is one plate, one well, one chain. The same key the p-frame axis uses.
def sequence_key(entry):
    return "|".join([entry["plate"], entry["well"], entry["declaredChain"]])


def sequence_reason(entry, sequence):
    """The first reason this chain on its own fails or gets a warning, or "Passed"."""
    if sequence.get("source") == "none":
        return "Low read quality"
    if not entry.get("observedChain"):
        return "Annotation failed"
    failed, warning = chain_reasons(entry)
    reasons = ([r for r in FAILED_REASONS if r in failed]
               + [r for r in WARNING_REASONS if r in warning])
    return reasons[0] if reasons else PASSED


def write_sequences(path, annotations, sequences, properties):
    """One row per sequence, flat, ready for xsv to turn into p-columns."""
    by_id = {m["id"]: m for m in sequences}
    names = [p["name"] for p in properties]
    header = (
        ["sequenceKey", "plate", "well", "detectedChain", "chain", "qcReason", "pairStatus", "pairedWith", "chainMismatch",
         "source", "length", "meanQuality", "qualityScale", "mismatches", "extraReads",
         "note", "regionStatus", "observedChain", "frame", "productive", "stopRegion",
         "mixedPositions", "flank5Nt", "flank3Nt", "unusualFlank",
         "vGene", "dGene", "jGene", "vHit", "dHit", "jHit",
         "mixcrChains", "vAlignment"]
        + MIXCR_EXTRA_COLUMNS
        + ["aa_%s" % f for f in FEATURES]
        + ["nt_%s" % f for f in FEATURES]
        + ["prop_%d" % i for i in range(len(names))]
    )

    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        for entry in annotations:
            sequence = by_id.get(entry["id"], {})
            amino = entry.get("aa", {})
            bases = entry.get("nt", {})
            # The sheet measures a well, so both chains of one well carry it.
            well_key = entry["plate"] + "\u0000" + entry["well"]
            writer.writerow(
                [sequence_key(entry), entry["plate"], entry["well"], detected_chain(entry),
                 entry["declaredChain"], sequence_reason(entry, sequence),
                 entry.get("pairStatus", ""), entry.get("pairedWith", ""),
                 "yes" if entry.get("chainMismatch") else "",
                 sequence.get("source", ""), sequence.get("length", ""),
                 sequence.get("meanQuality", ""), sequence.get("qualityScale", ""),
                 sequence.get("mismatches") if sequence.get("mismatches") is not None else "",
                 sequence.get("extraReads", ""), sequence.get("reason", ""),
                 entry.get("regionStatus", entry.get("status", "")), entry.get("observedChain", ""),
                 entry.get("frame", ""), entry.get("productive", ""),
                 entry.get("stopRegion", ""), entry.get("mixedPositions", ""),
                 entry.get("flank5Nt", ""), entry.get("flank3Nt", ""),
                 entry.get("unusualFlank", ""),
                 entry.get("vGene", ""), entry.get("dGene", ""),
                 entry.get("jGene", ""), entry.get("vHit", ""),
                 entry.get("dHit", ""), entry.get("jHit", ""),
                 entry.get("mixcrChains", ""),
                 entry.get("vAlignment", "")]
                + [entry.get(c, "") for c in MIXCR_EXTRA_COLUMNS]
                + [amino.get(f, "") for f in FEATURES]
                + [bases.get(f, "") for f in FEATURES]
                + [p["values"].get(well_key, "") for p in properties]
            )


# Which side of the clone a chain class sits on. For a T-cell receptor the
# heavy side is beta or delta and the light side alpha or gamma.
SIDES = {"H": "heavy", "B": "heavy", "D": "heavy",
         "KL": "light", "A": "light", "G": "light"}

# Mirrored on both sides of a clone. Identity stays unprefixed. The germline and
# mutation fields after jHit are the mixcr-clonotyping per-clone columns: C gene
# and isotype, whether the chain is productive, and the somatic hypermutation of
# V and J. A light chain has no isotype, so it stays empty there.
PER_SIDE = ["chain", "fileChain", "source", "length", "meanQuality", "regionStatus",
            "vGene", "dGene", "jGene", "vHit", "dHit", "jHit",
            "cGene", "cHit", "isotype", "productiveFlag",
            "vNtMutCount", "vNtMutRate", "vAaMutCount", "vAaMutRate",
            "jNtMutCount", "jNtMutRate", "jAaMutCount", "jAaMutRate",
            "nMutations", "nAaMutCDR", "nAaMutFWR", "fractionCDRMutations",
            "cdr3LenNt", "cdr3LenAa", "vjJunctionLen", "vdJunctionLen",
            "djJunctionLen", "totalAddedNt", "flank5Nt", "flank3Nt", "unusualFlank",
            "segmentsNt", "germlineNt", "germlineAa"]


def sides_found(annotations):
    """The sides of a clone that any sequence in the set reads as.

    The tables and the export carry columns only for these, so a heavy-only
    plate has no light columns at all. Where nothing was numbered there is no
    evidence either way, and both sides stay.
    """
    seen = {SIDES.get(e.get("observedChain", "")) for e in annotations}
    found = [side for side in ("heavy", "light") if side in seen]
    return found or ["heavy", "light"]


def pair_columns():
    cols = []
    for side in ("heavy", "light"):
        cols += ["%s_%s" % (side, f) for f in PER_SIDE]
        cols += ["%s_aa_%s" % (side, f) for f in FEATURES]
        cols += ["%s_nt_%s" % (side, f) for f in FEATURES]
    return cols


def _side_value(field, entry, sequence):
    """One scalar of a side, by its name in PER_SIDE. Most fields come straight
    from the annotation; a few read the sequence it was built from."""
    if field == "chain":
        return detected_chain(entry)
    if field == "fileChain":
        return entry.get("declaredChain", "")
    if field in ("source", "length", "meanQuality"):
        return sequence.get(field, "")
    if field == "regionStatus":
        return entry.get("status", "")
    return entry.get(field, "")


def side_cells(entry, by_id):
    """One side of a clone, flat: its facts, then every region twice over.

    The scalars follow PER_SIDE position for position, so the header
    pair_columns() writes stays aligned with the values here.
    """
    if not entry:
        return [""] * len(PER_SIDE) + [""] * (2 * len(FEATURES))
    sequence = by_id.get(entry["id"], {})
    amino = entry.get("aa", {})
    bases = entry.get("nt", {})
    cells = [_side_value(f, entry, sequence) for f in PER_SIDE]
    return cells + [amino.get(f, "") for f in FEATURES] + [bases.get(f, "") for f in FEATURES]


def candidate_pairings(annotations):
    """Every (heavy, light) a clone could be, one entry per candidate pairing.

    Where a side has more than one candidate the clone is already Ambiguous,
    and each combination is carried rather than one of them chosen. Showing one
    and dropping the rest would hide the very thing the status reports.
    """
    groups = {}
    for entry in annotations:
        groups.setdefault(entry.get("pairKey", ""), []).append(entry)

    out = []
    for members in groups.values():
        heavies = [m for m in members if SIDES.get(m.get("observedChain", "")) == "heavy"]
        lights = [m for m in members if SIDES.get(m.get("observedChain", "")) == "light"]
        if not heavies and not lights:
            continue
        for heavy in heavies or [None]:
            for light in lights or [None]:
                out.append({
                    "plate": members[0]["plate"],
                    "well": members[0]["well"],
                    "status": (heavy or light).get("pairStatus", ""),
                    "heavy": heavy,
                    "light": light,
                })
    return out


def write_pairs(path, annotations, sequences, verdicts=()):
    """One row per pair: its two chains, side by side.

    R18 asks for the clone to be what goes forward rather than its parts.
    A group with only one side still gets a row, with that side filled — the
    other half is missing, which is a fact about the clone, not a reason to
    leave it out.
    """
    by_id = {m["id"]: m for m in sequences}
    by_well = {(w["plate"], w["well"]): w for w in verdicts}
    header = ["pairId", "plate", "well", "pairStatus", "qcReason"] + pair_columns()
    used = set()

    def unique(key):
        candidate, n = key, 1
        while candidate in used:
            n += 1
            candidate = "%s#%d" % (key, n)
        used.add(candidate)
        return candidate

    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        for pairing in candidate_pairings(annotations):
            key = "|".join([pairing["plate"], pairing["well"]])
            writer.writerow(
                [unique(key), pairing["plate"], pairing["well"], pairing["status"],
                 by_well.get((pairing["plate"], pairing["well"]), {}).get("reason", "")]
                + side_cells(pairing["heavy"], by_id) + side_cells(pairing["light"], by_id)
            )


def summarise(values):
    """What a set of numbers can honestly be reduced to.

    R14 says the right summary depends on what was measured, and nothing in the
    data says whether a reading is a titre, a count or a date. So all four are
    carried and the scientist turns on the one that fits.
    """
    numbers = []
    for v in values:
        try:
            numbers.append(float(v))
        except (TypeError, ValueError):
            return None
    if not numbers:
        return None
    numbers.sort()
    middle = len(numbers) // 2
    median = (numbers[middle] if len(numbers) % 2
              else (numbers[middle - 1] + numbers[middle]) / 2)
    return {
        "min": numbers[0],
        "median": round(median, 4),
        "max": numbers[-1],
        "mean": round(sum(numbers) / len(numbers), 4),
    }


def clone_columns(properties):
    cols = ["cloneId", "wells", "wellCount", "pairStatus", "qcVerdict", "qcReason"] + pair_columns()
    for i in range(len(properties)):
        cols += ["prop_%d_values" % i, "prop_%d_disagrees" % i]
        cols += ["prop_%d_%s" % (i, s) for s in ("min", "median", "max", "mean")]
    return cols


def exported_pairings(annotations, accepted=None):
    """The candidate pairings from the accepted wells; all of them where
    `accepted` is None."""
    return [p for p in candidate_pairings(annotations)
            if accepted is None or (p["plate"], p["well"]) in accepted]


def clones_by_key(annotations, accepted=None):
    """The accepted pairings grouped by clone, one per well.

    A well with two identical candidates for a chain gives two pairings of the
    same clone. It is still one well, so it is counted, listed and measured once.
    """
    groups = {}
    for pairing in exported_pairings(annotations, accepted):
        key = variant_key_of(pairing)
        if key is None:
            continue
        wells = groups.setdefault(key, {})
        wells.setdefault((pairing["plate"], pairing["well"]), pairing)
    return {key: list(wells.values()) for key, wells in groups.items()}


def well_name(pairing):
    return " ".join(x for x in (pairing["plate"], pairing["well"]) if x)


def accepted_wells(verdicts, export):
    """The wells whose clones leave the block, by the export setting."""
    allowed = EXPORT_VERDICTS[export]
    if allowed is None:
        return None
    return {(w["plate"], w["well"]) for w in verdicts if w["verdict"] in allowed}


def write_abundance(path, annotations, accepted=None):
    """Wells per plate, per variant: the long shape an abundance column needs.

    The sample is the plate, so a variant seen on two plates carries a count
    for each rather than one total.
    """
    groups = clones_by_key(annotations, accepted)

    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["sampleId", "variantKey", "wellCount"])
        for members in sorted(groups.values(), key=lambda g: -len(g)):
            per_plate = {}
            for m in members:
                per_plate[m["plate"]] = per_plate.get(m["plate"], 0) + 1
            for plate in sorted(per_plate):
                writer.writerow([plate or "set", clone_key(members[0]), per_plate[plate]])


def write_trace_reads(path, annotations, sequences, reads, accepted=None):
    """The one read the sequence viewer shows per variant and chain.

    A variant is the clone's first well, the same well its sequences are taken
    from in the clones table. Of the reads behind that well's sequence, the one
    with the longest usable stretch is the one worth looking at. `chain` is the
    paired-chain letter the exported columns carry: A heavy, B light.
    """
    by_id = {m["id"]: m for m in sequences}
    usable = {r["path"]: r.get("usableLength") or 0 for r in reads}
    groups = clones_by_key(annotations, accepted)

    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["variantKey", "chain", "path"])
        for members in groups.values():
            first = members[0]
            key = clone_key(first)
            for side, chain in (("heavy", "A"), ("light", "B")):
                entry = first.get(side)
                paths = by_id.get(entry["id"], {}).get("reads", []) if entry else []
                if paths:
                    writer.writerow([key, chain, max(paths, key=lambda p: usable.get(p, 0))])


def clone_key(pairing):
    """The key mixcr-clonotyping gives a clonotype, built the same way.

    SHA-256 of the identity parts joined by "#", in base64 with only letters
    and digits kept, cut to the 21 characters that hold 120 bits. The same
    chains get the same key in every run.
    """
    parts = variant_key_of(pairing).split("\u0000")
    digest = hashlib.sha256("#".join(parts).encode()).digest()
    return re.sub(r"[^a-zA-Z0-9]", "", base64.b64encode(digest).decode())[:21]


def clone_labels(keys):
    """Short ids for keys, as mixcr-clonotyping writes them: "C-" and the first
    five letters of the key, uppercased. Keys that share those letters are
    numbered in key order from the second on: C-ABCDE, C-ABCDE-2."""
    by_prefix = {}
    for key in sorted(keys):
        by_prefix.setdefault(re.sub(r"\d", "", key)[:5].upper(), []).append(key)
    labels = {}
    for prefix, members in by_prefix.items():
        for rank, key in enumerate(members, start=1):
            labels[key] = "C-" + prefix if rank == 1 else "C-%s-%d" % (prefix, rank)
    return labels


def variant_key_of(pairing):
    """Exact identity: the nucleotide of both chains, letter for letter."""
    key = "\u0000".join([
        ((pairing["heavy"] or {}).get("nt", {}) or {}).get("VDJRegion", ""),
        ((pairing["light"] or {}).get("nt", {}) or {}).get("VDJRegion", ""),
    ])
    return None if key == "\u0000" else key


def best_verdict(members, by_well):
    """The verdict and first reason of the best well behind a variant.

    The same sequence can read cleanly in one well and badly in another; the
    clean well is what vouches for the sequence.
    """
    order = [PASSED, WARNING, FAILED]
    found = [by_well[(m["plate"], m["well"])] for m in members
             if (m["plate"], m["well"]) in by_well]
    if not found:
        return "", ""
    best = min(found, key=lambda w: order.index(w["verdict"]))
    return best["verdict"], best["reason"]


def write_clones(path, annotations, sequences, properties, counts=None, accepted=None,
                   verdicts=()):
    """One row per distinct clone, with every well it was seen in.

    Identity is the nucleotide of both chains, letter for letter, and nothing
    looser (R17). After collapse a clone is not in a well; it was observed
    in several, so the wells travel with it and so does everything measured on
    each of them (R12).
    """
    by_id = {m["id"]: m for m in sequences}
    by_well = {(w["plate"], w["well"]): w for w in verdicts}
    groups = clones_by_key(annotations, accepted)

    header = ["variantKey"] + clone_columns(properties)
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        if counts is not None:
            counts["pairsIn"] = sum(len(g) for g in groups.values())
            counts["clonesOut"] = len(groups)
        keys = {id(g): clone_key(g[0]) for g in groups.values()}
        labels = clone_labels(keys.values())
        for members in sorted(groups.values(), key=lambda g: -len(g)):
            first = members[0]
            key = keys[id(members)]
            row = [key, labels[key], ", ".join(well_name(m) for m in members), len(members),
                   first["status"]]
            row += best_verdict(members, by_well)
            row += side_cells(first["heavy"], by_id) + side_cells(first["light"], by_id)

            for i, prop in enumerate(properties):
                # Each value keeps its well, so a well nobody measured shows by
                # its absence rather than shifting the others.
                seen = []
                for m in members:
                    v = prop["values"].get(m["plate"] + "\u0000" + m["well"])
                    if v is not None and v != "":
                        seen.append((well_name(m), v))
                values = [v for _, v in seen]
                # R15: six wells reading differently is a result in itself, and
                # one summarised number hides it. A clone whose wells agree
                # carries no mark.
                disagrees = "yes" if len(set(values)) > 1 else ""
                summary = summarise(values)
                row += [", ".join("%s: %s" % pair for pair in seen), disagrees]
                row += [summary[s] if summary else "" for s in ("min", "median", "max", "mean")]
            writer.writerow(row)


def chain_reasons(entry):
    """What is wrong with one chain the sequence identified, as failed and warning reasons."""
    failed, warning = set(), set()
    if entry.get("status") != STATUS_ANNOTATED:
        failed.add("Annotation failed")
    elif not entry.get("domainComplete"):
        failed.add("Incomplete domain")
    elif entry.get("stopRegion"):
        failed.add("Non productive")
    if entry.get("pairStatus") == UNPAIRED:
        failed.add("Missing chain")
    if entry.get("pairStatus") == AMBIGUOUS:
        warning.add("Ambiguous pairing")
    if ((entry.get("mixedPositions") or 0) > MIXED_LIMIT
            or (entry.get("mixedPositionsDomain") or 0) > DOMAIN_MIXED_LIMIT):
        warning.add("Mixed sequence")
    if entry.get("chainMismatch"):
        warning.add("Chain label disagrees")
    return failed, warning


def well_verdicts(annotations, sequences):
    """One verdict per well, from its worst chain.

    A file whose read died is a failed attempt, not a failed well. A chain that
    read but numbered nothing means the well failed to describe it, unless the
    same side is already held by a complete chain: a dual-primer protocol fires
    both light primers at every well, so the empty light beside a clean pair is
    another failed attempt. A well with no germline passes: lacking a reference
    is not a failed annotation (R31).
    """
    by_id = {m["id"]: m for m in sequences}
    groups = {}
    for entry in annotations:
        groups.setdefault((entry["plate"], entry["well"]), []).append(entry)

    out = []
    for (plate, well), members in sorted(groups.items()):
        described = [e for e in members if e.get("observedChain")]
        read = [e for e in members if by_id.get(e["id"], {}).get("source") != "none"]
        failed, warning = set(), set()
        if not read:
            failed.add("Low read quality")
        else:
            for entry in read:
                if entry.get("observedChain"):
                    continue
                side = SIDES.get(DECLARED_CLASS.get(entry["declaredChain"].strip().lower(), ""), "")
                if not (side and chain_passed(members, side)):
                    failed.add("Annotation failed")
                    break
        for entry in described:
            f, c = chain_reasons(entry)
            failed |= f
            warning |= c

        failed_reasons = [r for r in FAILED_REASONS if r in failed]
        warning_reasons = [r for r in WARNING_REASONS if r in warning]
        reasons = failed_reasons + warning_reasons
        verdict = FAILED if failed else WARNING if warning else PASSED
        out.append({
            "plate": plate,
            "well": well,
            "verdict": verdict,
            "reason": reasons[0] if reasons else PASSED,
            "reasons": reasons,
            "failedReasons": failed_reasons,
            "warningReasons": warning_reasons,
        })
    return out


def main_problem(wells):
    """The most common reason among the failed wells, or among those needing a
    look where nothing failed, with its count."""
    for verdict, order in ((FAILED, FAILED_REASONS), (WARNING, WARNING_REASONS)):
        counts = {}
        for w in wells:
            if w["verdict"] == verdict:
                counts[w["reason"]] = counts.get(w["reason"], 0) + 1
        if counts:
            top = max(order, key=lambda r: (counts.get(r, 0), -order.index(r)))
            return "%s (%d)" % (top, counts[top])
    return ""


def share(part, whole):
    return round(part / whole, 4) if whole else 0.0


def chain_passed(members, side):
    """Whether the well holds a chain of this side with nothing wrong with it."""
    for entry in members:
        if SIDES.get(entry.get("observedChain", "")) == side:
            failed, warning = chain_reasons(entry)
            if not failed and not warning:
                return True
    return False


def qc_row(wells, keys_by_well, chains_by_well, sequences, reads):
    """One plate's numbers, or the whole set's.

    `keys_by_well` holds the antibodies of the wells that did not fail, and
    `chains_by_well` every well's annotated chains. A well is redundant when an
    antibody of it is also in another well among `keys_by_well`.
    """
    n = len(wells)
    passed = sum(1 for w in wells if w["verdict"] == PASSED)
    seen = {}
    for keys in keys_by_well.values():
        for key in keys:
            seen[key] = seen.get(key, 0) + 1
    with_antibody = [keys for keys in keys_by_well.values() if keys]
    redundant = sum(1 for keys in with_antibody if any(seen[k] > 1 for k in keys))
    produced = [m for m in sequences if m.get("source") not in (None, "none")]
    return {
        "wells": n,
        "passed": passed,
        "passedShare": share(passed, n),
        "heavyPassed": sum(1 for m in chains_by_well.values() if chain_passed(m, "heavy")),
        "lightPassed": sum(1 for m in chains_by_well.values() if chain_passed(m, "light")),
        "warning": sum(1 for w in wells if w["verdict"] == WARNING),
        "failed": sum(1 for w in wells if w["verdict"] == FAILED),
        "usableReadsShare": share(sum(1 for r in reads if r.get("kept")), len(reads)),
        "mergedShare": share(sum(1 for m in produced if m.get("source") == "merged"), len(produced)),
        "mainProblem": main_problem(wells),
        "uniqueAntibodies": len(seen),
        "redundantShare": share(redundant, len(with_antibody)),
    }


def plate_summary(verdicts, annotations, sequences=(), reads=()):
    """One row per plate, and the same numbers for the whole set.

    Unique antibodies count only wells that gave a usable one. A variant found on
    two plates counts on each, so the plate rows do not add up to the total.
    Redundancy is counted the same way: within the plate for its row, across
    the set for the total. `reads` is every file, with `kept` set on those that
    survived trimming.
    """
    usable = {(w["plate"], w["well"]) for w in verdicts if w["verdict"] != FAILED}
    keys = {}
    for pairing in candidate_pairings(annotations):
        key = variant_key_of(pairing)
        where = (pairing["plate"], pairing["well"])
        if key is not None and where in usable:
            keys.setdefault(where, set()).add(key)
    chains = {}
    for entry in annotations:
        chains.setdefault((entry["plate"], entry["well"]), []).append(entry)

    def row(plate=None):
        mine = (lambda p: True) if plate is None else (lambda p: p == plate)
        return qc_row([w for w in verdicts if mine(w["plate"])],
                      {k: v for k, v in keys.items() if mine(k[0])},
                      {k: v for k, v in chains.items() if mine(k[0])},
                      [m for m in sequences if mine(m.get("plate", ""))],
                      [r for r in reads if mine(r.get("plate", ""))])

    plates = [dict(plate=plate or NO_PLATE, **row(plate))
              for plate in sorted({w["plate"] for w in verdicts})]
    return plates, dict(plates=len(plates), **row())


PLATE_COLUMNS = ["plate", "wells", "passed", "passedShare", "heavyPassed", "lightPassed",
                 "warning", "failed", "usableReadsShare", "mergedShare", "mainProblem",
                 "uniqueAntibodies", "redundantShare"]


def write_plates(path, plates):
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(PLATE_COLUMNS)
        for row in plates:
            writer.writerow([row[c] for c in PLATE_COLUMNS])


# A plate is drawn at its real size even where only a corner of it was used, so
# a half-filled plate reads as half-filled rather than as a small full one.
STANDARD_LAYOUTS = [(8, 12), (16, 24)]
NO_FILE = "No file"
WELL_SIDE_FIELDS = ["meanQuality", "length", "mixedPositions"]


def parse_well(well):
    """A well's row letter and column number, or None for a name off the grid."""
    m = re.match(r"^([A-Za-z]{1,2})0*([0-9]{1,2})$", well.strip())
    if not m or int(m.group(2)) < 1:
        return None
    return m.group(1).upper(), int(m.group(2))


def row_index(row):
    n = 0
    for ch in row:
        n = n * 26 + ord(ch) - 64
    return n - 1


def row_label(index):
    n, out = index + 1, ""
    while n > 0:
        out = chr(65 + (n - 1) % 26) + out
        n = (n - 1) // 26
    return out


def well_columns(properties):
    cols = ["plate", "row", "column", "verdict", "reason"]
    cols += ["%s_%s" % (side, f) for side in ("heavy", "light") for f in WELL_SIDE_FIELDS]
    return cols + ["prop_%d" % i for i in range(len(properties))]


def write_wells(path, verdicts, annotations, sequences, properties):
    """One row per well of every plate, the plate map's data.

    Every well of the plate's layout gets a row, so a dead row or edge shows as
    a gap rather than as a smaller plate. A well with no file reads "No file".
    Each chain's values sit in its own column, by the side the sequence itself
    shows. A well named off the grid has no place to go and is left out.
    """
    by_id = {m["id"]: m for m in sequences}
    by_well = {(w["plate"], w["well"]): w for w in verdicts}
    sides = {}
    for entry in annotations:
        side = SIDES.get(entry.get("observedChain", ""))
        if side:
            sides.setdefault((entry["plate"], entry["well"], side), entry)

    placed = {}
    for (plate, well), w in by_well.items():
        position = parse_well(well)
        if position:
            placed[(plate, position)] = (well, w)

    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(well_columns(properties))
        for plate in sorted({plate for plate, _ in placed}):
            positions = [pos for p, pos in placed if p == plate]
            rows = max(row_index(r) + 1 for r, _ in positions)
            columns = max(c for _, c in positions)
            rows, columns = next(((r, c) for r, c in STANDARD_LAYOUTS
                                  if rows <= r and columns <= c), (rows, columns))
            for r in range(rows):
                for c in range(1, columns + 1):
                    row = row_label(r)
                    well, w = placed.get((plate, (row, c)), (None, None))
                    cells = [plate or NO_PLATE, row, c,
                             w["verdict"] if w else NO_FILE, w["reason"] if w else NO_FILE]
                    for side in ("heavy", "light"):
                        entry = sides.get((plate, well, side)) if well else None
                        sequence = by_id.get(entry["id"], {}) if entry else {}
                        cells += [sequence.get("meanQuality", ""), sequence.get("length", ""),
                                  (entry or {}).get("mixedPositions", "")]
                    key = plate + "\u0000" + (well or "")
                    cells += [p["values"].get(key, "") if well else "" for p in properties]
                    writer.writerow(cells)


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--report", required=True, help="The trace report, for the sequence list")
    p.add_argument("--sequences", required=False, help="Sequence nucleotide FASTA")
    p.add_argument("--scheme", required=True, choices=SCHEMES)
    p.add_argument("--mixcr", required=False, help="MiXCR exportAlignments TSV")
    p.add_argument("--out", required=True)
    p.add_argument("--out_sequences_tsv", required=False, help="One row per sequence, for the p-frame")
    p.add_argument("--out_pairs_tsv", required=False,
                   help="One row per pair, the two chains side by side")
    p.add_argument("--out_clones_tsv", required=False,
                   help="One row per distinct clone, with the wells behind it")
    p.add_argument("--out_abundance_tsv", required=False,
                   help="Wells per plate, per variant")
    p.add_argument("--out_trace_reads_tsv", required=False,
                   help="The read the sequence viewer shows, per variant and chain")
    p.add_argument("--out_wells_tsv", required=False,
                   help="One row per well of every plate, for the plate map")
    p.add_argument("--out_plates_tsv", required=False,
                   help="One row per plate: how its wells came out")
    p.add_argument("--out_sides", required=False,
                   help="The clone sides the set has sequences for, as a JSON list")
    p.add_argument("--peaks", required=False,
                   help="Each kept read's bases and mixed positions, as JSON")
    p.add_argument("--export", choices=sorted(EXPORT_VERDICTS), default="passed",
                   help="Which well verdicts reach the variants and abundance tables")
    p.add_argument("--properties", required=False, help="Mapped sheet columns, as JSON")
    p.add_argument("--chains-declared", action="store_true",
                   help="The set states which chain each file holds, so pairing applies")
    for bucket in BUCKETS:
        p.add_argument("--csv_%s" % bucket.lower(), required=False)
    args = p.parse_args(argv)

    trace_report = json.loads(pathlib.Path(args.report).read_text())
    sequences = trace_report["sequences"]
    by_bucket = {b: read_anarci(getattr(args, "csv_%s" % b.lower())) for b in BUCKETS}
    aligned = read_mixcr(args.mixcr)
    nucleotides = read_fasta(args.sequences)
    peaks = json.loads(pathlib.Path(args.peaks).read_text()) if args.peaks else {}

    annotations, not_numbered, not_aligned = [], [], []
    for sequence in sequences:
        seq_id = sequence["id"]
        where = "%s %s %s" % (sequence["plate"], sequence["well"], sequence["chain"])
        entry = {
            "id": seq_id,
            "plate": sequence["plate"],
            "well": sequence["well"],
            "declaredChain": sequence["chain"],
            "pairKey": sequence.get("pairKey", ""),
        }

        chosen = choose_candidate(sequence, by_bucket, args.scheme)
        best = pick_frame(chosen, by_bucket)
        if best is None:
            entry["status"] = STATUS_FAILED
            # Only a sequence that produced bases can fail to be numbered. One
            # that never had a read is already accounted for upstream.
            if sequence.get("source") != "none":
                not_numbered.append(where.strip())
        else:
            bucket, frame, (labels, residues, _, start), _ = best
            entry["frame"] = frame
            entry["observedChain"] = bucket
            nucleotide = nucleotides.get(chosen)
            amino, bases = build_regions(
                labels,
                residues,
                REGION_RANGES[args.scheme][BUCKET_TABLE[bucket]],
                codon_reader(nucleotide, frame) if nucleotide else None,
                start,
            )
            entry["aa"] = amino
            if nucleotide:
                entry["nt"] = bases
                # How much read sits outside the domain, per side, for traceability. A flank
                # larger than a V-plus-constant read explains gets an informational note.
                flanks = read_flanks(nucleotide, frame, bases.get("VDJRegion", ""))
                if flanks:
                    entry["flank5Nt"], entry["flank3Nt"] = flanks
                    if flanks[0] + flanks[1] > FLANK_UNUSUAL_NT:
                        entry["unusualFlank"] = "yes"
            # CDR3 length from the regions the block itself built, so it matches
            # the block's own CDR3 columns. nt in nucleotides, aa in residues.
            if amino.get("CDR3"):
                entry["cdr3LenAa"] = len(amino["CDR3"])
            if nucleotide and bases.get("CDR3"):
                entry["cdr3LenNt"] = len(bases["CDR3"])
            entry["status"] = STATUS_ANNOTATED if any(amino.values()) else STATUS_FAILED
            if entry["status"] == STATUS_ANNOTATED:
                entry["domainComplete"] = domain_complete(entry)
                entry["stopRegion"] = stop_region(entry)
                entry["regionStatus"] = region_status(entry)
                # Unknown, not unproductive, where the read stopped short.
                entry["productive"] = (
                    "" if not entry["domainComplete"] and not entry["stopRegion"]
                    else "no" if entry["stopRegion"] else "yes"
                )
                # mixcr-clonotyping names this true/false; the sequence table keeps
                # the block's own yes/no for reading.
                entry["productiveFlag"] = {"yes": "true", "no": "false"}.get(
                    entry["productive"], "")
                reads = [peaks[p] for p in sequence.get("reads", []) if p in peaks]
                mixed = mixed_positions(bases.get("CDR3", "") if nucleotide else "", reads)
                if mixed is not None:
                    entry["mixedPositions"] = mixed
                mixed_all = mixed_positions(bases.get("VDJRegion", "") if nucleotide else "", reads)
                if mixed_all is not None:
                    entry["mixedPositionsDomain"] = mixed_all

        hit = aligned.get(chosen)
        if hit is not None:
            # MiXCR writes "-" where it found no hit. An absent gene is absent,
            # not a gene called "-". The same copy carries the germline gene
            # calls, the isotype and the somatic-hypermutation counts and rates.
            for field in ("vGene", "dGene", "jGene", "cGene", "vHit", "dHit",
                          "jHit", "cHit", "isotype", "vAlignment",
                          "vNtMutCount", "vNtMutRate", "vAaMutCount", "vAaMutRate",
                          "jNtMutCount", "jNtMutRate", "jAaMutCount", "jAaMutRate",
                          "nMutations", "nAaMutCDR", "nAaMutFWR",
                          "vjJunctionLen", "vdJunctionLen", "djJunctionLen"):
                value = hit.get(field, "")
                if value not in ("", "-"):
                    entry[field] = value
            # `chains` is MiXCR's locus; it travels under its own entry name.
            if hit.get("chains", "") not in ("", "-"):
                entry["mixcrChains"] = hit["chains"]
            # The share of amino-acid changes that fall in the CDRs. Honest only
            # when some mutation was seen; left empty when V reads as germline.
            cdr = _to_number(entry.get("nAaMutCDR"))
            fwr = _to_number(entry.get("nAaMutFWR"))
            if cdr is not None and fwr is not None and cdr + fwr > 0:
                entry["fractionCDRMutations"] = round(cdr / (cdr + fwr), 4)
            # Total added nucleotides: VD + DJ junctions for a chain with a D gene,
            # else the VJ junction. Matches mixcr-clonotyping.
            vd = _to_number(entry.get("vdJunctionLen"))
            dj = _to_number(entry.get("djJunctionLen"))
            vj = _to_number(entry.get("vjJunctionLen"))
            if vd is not None and dj is not None:
                entry["totalAddedNt"] = int(vd + dj)
            elif vj is not None:
                entry["totalAddedNt"] = int(vj)
            own_vdj = (entry.get("nt") or {}).get("VDJRegion", "")
            read = (hit.get("readSequence", "") or "").split(",")[0]
            genes = [("V", hit.get("vAlignment", "")),
                     ("D", hit.get("dAlignment", "")),
                     ("J", hit.get("jAlignment", ""))]
            # V/D/J/C coverage for the viewer, re-based onto the block's own VDJRegion.
            # MiXCR's own segment markup first; when it is absent (the CDR3 window was not
            # covered though V still aligned) the segments are derived from the same
            # alignments, so a V-only read still shows its V segment and gene, not a blank.
            segments = project_segments(hit.get("mixcrSegmentsNt", ""),
                                        hit.get("mixcrVdjNt", ""), own_vdj)
            if not segments:
                segments = segments_from_alignments(read, genes, own_vdj)
            if segments:
                entry["segmentsNt"] = segments
            # The germline for the viewer's mismatch track, rebuilt from the V/D/J
            # alignments and projected onto the block's VDJRegion. The sample base
            # shows a match, the germline base a difference, a gap where no gene is
            # templated (the junction, the flanks).
            over_read = reconstruct_germline_over_read(read, [a for _, a in genes])
            germline = project_germline(over_read, own_vdj)
            if germline:
                entry["germlineNt"] = germline
                entry["germlineAa"] = translate_germline(germline)
        elif args.mixcr and sequence.get("source") != "none":
            # R31: no germline is not a failed annotation. The sequence keeps its
            # regions, its chain and its translation.
            not_aligned.append(where.strip())

        annotations.append(entry)

    unpaired, mismatched = pair_up(annotations, args.chains_declared)

    properties = (
        json.loads(pathlib.Path(args.properties).read_text()) if args.properties else []
    )
    verdicts = well_verdicts(annotations, sequences)
    if args.out_sequences_tsv:
        write_sequences(args.out_sequences_tsv, annotations, sequences, properties)
    if args.out_pairs_tsv:
        write_pairs(args.out_pairs_tsv, annotations, sequences, verdicts)
    accepted = accepted_wells(verdicts, args.export)
    collapse = {}
    if args.out_clones_tsv:
        write_clones(args.out_clones_tsv, annotations, sequences, properties, collapse,
                       accepted, verdicts)
    if args.out_abundance_tsv:
        write_abundance(args.out_abundance_tsv, annotations, accepted)
    if args.out_trace_reads_tsv:
        write_trace_reads(args.out_trace_reads_tsv, annotations, sequences,
                          trace_report.get("reads", []), accepted)
    # A file Tracy could not read is set aside without ever becoming a read.
    called = {r["path"] for r in trace_report.get("reads", [])}
    files = trace_report.get("reads", []) + [
        dict(s, kept=False) for s in trace_report.get("setAside", []) if s["path"] not in called]
    plates, total = plate_summary(verdicts, annotations, sequences, files)
    if args.out_plates_tsv:
        write_plates(args.out_plates_tsv, plates)
    if args.out_wells_tsv:
        write_wells(args.out_wells_tsv, verdicts, annotations, sequences, properties)

    sides = sides_found(annotations)
    if args.out_sides:
        pathlib.Path(args.out_sides).write_text(json.dumps(sides))

    pathlib.Path(args.out).write_text(
        json.dumps(
            {
                "scheme": args.scheme,
                "annotations": annotations,
                "notNumbered": not_numbered,
                "notAligned": not_aligned,
                "paired": pairing_applies(annotations, args.chains_declared),
                "sides": sides,
                "unpaired": unpaired,
                "chainMismatch": mismatched,
                "collapse": collapse,
                "wells": verdicts,
                "total": total,
                "reasonHelp": reason_help(),
            },
            indent=2,
        )
    )
    print(
        "%d sequences, %d numbered, %d aligned"
        % (
            len(annotations),
            sum(1 for a in annotations if a["status"] == STATUS_ANNOTATED),
            len(aligned),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
