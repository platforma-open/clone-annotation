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
import pathlib
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


def test_the_numbered_frame_wins_and_a_dead_sequence_is_not_blamed():
    work = tempfile.mkdtemp()
    report = os.path.join(work, "report.json")
    json.dump({"sequences": [
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
    check("dead sequence still listed", by_id["m2"]["status"], "Failed")


def write_partial_anarci(path, rows):
    """Like write_anarci, but each row numbers only positions 1..last."""
    header = ["Id", "domain_no", "chain_type", "score", "seqstart_index"] + [
        str(n) for n in range(1, 131)
    ]
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for record, score, last in rows:
            writer.writerow([record, "0", "H", score, "0"]
                            + [residue(n) if n <= last else "-" for n in range(1, 131)])


def test_a_read_that_numbers_more_than_the_merge_replaces_it():
    work = tempfile.mkdtemp()
    report = os.path.join(work, "report.json")
    alt = {"reads": ["P1_IGH_F_A1.ab1"], "length": 380, "meanQuality": 41.0,
           "qualityScale": "read"}
    json.dump({"sequences": [
        # The merge broke the frame halfway; the forward read is whole.
        {"id": "m0", "plate": "Plate1", "well": "A1", "chain": "IGH", "source": "merged",
         "reads": ["P1_IGH_F_A1.ab1", "P1_IGH_R_A1.ab1"], "length": 450, "mismatches": 0,
         "qualityScale": "consensus",
         "alternatives": [dict(alt, id="m0.forward", source="forward"),
                          dict(alt, id="m0.reverse", source="reverse")]},
        # Both whole: the merge stays, since two reads vouch for it.
        {"id": "m1", "plate": "Plate1", "well": "A2", "chain": "IGH", "source": "merged",
         "reads": ["a", "b"], "length": 450, "qualityScale": "consensus",
         "alternatives": [dict(alt, id="m1.forward", source="forward")]},
    ]}, open(report, "w"))
    csv_h = os.path.join(work, "h.csv")
    write_partial_anarci(csv_h, [("m0|1", "150.0", 80), ("m0.forward|0", "120.0", 128),
                                 ("m0.reverse|2", "90.0", 60),
                                 ("m1|0", "150.0", 128), ("m1.forward|0", "160.0", 128)])
    sequences_tsv = os.path.join(work, "sequences.tsv")
    result = run_annotate(work, report, ["--csv_h", csv_h, "--out_sequences_tsv", sequences_tsv])
    by_id = {a["id"]: a for a in result["annotations"]}
    check("the whole read's frame", by_id["m0"]["frame"], 0)
    check("whole domain", by_id["m0"]["domainComplete"], True)
    rows = {r["well"]: r for r in csv.DictReader(open(sequences_tsv), delimiter="\t")}
    check("source follows the winner", (rows["A1"]["source"], rows["A1"]["qualityScale"],
                                        rows["A1"]["mismatches"]), ("forward", "read", ""))
    check("the reason says why", rows["A1"]["note"],
          "The merge numbered less of the domain than the forward read")
    check("a whole merge stays", (rows["A2"]["source"], by_id["m1"]["frame"]), ("merged", 0))


def test_germline_joins_positionally_and_its_absence_is_reported():
    work = tempfile.mkdtemp()
    report = os.path.join(work, "report.json")
    json.dump({"sequences": [
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
                     "\tbestVGene\tbestDGene\tbestJGene"
                     "\tbestVHit\tbestDHit\tbestJHit\tbestVHitScore\tbestVAlignment\n")
        handle.write("0\tACGT\tCARDY\tIGH\tm0\tIGHV3-23\t-\tIGHJ4"
                     "\tIGHV3-23*00\t-\tIGHJ4*00\t900\tSA63G\n")

    result = run_annotate(work, report, ["--csv_h", csv_h, "--mixcr", mixcr])
    by_id = {a["id"]: a for a in result["annotations"]}
    check("v gene", by_id["m0"]["vGene"], "IGHV3-23")
    check("j gene", by_id["m0"]["jGene"], "IGHJ4")
    check("v hit keeps the allele", by_id["m0"]["vHit"], "IGHV3-23*00")
    check("j hit keeps the allele", by_id["m0"]["jHit"], "IGHJ4*00")
    check("a dash is no gene", by_id["m0"].get("dGene"), None)
    check("a dash is no hit", by_id["m0"].get("dHit"), None)
    check("departures carried", by_id["m0"]["vAlignment"], "SA63G")
    check("no germline leaves no gene", by_id["m1"].get("vGene"), None)
    check("regions survive without germline", by_id["m1"]["status"], "Annotated")
    check("absence reported", result["notAligned"], ["Plate1 A2 IGH"])


def sequence(seq_id, plate, well, chain, pair_key, observed=None):
    e = {"id": seq_id, "plate": plate, "well": well, "declaredChain": chain,
         "pairKey": pair_key}
    if observed:
        e["observedChain"] = observed
    return e


def test_a_sequence_and_a_pair_carry_their_qc_reason():
    import csv as _csv
    from annotate import pair_up, sequence_reason, write_pairs
    heavy = dict(sequence("m0", "P1", "A1", "IGH", "k1", "H"), status="Annotated",
                 domainComplete=True)
    check("a clean chain", sequence_reason(heavy, {"source": "merged"}), "Passed")
    check("no read", sequence_reason(heavy, {"source": "none"}), "Low read quality")
    stopped = dict(heavy, stopRegion="CDR3")
    check("its own reason", sequence_reason(stopped, {"source": "merged"}), "Non productive")
    rows = [heavy]
    pair_up(rows, True)
    verdicts = [{"plate": "P1", "well": "A1", "verdict": "Failed", "reason": "Missing chain"}]
    out = os.path.join(tempfile.mkdtemp(), "pairs.tsv")
    write_pairs(out, rows, [{"id": "m0"}], verdicts)
    table = list(_csv.DictReader(open(out), delimiter="\t"))
    check("the pair takes the well's reason", table[0]["qcReason"], "Missing chain")


def test_the_plate_map_fills_every_well_and_splits_the_chains():
    import csv as _csv
    from annotate import write_wells
    rows = [sequence("m0", "P1", "A01", "IGH", "k1", "H"),
            sequence("m1", "P1", "A01", "IGK", "k1", "KL"),
            sequence("m2", "P1", "C5", "IGH", "k2", "H")]
    rows[1]["mixedPositions"] = 3
    seqs = [{"id": "m0", "meanQuality": 41.5, "length": 380},
            {"id": "m1", "meanQuality": 38.0, "length": 350},
            {"id": "m2", "meanQuality": 22.0, "length": 120}]
    verdicts = [{"plate": "P1", "well": "A01", "verdict": "Passed", "reason": ""},
                {"plate": "P1", "well": "C5", "verdict": "Failed", "reason": "Missing chain"},
                {"plate": "P1", "well": "odd", "verdict": "Failed", "reason": "Low read quality"}]
    prop = {"name": "Titer", "type": "Double", "values": {"P1\u0000A01": "120"}}
    out = os.path.join(tempfile.mkdtemp(), "wells.tsv")
    write_wells(out, verdicts, rows, seqs, [prop])
    table = list(_csv.DictReader(open(out), delimiter="\t"))
    check("a full 96-well plate", len(table), 96)
    by = {(r["row"], r["column"]): r for r in table}
    a1 = by[("A", "1")]
    check("the well's verdict", a1["verdict"], "Passed")
    check("heavy values", (a1["heavy_meanQuality"], a1["heavy_length"]), ("41.5", "380"))
    check("light values", (a1["light_meanQuality"], a1["light_mixedPositions"]), ("38.0", "3"))
    check("the property", a1["prop_0"], "120")
    check("one chain only", (by[("C", "5")]["heavy_length"], by[("C", "5")]["light_length"]), ("120", ""))
    check("an empty well", (by[("H", "12")]["verdict"], by[("H", "12")]["heavy_length"]), ("No file", ""))


def test_a_wrong_label_is_caught_on_a_heavy_only_plate():
    from annotate import pair_up
    rows = [sequence("m0", "P1", "A1", "IGH", "k1", "H"),
            sequence("m1", "P1", "B1", "IGH", "k2", "KL")]
    unpaired, mismatched = pair_up(rows, True)
    check("nothing to pair", rows[0]["pairStatus"], "Single domain")
    check("the light chain is flagged", rows[1].get("chainMismatch"), True)
    check("and listed", len(mismatched), 1)


def test_only_the_sides_the_sequences_show_are_kept():
    from annotate import sides_found
    heavy = sequence("m0", "P1", "A1", "IGH", "k1", "H")
    light = sequence("m1", "P1", "A1", "IGL", "k1", "KL")
    check("heavy only", sides_found([heavy]), ["heavy"])
    check("light only", sides_found([light]), ["light"])
    check("both, heavy first", sides_found([light, heavy]), ["heavy", "light"])
    # A label says nothing about what the sequence is.
    check("only what was numbered counts", sides_found([heavy, sequence("m2", "P1", "A2", "IGL", "k2", "")]),
          ["heavy"])
    check("nothing numbered keeps both", sides_found([]), ["heavy", "light"])


def test_two_chains_of_one_well_pair():
    from annotate import pair_up
    rows = [sequence("m0", "Plate1", "A1", "IGH", "k1", "H"),
            sequence("m1", "Plate1", "A1", "IGL", "k1", "KL")]
    unpaired, mismatched = pair_up(rows, True)
    check("heavy paired", rows[0]["pairStatus"], "Paired")
    check("points at the light", rows[0]["pairedWith"], "Plate1|A1|IGL")
    check("light points back", rows[1]["pairedWith"], "Plate1|A1|IGH")
    check("nothing unpaired", unpaired, [])
    check("no mismatch", mismatched, [])


def test_a_lone_chain_is_unpaired_not_dropped():
    """A2 has both chains, so the set pairs; A1's light chain never arrived."""
    from annotate import pair_up
    rows = [sequence("m0", "Plate1", "A1", "IGH", "k1", "H"),
            sequence("m1", "Plate1", "A2", "IGH", "k2", "H"),
            sequence("m2", "Plate1", "A2", "IGL", "k2", "KL")]
    unpaired, _ = pair_up(rows, True)
    check("status", rows[0]["pairStatus"], "Unpaired")
    check("the complete well pairs", rows[1]["pairStatus"], "Paired")
    check("listed", unpaired, ["Plate1 A1 IGH"])


def test_two_of_the_same_chain_are_ambiguous_not_guessed():
    from annotate import pair_up
    rows = [sequence("m0", "Plate1", "A1", "IGH", "k1", "H"),
            sequence("m1", "Plate1", "A1", "IGH", "k1", "H"),
            sequence("m2", "Plate1", "A2", "IGL", "k2", "KL")]
    unpaired, _ = pair_up(rows, True)
    check("first", rows[0]["pairStatus"], "Ambiguous")
    check("second", rows[1]["pairStatus"], "Ambiguous")
    check("two of them listed", len([u for u in unpaired if u.endswith("IGH")]), 2)


def test_a_set_that_names_no_chain_passes_through_whole():
    from annotate import pair_up
    rows = [sequence("m0", "Plate1", "A1", "", "k1", "H"),
            sequence("m1", "Plate1", "A2", "", "k2", "H")]
    unpaired, _ = pair_up(rows, False)
    check("single domain", [r["pairStatus"] for r in rows],
          ["Single domain", "Single domain"])
    check("nothing to report", unpaired, [])


def test_a_failed_primer_does_not_make_a_clean_well_ambiguous():
    """Every primer is fired at every well, so a file that yielded nothing is a
    failed attempt rather than a third chain."""
    from annotate import pair_up
    rows = [sequence("m0", "Plate1", "A1", "IgG", "k1", "H"),
            sequence("m1", "Plate1", "A1", "Kappa", "k1", "KL"),
            sequence("m2", "Plate1", "A1", "Lambda", "k1")]  # no sequence
    unpaired, _ = pair_up(rows, True)
    check("heavy paired", rows[0]["pairStatus"], "Paired")
    check("kappa paired", rows[1]["pairStatus"], "Paired")
    check("lambda is a failed read", rows[2]["pairStatus"], "No sequence")
    check("nothing reported", unpaired, [])


def test_two_light_chains_that_both_sequenced_stay_ambiguous():
    from annotate import pair_up
    rows = [sequence("m0", "Plate1", "A1", "IgG", "k1", "H"),
            sequence("m1", "Plate1", "A1", "Kappa", "k1", "KL"),
            sequence("m2", "Plate1", "A1", "Lambda", "k1", "KL")]
    unpaired, _ = pair_up(rows, True)
    check("all three ambiguous", [r["pairStatus"] for r in rows],
          ["Ambiguous"] * 3)
    check("all three listed", len(unpaired), 3)


def test_a_set_naming_one_chain_is_not_ninety_six_failures():
    """A heavy-only plate declares a chain but holds no pairs to make."""
    from annotate import pair_up
    rows = [sequence("m0", "Plate1", "A1", "IgG", "k1", "H"),
            sequence("m1", "Plate1", "A2", "IgG", "k2", "H")]
    unpaired, _ = pair_up(rows, True)
    check("single domain", [r["pairStatus"] for r in rows],
          ["Single domain", "Single domain"])
    check("nothing reported", unpaired, [])


def test_a_label_the_sequence_contradicts_is_flagged():
    from annotate import pair_up
    rows = [sequence("m0", "Plate1", "A1", "IGH", "k1", "KL"),
            sequence("m1", "Plate1", "A1", "IGL", "k1", "KL")]
    _, mismatched = pair_up(rows, True)
    check("one flagged", len(mismatched), 1)
    check("the heavy one", rows[0].get("chainMismatch"), True)
    check("the light one is fine", rows[1].get("chainMismatch"), None)


def test_a_label_nothing_can_read_is_not_a_contradiction():
    from annotate import pair_up
    rows = [sequence("m0", "Plate1", "A1", "IgG", "k1", "H")]
    _, mismatched = pair_up(rows, True)
    check("no mismatch from an unread label", mismatched, [])


def test_every_chain_word_the_pattern_reads_has_a_class():
    import re
    from annotate import DECLARED_CLASS
    source = (pathlib.Path(__file__).resolve().parent.parent / "model" / "src" /
              "path_pattern.ts").read_text()
    block = source.split("const CHAIN_WORDS = [", 1)[1].split("];", 1)[0]
    words = re.findall(r'"([^"]+)"', block)
    check("the list was found", len(words) > 10, True)
    check("words without a class", [w for w in words if w.lower() not in DECLARED_CLASS], [])


def test_the_detected_chain_prefers_mixcr_where_it_agrees():
    from annotate import detected_chain
    check("MiXCR names the locus", detected_chain({"observedChain": "KL", "mixcrChains": "IGL"}), "IGL")
    check("no MiXCR hit", detected_chain({"observedChain": "KL"}), "IGK/IGL")
    check("MiXCR disagrees with ANARCI", detected_chain({"observedChain": "H", "mixcrChains": "IGK"}), "IGH")
    check("nothing numbered", detected_chain({"mixcrChains": "IGH"}), "")


def test_a_clone_key_is_the_mixcr_hash_of_its_chains():
    import base64, hashlib, re
    from annotate import clone_key
    pairing = {"heavy": {"nt": {"VDJRegion": "CAGGTG"}}, "light": {"nt": {"VDJRegion": "GACATC"}}}
    digest = hashlib.sha256(b"CAGGTG#GACATC").digest()
    want = re.sub(r"[^a-zA-Z0-9]", "", base64.b64encode(digest).decode())[:21]
    check("sha256 of heavy#light, 120 bits", clone_key(pairing), want)
    check("21 letters and digits", bool(re.fullmatch(r"[A-Za-z0-9]{21}", want)), True)
    other_well = {"plate": "P2", "well": "H12", **pairing}
    check("the well does not change it", clone_key(other_well), want)
    heavy_only = {"heavy": {"nt": {"VDJRegion": "CAGGTG"}}, "light": None}
    check("a missing chain is empty", clone_key(heavy_only),
          re.sub(r"[^a-zA-Z0-9]", "", base64.b64encode(hashlib.sha256(b"CAGGTG#").digest()).decode())[:21])


def test_clone_labels_number_a_shared_prefix_in_key_order():
    from annotate import clone_labels
    labels = clone_labels(["ab1cdeZZ", "abcdeYY", "q9rstu"])
    check("digits dropped, five letters, uppercased", labels["q9rstu"], "C-QRSTU")
    check("first in key order", labels["ab1cdeZZ"], "C-ABCDE")
    check("second gets a rank", labels["abcdeYY"], "C-ABCDE-2")


def test_pairing_applies_only_to_a_set_with_two_chain_labels():
    from annotate import pairing_applies
    two = [{"declaredChain": "IGH"}, {"declaredChain": "IGK"}]
    one = [{"declaredChain": "IGH"}, {"declaredChain": "IGH"}]
    check("two labels", pairing_applies(two, True), True)
    check("one label, a heavy-only plate", pairing_applies(one, True), False)
    check("no chain in the pattern", pairing_applies(two, False), False)
    isotypes = [{"declaredChain": "IgG1"}, {"declaredChain": "IgG2"}]
    check("two isotypes are one heavy chain", pairing_applies(isotypes, True), False)


def test_the_pair_table_puts_the_two_chains_on_one_row():
    import csv as _csv
    from annotate import pair_up, write_pairs
    work = tempfile.mkdtemp()
    rows = [sequence("m0", "Plate1", "A1", "IGH", "k1", "H"),
            sequence("m1", "Plate1", "A1", "IGL", "k1", "KL"),
            sequence("m2", "Plate1", "A2", "IGH", "k2", "H")]
    for r in rows:
        r["aa"] = {"CDR3": "C" + r["declaredChain"]}
        r["vGene"] = r["declaredChain"] + "V1"
    pair_up(rows, True)
    out = os.path.join(work, "pairs.tsv")
    write_pairs(out, rows, [{"id": r["id"]} for r in rows])
    table = list(_csv.DictReader(open(out), delimiter="\t"))
    check("one row per clone", len(table), 2)
    first = table[0]
    check("paired", first["pairStatus"], "Paired")
    check("heavy side", first["heavy_aa_CDR3"], "CIGH")
    check("light side", first["light_aa_CDR3"], "CIGL")
    check("heavy germline", first["heavy_vGene"], "IGHV1")
    lone = table[1]
    check("a lone chain still gets a row", lone["heavy_aa_CDR3"], "CIGH")
    check("with the other side empty", lone["light_aa_CDR3"], "")


def test_an_ambiguous_well_writes_every_pairing_it_could_be():
    """Two light chains sequenced means two candidate clones, not one with
    the second quietly dropped."""
    import csv as _csv
    from annotate import pair_up, write_pairs
    work = tempfile.mkdtemp()
    rows = [sequence("m0", "Plate1", "A5", "IgG", "k1", "H"),
            sequence("m1", "Plate1", "A5", "Kappa", "k1", "KL"),
            sequence("m2", "Plate1", "A5", "Lambda", "k1", "KL")]
    for r in rows:
        r["aa"] = {"CDR3": "C" + r["declaredChain"]}
    pair_up(rows, True)
    out = os.path.join(work, "pairs.tsv")
    write_pairs(out, rows, [{"id": r["id"]} for r in rows])
    table = list(_csv.DictReader(open(out), delimiter="\t"))
    check("one row per candidate", len(table), 2)
    check("both ambiguous", {r["pairStatus"] for r in table}, {"Ambiguous"})
    check("detected, not taken from the name", {r["light_chain"] for r in table}, {"IGK/IGL"})
    check("both lights present", sorted(r["light_fileChain"] for r in table),
          ["Kappa", "Lambda"])
    check("the heavy is on both", {r["heavy_aa_CDR3"] for r in table}, {"CIgG"})
    check("keys are distinct", len({r["pairId"] for r in table}), 2)


def test_a_pair_with_no_sequence_at_all_is_left_out():
    from annotate import pair_up, write_pairs
    work = tempfile.mkdtemp()
    rows = [sequence("m0", "Plate1", "A1", "IGH", "k1"),
            sequence("m1", "Plate1", "A2", "IGH", "k2", "H"),
            sequence("m2", "Plate1", "A2", "IGL", "k2", "KL")]
    pair_up(rows, True)
    out = os.path.join(work, "pairs.tsv")
    write_pairs(out, rows, [{"id": r["id"]} for r in rows])
    table = open(out).read().splitlines()
    check("only the well that sequenced", len(table) - 1, 1)


def sequence_nt(seq_id, well, chain, observed, nt, aa=None):
    e = sequence(seq_id, "Plate1", well, chain, "k" + well, observed)
    e["nt"] = {"VDJRegion": nt}
    e["aa"] = {"CDR3": aa or nt[:6]}
    return e


def clones_of(rows, properties=()):
    import csv as _csv
    from annotate import pair_up, write_clones
    work = tempfile.mkdtemp()
    pair_up(rows, True)
    out = os.path.join(work, "clones.tsv")
    write_clones(out, rows, [{"id": r["id"]} for r in rows], list(properties))
    return list(_csv.DictReader(open(out), delimiter="\t"))


def test_identical_clones_collapse_and_keep_every_well():
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m1", "A1", "IGL", "KL", "TTTTTTTT"),
            sequence_nt("m2", "B2", "IGH", "H", "ACGTACGT"),
            sequence_nt("m3", "B2", "IGL", "KL", "TTTTTTTT"),
            sequence_nt("m4", "C3", "IGH", "H", "GGGGGGGG"),
            sequence_nt("m5", "C3", "IGL", "KL", "TTTTTTTT")]
    table = clones_of(rows)
    check("three clones, two distinct", len(table), 2)
    biggest = table[0]
    check("seen twice", biggest["wellCount"], "2")
    check("both wells listed", biggest["wells"], "Plate1 A1, Plate1 B2")


def test_one_chain_differing_makes_a_different_clone():
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m1", "A1", "IGL", "KL", "TTTTTTTT"),
            sequence_nt("m2", "B2", "IGH", "H", "ACGTACGT"),
            sequence_nt("m3", "B2", "IGL", "KL", "TTTTTTTA")]
    table = clones_of(rows)
    check("exact identity, nothing looser", len(table), 2)
    check("neither is collapsed", sorted(r["wellCount"] for r in table), ["1", "1"])


def test_wells_that_disagree_on_a_reading_are_marked():
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m1", "B2", "IGH", "H", "ACGTACGT")]
    prop = {"name": "elisa", "type": "Double",
            "values": {"Plate1\u0000A1": "2.5", "Plate1\u0000B2": "0.1"}}
    table = clones_of(rows, [prop])
    row = table[0]
    check("both values kept", row["prop_0_values"], "Plate1 A1: 2.5, Plate1 B2: 0.1")
    check("disagreement marked", row["prop_0_disagrees"], "yes")
    check("max", row["prop_0_max"], "2.5")
    check("min", row["prop_0_min"], "0.1")
    check("mean", row["prop_0_mean"], "1.3")


def test_wells_that_agree_carry_no_mark():
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m1", "B2", "IGH", "H", "ACGTACGT")]
    prop = {"name": "elisa", "type": "Double",
            "values": {"Plate1\u0000A1": "2.5", "Plate1\u0000B2": "2.5"}}
    row = clones_of(rows, [prop])[0]
    check("no mark", row["prop_0_disagrees"], "")
    check("still summarised", row["prop_0_max"], "2.5")


def test_a_label_gets_no_arithmetic():
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m1", "B2", "IGH", "H", "ACGTACGT")]
    prop = {"name": "note", "type": "String",
            "values": {"Plate1\u0000A1": "hit", "Plate1\u0000B2": "weak"}}
    row = clones_of(rows, [prop])[0]
    check("values kept as they stand", row["prop_0_values"], "Plate1 A1: hit, Plate1 B2: weak")
    check("disagreement marked", row["prop_0_disagrees"], "yes")
    check("no summary invented", row["prop_0_max"], "")


def test_abundance_counts_wells_per_plate():
    import csv as _csv
    from annotate import pair_up, write_abundance
    work = tempfile.mkdtemp()
    # one variant in two wells of Plate1 and one of Plate2, and a second variant
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m1", "B2", "IGH", "H", "ACGTACGT"),
            sequence_nt("m2", "C3", "IGH", "H", "GGGGGGGG")]
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


def test_a_stop_codon_is_found_in_its_region():
    from annotate import stop_region
    entry = {"nt": {"FR3": "GCTGCT", "CDR3": "GCTTAGGCT", "FR4": "TGGGGC"}}
    check("stop in CDR3", stop_region(entry), "CDR3")
    check("clean domain", stop_region({"nt": {"CDR3": "GCTGCT"}}), "")
    check("residues where no nucleotide", stop_region({"aa": {"FR2": "AW*G"}}), "FR2")


def test_a_domain_needs_cdr3_and_fr4():
    from annotate import domain_complete
    check("whole", domain_complete({"aa": {"CDR3": "CAR", "FR4": "WGQG"}}), True)
    check("stops before FR4", domain_complete({"aa": {"CDR3": "CAR", "FR4": ""}}), False)
    check("stops before CDR3", domain_complete({"aa": {"FR3": "YYC"}}), False)


def reverse(bases):
    return bases.translate(str.maketrans("ACGT", "TGCA"))[::-1]


def test_mixed_positions_count_only_where_every_read_agrees():
    from annotate import mixed_in_cdr3
    cdr3 = "TGTGCGAGAGATTAC"
    forward = {"bases": "AAAA" + cdr3 + "CCCC", "mixed": [0, 4, 6, 10]}
    check("one read, CDR3 positions only", mixed_in_cdr3(cdr3, [forward]), 3)

    # The reverse read holds CDR3 reverse-complemented, so its index
    # last - (at + i) is CDR3 position i. Mixed at CDR3 positions 0 and 6.
    bases = "GG" + reverse(cdr3) + "TTTTT"
    last = len(bases) - 1
    at = reverse(bases).find(cdr3)
    back = {"bases": bases, "mixed": [last - (at + 0), last - (at + 6)]}
    check("reverse read alone", mixed_in_cdr3(cdr3, [back]), 2)
    check("both reads: the intersection", mixed_in_cdr3(cdr3, [forward, back]), 2)


def test_mixed_is_not_assessed_without_a_read_showing_cdr3():
    from annotate import mixed_in_cdr3
    check("no reads", mixed_in_cdr3("TGTGCG", []), None)
    check("CDR3 not in the read", mixed_in_cdr3("TGTGCG", [{"bases": "AAAAAA", "mixed": [1]}]),
          None)
    check("no CDR3", mixed_in_cdr3("", [{"bases": "AAAAAA", "mixed": [1]}]), None)


def described(seq_id, plate, well, chain, observed, **extra):
    e = sequence(seq_id, plate, well, chain, plate + well, observed)
    e.update({"status": "Annotated", "domainComplete": True, "stopRegion": ""})
    e.update(extra)
    return e


def verdicts_of(rows, sources=None):
    from annotate import well_verdicts
    sequences = [{"id": r["id"], "source": (sources or {}).get(r["id"], "merged")} for r in rows]
    return {(v["plate"], v["well"]): v for v in well_verdicts(rows, sequences)}


def test_a_well_without_germline_is_good():
    rows = [described("m0", "P1", "A1", "IGH", "H", pairStatus="Single domain")]
    v = verdicts_of(rows)[("P1", "A1")]
    check("no vGene, still good", (v["verdict"], v["reason"]), ("Passed", "Passed"))


def test_a_well_whose_reads_all_died_failed_for_that_reason():
    rows = [sequence("m0", "P1", "A1", "IGH", "k"), sequence("m1", "P1", "A1", "IGL", "k")]
    for r in rows:
        r["status"] = "Failed"
    v = verdicts_of(rows, {"m0": "none", "m1": "none"})[("P1", "A1")]
    check("no usable read", (v["verdict"], v["reason"]), ("Failed", "Low read quality"))

    v = verdicts_of(rows, {"m0": "none", "m1": "merged"})[("P1", "A1")]
    check("a read nobody could number", v["reason"], "Annotation failed")


def test_the_worst_chain_decides_and_failure_outranks_a_look():
    rows = [described("m0", "P1", "A1", "IGH", "H", pairStatus="Paired", mixedPositions=9),
            described("m1", "P1", "A1", "IGK", "KL", pairStatus="Paired", stopRegion="CDR3")]
    v = verdicts_of(rows)[("P1", "A1")]
    check("failed", v["verdict"], "Failed")
    check("not productive first", v["reasons"], ["Non productive", "Mixed sequence"])
    check("split by kind", (v["failedReasons"], v["warningReasons"]),
          (["Non productive"], ["Mixed sequence"]))


def test_reasons_that_need_a_look():
    rows = [described("m0", "P1", "A1", "IGH", "H", pairStatus="Ambiguous"),
            described("m1", "P1", "B1", "IGH", "H", pairStatus="Paired", mixedPositions=6),
            described("m2", "P1", "C1", "IGH", "H", pairStatus="Paired", mixedPositions=5),
            described("m3", "P1", "D1", "IGH", "KL", pairStatus="Paired", chainMismatch=True)]
    v = verdicts_of(rows)
    check("ambiguous", v[("P1", "A1")]["reason"], "Ambiguous pairing")
    check("over the limit", v[("P1", "B1")]["reason"], "Mixed sequence")
    check("at the limit is fine", v[("P1", "C1")]["verdict"], "Passed")
    check("label disagrees", v[("P1", "D1")]["reason"], "Chain label disagrees")
    check("all need a look", sorted(x["verdict"] for x in v.values()),
          ["Passed", "Warning", "Warning", "Warning"])


def test_a_missing_chain_fails_and_a_failed_primer_does_not():
    rows = [described("m0", "P1", "A1", "IGH", "H", pairStatus="Unpaired"),
            described("m1", "P1", "B1", "IGH", "H", pairStatus="Paired"),
            described("m2", "P1", "B1", "IGK", "KL", pairStatus="Paired"),
            sequence("m3", "P1", "B1", "IGL", "P1B1")]
    rows[3].update({"status": "Failed", "pairStatus": "No sequence"})
    v = verdicts_of(rows, {"m3": "none"})
    check("missing chain", v[("P1", "A1")]["reason"], "Missing chain")
    check("lambda never came, kappa did", v[("P1", "B1")]["verdict"], "Passed")


def test_a_chain_that_read_but_was_not_numbered_is_not_described():
    rows = [described("m0", "P1", "A1", "IGH", "H", pairStatus="Unpaired"),
            sequence("m1", "P1", "A1", "IGL", "P1A1")]
    rows[1].update({"status": "Failed", "pairStatus": "No sequence"})
    v = verdicts_of(rows, {"m1": "forward"})[("P1", "A1")]
    check("the sequenced chain is named first", v["reasons"], ["Annotation failed", "Missing chain"])


def test_an_unnumbered_read_on_a_covered_side_does_not_fail_the_well():
    # Three files per well (heavy, kappa, lambda): the empty light that read but
    # numbered nothing, beside a clean heavy+light pair, must not fail the well.
    rows = [described("m0", "P1", "A1", "IGH", "H", pairStatus="Paired"),
            described("m1", "P1", "A1", "IGL", "KL", pairStatus="Paired"),
            sequence("m2", "P1", "A1", "IGK", "P1A1")]
    rows[2].update({"status": "Failed", "pairStatus": "No sequence"})
    v = verdicts_of(rows, {"m2": "forward"})[("P1", "A1")]
    check("the redundant light does not fail a paired well", v["verdict"], "Passed")

    # But an unnumbered read on a side nothing else covers still fails the well.
    rows[0]["pairStatus"] = "Unpaired"
    rows[1] = sequence("m1", "P1", "A1", "IGL", "P1A1")
    rows[1].update({"status": "Failed", "pairStatus": "No sequence"})
    v = verdicts_of(rows, {"m1": "forward", "m2": "forward"})[("P1", "A1")]
    check("no light numbered, the well still fails", v["reason"], "Annotation failed")


def test_incomplete_comes_before_a_stop_it_also_has():
    from annotate import chain_reasons
    entry = described("m0", "P1", "A1", "IGH", "H", domainComplete=False, stopRegion="FR3")
    check("incomplete", chain_reasons(entry)[0], {"Incomplete domain"})


def test_plate_rows_add_up_and_name_their_main_problem():
    from annotate import plate_summary
    verdicts = [
        {"plate": "P1", "well": "A1", "verdict": "Passed", "reason": ""},
        {"plate": "P1", "well": "B1", "verdict": "Failed", "reason": "Low read quality"},
        {"plate": "P1", "well": "C1", "verdict": "Failed", "reason": "Low read quality"},
        {"plate": "P1", "well": "D1", "verdict": "Failed", "reason": "Non productive"},
        {"plate": "P1", "well": "E1", "verdict": "Warning", "reason": "Mixed sequence"},
        {"plate": "", "well": "x", "verdict": "Warning", "reason": "Mixed sequence"},
    ]
    plates, total = plate_summary(verdicts, [])
    p1 = plates[1]
    check("plates sorted, the unnamed one labelled", [p["plate"] for p in plates],
          ["No plate", "P1"])
    check("counts", (p1["wells"], p1["passed"], p1["warning"], p1["failed"]), (5, 1, 1, 3))
    check("share", p1["passedShare"], 0.2)
    check("most common failure", p1["mainProblem"], "Low read quality (2)")
    check("only looks: the commonest look", plates[0]["mainProblem"], "Mixed sequence (1)")
    check("total", (total["plates"], total["wells"], total["passed"]), (2, 6, 1))


def test_unique_antibodies_skip_failed_wells_and_dedupe_across_plates():
    from annotate import plate_summary
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m1", "B1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m2", "C1", "IGH", "H", "GGGGGGGG"),
            sequence_nt("m3", "D1", "IGH", "H", "TTTTTTTT")]
    rows[1]["plate"] = "Plate2"
    verdicts = [
        {"plate": "Plate1", "well": "A1", "verdict": "Passed", "reason": ""},
        {"plate": "Plate2", "well": "B1", "verdict": "Passed", "reason": ""},
        {"plate": "Plate1", "well": "C1", "verdict": "Warning", "reason": "Mixed sequence"},
        {"plate": "Plate1", "well": "D1", "verdict": "Failed", "reason": "Non productive"},
    ]
    plates, total = plate_summary(verdicts, rows)
    by = {p["plate"]: p["uniqueAntibodies"] for p in plates}
    check("per plate, failed left out", by, {"Plate1": 2, "Plate2": 1})
    check("shared variant counted once in total", total["uniqueAntibodies"], 2)


def test_the_plate_row_counts_chains_reads_merges_and_repeats():
    from annotate import plate_summary
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGT"),
            sequence_nt("m1", "A1", "IGK", "KL", "GGGG"),
            sequence_nt("m2", "B1", "IGH", "H", "ACGT"),
            sequence_nt("m3", "B1", "IGK", "KL", "GGGG"),
            sequence_nt("m4", "C1", "IGH", "H", "TTTT")]
    for r in rows:
        r.update(status="Annotated", domainComplete=True)
    rows[3]["mixedPositions"] = 9
    verdicts = [{"plate": "Plate1", "well": w, "verdict": v, "reason": r}
                for w, v, r in (("A1", "Passed", ""), ("B1", "Warning", "Mixed sequence"),
                                ("C1", "Failed", "Missing chain"))]
    seqs = [{"id": "m%d" % i, "plate": "Plate1", "source": src}
            for i, src in enumerate(["merged", "merged", "forward", "merged", "none"])]
    files = [{"path": "f%d" % i, "plate": "Plate1", "kept": i < 3} for i in range(4)]
    plates, total = plate_summary(verdicts, rows, seqs, files)
    row = plates[0]
    check("heavy clean in all three", row["heavyPassed"], 3)
    check("light clean in A1 only", row["lightPassed"], 1)
    check("3 of 4 files kept", row["usableReadsShare"], 0.75)
    check("3 of 4 sequences merged", row["mergedShare"], 0.75)
    check("A1 and B1 hold the same antibody", row["redundantShare"], 1.0)
    check("the total has them too", total["redundantShare"], 1.0)


