"""Checks for the boundary arithmetic and the ANARCI/MiXCR join.

Standard library only, so no virtual environment is needed. Not wired into
`pnpm test`, which has no python interpreter. Run it by hand from this directory:

    python3 test_annotate.py

The fixtures are invented. Residues are one letter per position, so every
region's expected content is computable and the assertions pin the real boundary
arithmetic rather than just the shape.
"""

import csv
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
sys.path.insert(0, SRC)

from regions import FEATURES, REGION_RANGES, WHOLE, build_regions  # noqa: E402

CODONS = {}
_B = "TCAG"
_A = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
for _i, _aa in enumerate(_A):
    CODONS[_B[_i // 16] + _B[_i // 4 % 4] + _B[_i % 4]] = _aa


def translate(nucleotide):
    return "".join(
        CODONS.get(nucleotide[i : i + 3], "X") for i in range(0, len(nucleotide) - 2, 3)
    )

FAILURES = []


def check(name, got, want):
    if got != want:
        FAILURES.append("%s\n     got  %r\n     want %r" % (name, got, want))


def residue(position):
    """A letter that depends only on the position, so expectations are computable."""
    return "ACDEFGHIKLMNPQRSTVWY"[position % 20]


def numbered(first, last):
    labels = [str(n) for n in range(first, last + 1)]
    return labels, [residue(n) for n in range(first, last + 1)]


def expected(first, last, start, end):
    return "".join(residue(n) for n in range(max(first, start), min(last, end) + 1))


def test_boundaries_follow_the_scheme():
    labels, residues = numbered(1, 130)
    for scheme in ("imgt", "kabat", "chothia"):
        ranges = REGION_RANGES[scheme]["H"]
        regions, _ = build_regions(labels, residues, ranges)
        for region, (start, end) in ranges.items():
            check(
                "%s heavy %s" % (scheme, region),
                regions[region],
                expected(1, 130, start, end),
            )
        check(
            "%s whole domain is every region joined" % scheme,
            regions[WHOLE],
            "".join(regions[r] for r in FEATURES[1:]),
        )


def test_heavy_and_light_differ_under_kabat():
    labels, residues = numbered(1, 130)
    heavy, _ = build_regions(labels, residues, REGION_RANGES["kabat"]["H"])
    light, _ = build_regions(labels, residues, REGION_RANGES["kabat"]["KL"])
    if heavy["CDR1"] == light["CDR1"]:
        FAILURES.append("kabat heavy and light CDR1 should differ")


def test_gaps_and_insertions():
    labels = ["1", "2", "3", "111", "111A", "112"]
    residues = ["E", "-", "Q", "G", "S", "T"]
    regions, _ = build_regions(labels, residues, REGION_RANGES["imgt"]["H"])
    # A gap contributes nothing; an insertion code counts at the position it follows.
    check("gap dropped", regions["FR1"], "EQ")
    check("insertion kept in CDR3", regions["CDR3"], "GST")


def test_nucleotide_matches_the_amino_acid_it_came_from():
    """Every feature's nucleotide must translate back to its own amino acids."""
    labels, residues = numbered(1, 130)
    # A codon per residue, deterministic and distinct from the residue letters.
    nucleotide = "".join(
        [k for k, v in sorted(CODONS.items()) if v == residue(n)][0] for n in range(1, 131)
    )
    amino, bases = build_regions(
        labels, residues, REGION_RANGES["imgt"]["H"], lambda i: nucleotide[3 * i : 3 * i + 3], 0
    )
    for feature in FEATURES:
        check("%s length" % feature, len(bases[feature]), 3 * len(amino[feature]))
        check("%s translates back" % feature, translate(bases[feature]), amino[feature])


def test_the_domain_offset_is_honoured():
    """ANARCI's seqstart_index shifts which codon each residue maps to."""
    labels, residues = numbered(1, 3)
    nucleotide = "AAACCCGGGTTT"
    _, shifted = build_regions(
        labels, residues, REGION_RANGES["imgt"]["H"], lambda i: nucleotide[3 * i : 3 * i + 3], 1
    )
    check("offset skips the first codon", shifted["FR1"], "CCCGGGTTT")


def write_anarci(path, rows):
    header = ["Id", "domain_no", "chain_type", "score", "seqstart_index"] + [
        str(n) for n in range(1, 131)
    ]
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for record, score in rows:
            writer.writerow(
                [record, "0", "H", score, "0"] + [residue(n) for n in range(1, 131)]
            )


def run_annotate(work, report, extra):
    out = os.path.join(work, "annotation.json")
    subprocess.run(
        [sys.executable, os.path.join(SRC, "annotate.py"),
         "--report", report, "--scheme", "imgt", "--out", out] + extra,
        check=True, capture_output=True,
    )
    return json.load(open(out))


def test_the_numbered_frame_wins_and_a_dead_clone_is_not_blamed():
    work = tempfile.mkdtemp()
    report = os.path.join(work, "report.json")
    json.dump({"molecules": [
        {"id": "m0", "plate": "Plate1", "well": "A1", "chain": "IGH", "source": "merged"},
        {"id": "m1", "plate": "Plate1", "well": "A2", "chain": "IGH", "source": "merged"},
        {"id": "m2", "plate": "Plate1", "well": "A3", "chain": "IGL", "source": "none"},
    ]}, open(report, "w"))

    csv_h = os.path.join(work, "h.csv")
    # m0 numbers in frame 4 only; m1 numbers in two frames and the better score wins.
    write_anarci(csv_h, [("m0|4", "120.0"), ("m1|1", "80.0"), ("m1|2", "130.0")])

    result = run_annotate(work, report, ["--csv_h", csv_h])
    by_id = {a["id"]: a for a in result["annotations"]}
    check("frame found", by_id["m0"]["frame"], 4)
    check("chain from shape", by_id["m0"]["observedChain"], "H")
    check("status", by_id["m0"]["status"], "Annotated")
    check("no fasta means no nucleotide", by_id["m0"].get("nt"), None)
    check("better score wins", by_id["m1"]["frame"], 2)
    check("no read is not a numbering failure", result["notNumbered"], [])
    check("dead clone still listed", by_id["m2"]["status"], "Failed")


def test_germline_joins_positionally_and_its_absence_is_reported():
    work = tempfile.mkdtemp()
    report = os.path.join(work, "report.json")
    json.dump({"molecules": [
        {"id": "m0", "plate": "Plate1", "well": "A1", "chain": "IGH", "source": "merged"},
        {"id": "m1", "plate": "Plate1", "well": "A2", "chain": "IGH", "source": "merged"},
    ]}, open(report, "w"))

    csv_h = os.path.join(work, "h.csv")
    write_anarci(csv_h, [("m0|0", "120.0"), ("m1|0", "120.0")])

    # The preset contributes its own columns first and puts the requested
    # fields after them, so the names are what the reader has to go on.
    mixcr = os.path.join(work, "alignments.tsv")
    with open(mixcr, "w") as handle:
        handle.write("readId\ttargetSequences\taaSeqCDR3\ttopChains\tdescrsR1"
                     "\tbestVHit\tbestDHit\tbestJHit\tbestVHitScore\tbestVAlignment\n")
        handle.write("0\tACGT\tCARDY\tIGH\tm0"
                     "\tIGHV3-23*00\t-\tIGHJ4*00\t900\tSA63G\n")

    result = run_annotate(work, report, ["--csv_h", csv_h, "--mixcr", mixcr])
    by_id = {a["id"]: a for a in result["annotations"]}
    check("v gene", by_id["m0"]["vGene"], "IGHV3-23*00")
    check("j gene", by_id["m0"]["jGene"], "IGHJ4*00")
    check("a dash is no gene", by_id["m0"].get("dGene"), None)
    check("departures carried", by_id["m0"]["vAlignment"], "SA63G")
    check("no germline leaves no gene", by_id["m1"].get("vGene"), None)
    check("regions survive without germline", by_id["m1"]["status"], "Annotated")
    check("absence reported", result["notAligned"], ["Plate1 A2 IGH"])


def clone(mol_id, plate, well, chain, pair_key, observed=None):
    e = {"id": mol_id, "plate": plate, "well": well, "declaredChain": chain,
         "pairKey": pair_key}
    if observed:
        e["observedChain"] = observed
    return e


def test_two_chains_of_one_well_pair():
    from annotate import pair_up
    rows = [clone("m0", "Plate1", "A1", "IGH", "k1", "H"),
            clone("m1", "Plate1", "A1", "IGL", "k1", "KL")]
    unpaired, mismatched = pair_up(rows, True)
    check("heavy paired", rows[0]["pairStatus"], "Paired")
    check("points at the light", rows[0]["pairedWith"], "Plate1|A1|IGL")
    check("light points back", rows[1]["pairedWith"], "Plate1|A1|IGH")
    check("nothing unpaired", unpaired, [])
    check("no mismatch", mismatched, [])


def test_a_lone_chain_is_unpaired_not_dropped():
    """A2 has both chains, so the set pairs; A1's light chain never arrived."""
    from annotate import pair_up
    rows = [clone("m0", "Plate1", "A1", "IGH", "k1", "H"),
            clone("m1", "Plate1", "A2", "IGH", "k2", "H"),
            clone("m2", "Plate1", "A2", "IGL", "k2", "KL")]
    unpaired, _ = pair_up(rows, True)
    check("status", rows[0]["pairStatus"], "Unpaired")
    check("the complete well pairs", rows[1]["pairStatus"], "Paired")
    check("listed", unpaired, ["Plate1 A1 IGH"])


def test_two_of_the_same_chain_are_ambiguous_not_guessed():
    from annotate import pair_up
    rows = [clone("m0", "Plate1", "A1", "IGH", "k1", "H"),
            clone("m1", "Plate1", "A1", "IGH", "k1", "H"),
            clone("m2", "Plate1", "A2", "IGL", "k2", "KL")]
    unpaired, _ = pair_up(rows, True)
    check("first", rows[0]["pairStatus"], "Ambiguous")
    check("second", rows[1]["pairStatus"], "Ambiguous")
    check("two of them listed", len([u for u in unpaired if u.endswith("IGH")]), 2)


def test_a_set_that_names_no_chain_passes_through_whole():
    from annotate import pair_up
    rows = [clone("m0", "Plate1", "A1", "", "k1", "H"),
            clone("m1", "Plate1", "A2", "", "k2", "H")]
    unpaired, _ = pair_up(rows, False)
    check("single domain", [r["pairStatus"] for r in rows],
          ["Single domain", "Single domain"])
    check("nothing to report", unpaired, [])


def test_a_failed_primer_does_not_make_a_clean_well_ambiguous():
    """Every primer is fired at every well, so a file that yielded nothing is a
    failed attempt rather than a third chain."""
    from annotate import pair_up
    rows = [clone("m0", "Plate1", "A1", "IgG", "k1", "H"),
            clone("m1", "Plate1", "A1", "Kappa", "k1", "KL"),
            clone("m2", "Plate1", "A1", "Lambda", "k1")]  # no sequence
    unpaired, _ = pair_up(rows, True)
    check("heavy paired", rows[0]["pairStatus"], "Paired")
    check("kappa paired", rows[1]["pairStatus"], "Paired")
    check("lambda is a failed read", rows[2]["pairStatus"], "No sequence")
    check("nothing reported", unpaired, [])


def test_two_light_chains_that_both_sequenced_stay_ambiguous():
    from annotate import pair_up
    rows = [clone("m0", "Plate1", "A1", "IgG", "k1", "H"),
            clone("m1", "Plate1", "A1", "Kappa", "k1", "KL"),
            clone("m2", "Plate1", "A1", "Lambda", "k1", "KL")]
    unpaired, _ = pair_up(rows, True)
    check("all three ambiguous", [r["pairStatus"] for r in rows],
          ["Ambiguous"] * 3)
    check("all three listed", len(unpaired), 3)


def test_a_set_naming_one_chain_is_not_ninety_six_failures():
    """A heavy-only plate declares a chain but holds no pairs to make."""
    from annotate import pair_up
    rows = [clone("m0", "Plate1", "A1", "IgG", "k1", "H"),
            clone("m1", "Plate1", "A2", "IgG", "k2", "H")]
    unpaired, _ = pair_up(rows, True)
    check("single domain", [r["pairStatus"] for r in rows],
          ["Single domain", "Single domain"])
    check("nothing reported", unpaired, [])


def test_a_label_the_sequence_contradicts_is_flagged():
    from annotate import pair_up
    rows = [clone("m0", "Plate1", "A1", "IGH", "k1", "KL"),
            clone("m1", "Plate1", "A1", "IGL", "k1", "KL")]
    _, mismatched = pair_up(rows, True)
    check("one flagged", len(mismatched), 1)
    check("the heavy one", rows[0].get("chainMismatch"), True)
    check("the light one is fine", rows[1].get("chainMismatch"), None)


def test_a_label_nothing_can_read_is_not_a_contradiction():
    from annotate import pair_up
    rows = [clone("m0", "Plate1", "A1", "IgG", "k1", "H")]
    _, mismatched = pair_up(rows, True)
    check("no mismatch from an unread label", mismatched, [])


def test_the_molecule_table_puts_the_two_chains_on_one_row():
    import csv as _csv
    from annotate import pair_up, write_molecules
    work = tempfile.mkdtemp()
    rows = [clone("m0", "Plate1", "A1", "IGH", "k1", "H"),
            clone("m1", "Plate1", "A1", "IGL", "k1", "KL"),
            clone("m2", "Plate1", "A2", "IGH", "k2", "H")]
    for r in rows:
        r["aa"] = {"CDR3": "C" + r["declaredChain"]}
        r["vGene"] = r["declaredChain"] + "V1"
    pair_up(rows, True)
    out = os.path.join(work, "molecules.tsv")
    write_molecules(out, rows, [{"id": r["id"]} for r in rows])
    table = list(_csv.DictReader(open(out), delimiter="\t"))
    check("one row per molecule", len(table), 2)
    first = table[0]
    check("paired", first["pairStatus"], "Paired")
    check("heavy side", first["heavy_aa_CDR3"], "CIGH")
    check("light side", first["light_aa_CDR3"], "CIGL")
    check("heavy germline", first["heavy_vGene"], "IGHV1")
    lone = table[1]
    check("a lone chain still gets a row", lone["heavy_aa_CDR3"], "CIGH")
    check("with the other side empty", lone["light_aa_CDR3"], "")


def test_an_ambiguous_well_writes_every_pairing_it_could_be():
    """Two light chains sequenced means two candidate molecules, not one with
    the second quietly dropped."""
    import csv as _csv
    from annotate import pair_up, write_molecules
    work = tempfile.mkdtemp()
    rows = [clone("m0", "Plate1", "A5", "IgG", "k1", "H"),
            clone("m1", "Plate1", "A5", "Kappa", "k1", "KL"),
            clone("m2", "Plate1", "A5", "Lambda", "k1", "KL")]
    for r in rows:
        r["aa"] = {"CDR3": "C" + r["declaredChain"]}
    pair_up(rows, True)
    out = os.path.join(work, "molecules.tsv")
    write_molecules(out, rows, [{"id": r["id"]} for r in rows])
    table = list(_csv.DictReader(open(out), delimiter="\t"))
    check("one row per candidate", len(table), 2)
    check("both ambiguous", {r["pairStatus"] for r in table}, {"Ambiguous"})
    check("both lights present", sorted(r["light_chain"] for r in table),
          ["Kappa", "Lambda"])
    check("the heavy is on both", {r["heavy_aa_CDR3"] for r in table}, {"CIgG"})
    check("keys are distinct", len({r["moleculeKey"] for r in table}), 2)


def test_a_molecule_with_no_sequence_at_all_is_left_out():
    from annotate import pair_up, write_molecules
    work = tempfile.mkdtemp()
    rows = [clone("m0", "Plate1", "A1", "IGH", "k1"),
            clone("m1", "Plate1", "A2", "IGH", "k2", "H"),
            clone("m2", "Plate1", "A2", "IGL", "k2", "KL")]
    pair_up(rows, True)
    out = os.path.join(work, "molecules.tsv")
    write_molecules(out, rows, [{"id": r["id"]} for r in rows])
    table = open(out).read().splitlines()
    check("only the well that sequenced", len(table) - 1, 1)


def seq_clone(mol_id, well, chain, observed, nt, aa=None):
    e = clone(mol_id, "Plate1", well, chain, "k" + well, observed)
    e["nt"] = {"VDJRegion": nt}
    e["aa"] = {"CDR3": aa or nt[:6]}
    return e


def variants_of(rows, properties=()):
    import csv as _csv
    from annotate import pair_up, write_variants
    work = tempfile.mkdtemp()
    pair_up(rows, True)
    out = os.path.join(work, "variants.tsv")
    write_variants(out, rows, [{"id": r["id"]} for r in rows], list(properties))
    return list(_csv.DictReader(open(out), delimiter="\t"))


def test_identical_molecules_collapse_and_keep_every_well():
    rows = [seq_clone("m0", "A1", "IGH", "H", "ACGTACGT"),
            seq_clone("m1", "A1", "IGL", "KL", "TTTTTTTT"),
            seq_clone("m2", "B2", "IGH", "H", "ACGTACGT"),
            seq_clone("m3", "B2", "IGL", "KL", "TTTTTTTT"),
            seq_clone("m4", "C3", "IGH", "H", "GGGGGGGG"),
            seq_clone("m5", "C3", "IGL", "KL", "TTTTTTTT")]
    table = variants_of(rows)
    check("three molecules, two distinct", len(table), 2)
    biggest = table[0]
    check("seen twice", biggest["wellCount"], "2")
    check("both wells listed", biggest["wells"], "Plate1 A1, Plate1 B2")


def test_one_chain_differing_makes_a_different_molecule():
    rows = [seq_clone("m0", "A1", "IGH", "H", "ACGTACGT"),
            seq_clone("m1", "A1", "IGL", "KL", "TTTTTTTT"),
            seq_clone("m2", "B2", "IGH", "H", "ACGTACGT"),
            seq_clone("m3", "B2", "IGL", "KL", "TTTTTTTA")]
    table = variants_of(rows)
    check("exact identity, nothing looser", len(table), 2)
    check("neither is collapsed", sorted(r["wellCount"] for r in table), ["1", "1"])


def test_wells_that_disagree_on_a_reading_are_marked():
    rows = [seq_clone("m0", "A1", "IGH", "H", "ACGTACGT"),
            seq_clone("m1", "B2", "IGH", "H", "ACGTACGT")]
    prop = {"name": "elisa", "type": "Double",
            "values": {"Plate1\u0000A1": "2.5", "Plate1\u0000B2": "0.1"}}
    table = variants_of(rows, [prop])
    row = table[0]
    check("both values kept", row["prop_0_values"], "2.5, 0.1")
    check("disagreement marked", row["prop_0_disagrees"], "yes")
    check("max", row["prop_0_max"], "2.5")
    check("min", row["prop_0_min"], "0.1")
    check("mean", row["prop_0_mean"], "1.3")


def test_wells_that_agree_carry_no_mark():
    rows = [seq_clone("m0", "A1", "IGH", "H", "ACGTACGT"),
            seq_clone("m1", "B2", "IGH", "H", "ACGTACGT")]
    prop = {"name": "elisa", "type": "Double",
            "values": {"Plate1\u0000A1": "2.5", "Plate1\u0000B2": "2.5"}}
    row = variants_of(rows, [prop])[0]
    check("no mark", row["prop_0_disagrees"], "")
    check("still summarised", row["prop_0_max"], "2.5")


def test_a_label_gets_no_arithmetic():
    rows = [seq_clone("m0", "A1", "IGH", "H", "ACGTACGT"),
            seq_clone("m1", "B2", "IGH", "H", "ACGTACGT")]
    prop = {"name": "note", "type": "String",
            "values": {"Plate1\u0000A1": "hit", "Plate1\u0000B2": "weak"}}
    row = variants_of(rows, [prop])[0]
    check("values kept as they stand", row["prop_0_values"], "hit, weak")
    check("disagreement marked", row["prop_0_disagrees"], "yes")
    check("no summary invented", row["prop_0_max"], "")


def test_abundance_counts_wells_per_plate():
    import csv as _csv
    from annotate import pair_up, write_abundance
    work = tempfile.mkdtemp()
    # one variant in two wells of Plate1 and one of Plate2, and a second variant
    rows = [seq_clone("m0", "A1", "IGH", "H", "ACGTACGT"),
            seq_clone("m1", "B2", "IGH", "H", "ACGTACGT"),
            seq_clone("m2", "C3", "IGH", "H", "GGGGGGGG")]
    rows[1]["plate"] = "Plate2"
    pair_up(rows, True)
    out = os.path.join(work, "abundance.tsv")
    write_abundance(out, rows)
    table = list(_csv.DictReader(open(out), delimiter="\t"))
    by = {(r["sampleId"], r["variantKey"]): r["wellCount"] for r in table}
    shared = [k for k in by if by[k] == "1" and k[0] == "Plate2"]
    check("a plate per row, not one total", len(table), 3)
    check("the plate is the sample", sorted({k[0] for k in by}), ["Plate1", "Plate2"])
    check("the split variant appears on both", len({k[1] for k in by}), 2)
    check("Plate2 saw it once", len(shared), 1)


for name, fn in sorted(globals().items()):
    if name.startswith("test_"):
        fn()

if FAILURES:
    print("FAIL (%d)" % len(FAILURES))
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("ok")