def test_a_well_with_two_identical_candidates_counts_once():
    import csv as _csv
    from annotate import write_abundance, write_clones
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGT"),
            sequence_nt("m1", "A1", "IGK", "KL", "GGGG"),
            sequence_nt("m2", "A1", "IGK", "KL", "GGGG"),
            sequence_nt("m3", "B1", "IGH", "H", "ACGT"),
            sequence_nt("m4", "B1", "IGK", "KL", "GGGG")]
    prop = {"name": "Titer", "type": "Double",
            "values": {"Plate1\u0000A1": "120", "Plate1\u0000C1": "7"}}
    work = tempfile.mkdtemp()
    write_clones(os.path.join(work, "clones.tsv"), rows, [{"id": r["id"]} for r in rows], [prop])
    clone = list(_csv.DictReader(open(os.path.join(work, "clones.tsv")), delimiter="\t"))[0]
    check("each well once", (clone["wells"], clone["wellCount"]), ("Plate1 A1, Plate1 B1", "2"))
    check("B1 was not measured and shows so", clone["prop_0_values"], "Plate1 A1: 120")
    write_abundance(os.path.join(work, "abundance.tsv"), rows)
    ab = list(_csv.DictReader(open(os.path.join(work, "abundance.tsv")), delimiter="\t"))
    check("abundance counts wells", ab[0]["wellCount"], "2")


def test_trace_reads_name_one_read_per_variant_and_chain():
    import csv as _csv
    from annotate import write_clones, write_trace_reads
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGT"),
            sequence_nt("m1", "A1", "IGK", "KL", "GGGG"),
            sequence_nt("m3", "B1", "IGH", "H", "ACGT"),
            sequence_nt("m4", "B1", "IGK", "KL", "GGGG")]
    sequences = [{"id": "m0", "reads": ["A1_H_F.ab1", "A1_H_R.ab1"]},
                 {"id": "m1", "reads": ["A1_K_F.ab1"]},
                 {"id": "m3", "reads": ["B1_H_F.ab1"]},
                 {"id": "m4", "reads": ["B1_K_F.ab1"]}]
    reads = [{"path": "A1_H_F.ab1", "usableLength": 300},
             {"path": "A1_H_R.ab1", "usableLength": 420}]
    work = tempfile.mkdtemp()
    write_clones(os.path.join(work, "clones.tsv"), rows, sequences, [])
    write_trace_reads(os.path.join(work, "trace_reads.tsv"), rows, sequences, reads)
    clone = list(_csv.DictReader(open(os.path.join(work, "clones.tsv")), delimiter="\t"))[0]
    got = list(_csv.DictReader(open(os.path.join(work, "trace_reads.tsv")), delimiter="\t"))
    check("one row per chain of the one clone", [(r["variantKey"], r["chain"]) for r in got],
          [(clone["variantKey"], "A"), (clone["variantKey"], "B")])
    check("the first well, its longer read", [r["path"] for r in got],
          ["A1_H_R.ab1", "A1_K_F.ab1"])


def test_the_export_keeps_only_the_accepted_wells():
    import csv as _csv
    from annotate import accepted_wells, pair_up, write_abundance, write_clones
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m1", "B1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m2", "C1", "IGH", "H", "GGGGGGGG"),
            sequence_nt("m3", "D1", "IGH", "H", "TTTTTTTT")]
    pair_up(rows, True)
    verdicts = [
        {"plate": "Plate1", "well": "A1", "verdict": "Passed"},
        {"plate": "Plate1", "well": "B1", "verdict": "Failed"},
        {"plate": "Plate1", "well": "C1", "verdict": "Warning"},
        {"plate": "Plate1", "well": "D1", "verdict": "Failed"},
    ]

    def exported(export):
        work = tempfile.mkdtemp()
        accepted = accepted_wells(verdicts, export)
        variants = os.path.join(work, "clones.tsv")
        abundance = os.path.join(work, "abundance.tsv")
        write_clones(variants, rows, [{"id": r["id"]} for r in rows], [], None, accepted)
        write_abundance(abundance, rows, accepted)
        table = list(_csv.DictReader(open(variants), delimiter="\t"))
        counts = [r["wellCount"] for r in _csv.DictReader(open(abundance), delimiter="\t")]
        return sorted((r["wells"], r["wellCount"]) for r in table), sorted(counts)

    check("good only, the failed twin not counted", exported("passed"),
          ([("Plate1 A1", "1")], ["1"]))
    check("good and a look", exported("passedAndWarning"),
          ([("Plate1 A1", "1"), ("Plate1 C1", "1")], ["1", "1"]))
    check("everything", exported("all"),
          ([("Plate1 A1, Plate1 B1", "2"), ("Plate1 C1", "1"), ("Plate1 D1", "1")],
           ["1", "1", "2"]))


def test_a_clone_carries_the_verdict_of_its_best_well():
    import csv as _csv
    from annotate import pair_up, write_clones
    rows = [sequence_nt("m0", "A1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m1", "B1", "IGH", "H", "ACGTACGT"),
            sequence_nt("m2", "C1", "IGH", "H", "GGGGGGGG")]
    pair_up(rows, True)
    verdicts = [
        {"plate": "Plate1", "well": "A1", "verdict": "Failed", "reason": "Non productive"},
        {"plate": "Plate1", "well": "B1", "verdict": "Warning", "reason": "Mixed sequence"},
        {"plate": "Plate1", "well": "C1", "verdict": "Failed", "reason": "Incomplete domain"},
    ]
    out = os.path.join(tempfile.mkdtemp(), "clones.tsv")
    write_clones(out, rows, [{"id": r["id"]} for r in rows], [], None, None, verdicts)
    table = {r["wells"]: (r["qcVerdict"], r["qcReason"])
             for r in _csv.DictReader(open(out), delimiter="\t")}
    check("the better well vouches", table["Plate1 A1, Plate1 B1"],
          ("Warning", "Mixed sequence"))
    check("a lone failed well", table["Plate1 C1"], ("Failed", "Incomplete domain"))


def test_every_reason_is_explained_in_priority_order():
    from annotate import WARNING_REASONS, FAILED_REASONS, MIXED_LIMIT, reason_help
    help_ = reason_help()
    check("one entry per reason", [h["label"] for h in help_], FAILED_REASONS + WARNING_REASONS)
    check("none left empty", all(h["help"] for h in help_), True)
    mixed = [h for h in help_ if h["label"] == "Mixed sequence"][0]
    check("the limit in the text is the one in force", str(MIXED_LIMIT) in mixed["help"], True)
    check("kind travels with it", mixed["verdict"], "Warning")


def test_the_cli_writes_the_plate_table_and_the_verdicts():
    work = tempfile.mkdtemp()
    report = os.path.join(work, "report.json")
    json.dump({"sequences": [
        {"id": "m0", "plate": "Plate1", "well": "A1", "chain": "IGH", "source": "merged"},
        {"id": "m1", "plate": "Plate1", "well": "A2", "chain": "IGH", "source": "none"},
    ]}, open(report, "w"))
    csv_h = os.path.join(work, "h.csv")
    write_anarci(csv_h, [("m0|0", "120.0")])
    plates_tsv = os.path.join(work, "plates.tsv")
    result = run_annotate(work, report, ["--csv_h", csv_h, "--out_plates_tsv", plates_tsv])

    check("one verdict per well", [(w["well"], w["verdict"]) for w in result["wells"]],
          [("A1", "Passed"), ("A2", "Failed")])
    check("total in the report", (result["total"]["wells"], result["total"]["passed"]), (2, 1))
    check("reasons explained in the report", len(result["reasonHelp"]), 8)
    check("a heavy-only set reports one side", result["sides"], ["heavy"])
    table = list(csv.DictReader(open(plates_tsv), delimiter="\t"))
    check("one plate row", [(r["plate"], r["wells"], r["failed"]) for r in table],
          [("Plate1", "2", "1")])
    check("the dead well is the problem", table[0]["mainProblem"], "Low read quality (1)")


for name, fn in sorted(globals().items()):
    if name.startswith("test_"):
        fn()

if FAILURES:
    print("FAIL (%d)" % len(FAILURES))
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("ok")
