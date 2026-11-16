"""Checks for the FASTA reader in src/read_fasta.py.

Standard library only. Run it by hand from this directory:

    python3 test_read_fasta.py

Every input is invented: a tiny plan, a manifest, a couple of FASTA files.
"""

import importlib.util
import pathlib
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("read_fasta", HERE / "src" / "read_fasta.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

FAILURES = []


def check(name, got, want):
    if got != want:
        FAILURES.append("%s\n     got  %r\n     want %r" % (name, got, want))


# A nucleotide domain long enough that at least one frame clears MIN_PROTEIN
# (50 amino acids, so 150+ bases).
HEAVY = ("GCATACGGATGTCCTCGCCCGTATGAGCTTGGGAGAGGACGGTCTGGGCACTTGAATACCTCA"
         "TAACAGTCAGTAGAGACGGGGGCTCCGCTTTGCATCTGAAGTTACGTAGCCAGCCGTTACGAG"
         "CCTCGTAAAAGCGTCGGTTCTCTTATAGTCCTATCAGGCCATCAGGGACTAGGGAGAAAAATG"
         "AGCTGTGAGGCTGATCGTTCAGCGGCAGTGGCTGAATTATATTACTCACACGAATGAGCGTAG")


def write_set():
    tmp = pathlib.Path(tempfile.mkdtemp())
    files = tmp / "fasta"
    files.mkdir()
    (files / "t00000").write_text(">VH1 heavy\n%s\n" % HEAVY)
    (files / "t00001").write_text(">VH2\n%s\n" % HEAVY)
    (files / "t00002").write_text(">empty\n")
    manifest = {
        "t00000": {"path": "VH1_H.fasta", "plate": "P1"},
        "t00001": {"path": "VH2_H.fasta", "plate": "P1"},
        "t00002": {"path": "empty_H.fasta", "plate": "P1"},
    }
    return files, manifest


def test_one_record_per_molecule_becomes_one_sequence():
    files, manifest = write_set()
    plan = [{"plate": "P1", "well": "A1", "chain": "H", "pairKey": "P1\x00A1",
             "forward": "t00000", "extra": 0}]
    sequences, set_aside, reads, nt, frames = reader.build(plan, manifest, files)
    check("one sequence", len(sequences), 1)
    check("keyed by seq id", sequences[0]["id"], "s00000")
    check("carries the chain", sequences[0]["chain"], "H")
    check("quality is inert", sequences[0]["qualityScale"], "none")
    check("nucleotide record written", nt[0].startswith(">s00000\n"), True)
    check("at least one frame", len(frames) >= 1, True)
    check("frame header is seq|frame", frames[0].split("\n")[0].startswith(">s00000|"), True)
    check("one read row for the file", len(reads), 1)
    check("read quality is inert", reads[0]["qualitySource"], "none")
    check("nothing set aside", set_aside, [])


def test_a_file_with_no_sequence_is_set_aside():
    files, manifest = write_set()
    plan = [{"plate": "P1", "well": "B2", "chain": "H", "pairKey": "P1\x00B2",
             "forward": "t00002", "extra": 0}]
    sequences, set_aside, reads, nt, frames = reader.build(plan, manifest, files)
    check("set aside with a reason", len(set_aside), 1)
    check("the sequence is kept as a result", sequences[0]["source"], "none")
    check("no nucleotide for it", nt, [])


def test_a_plan_entry_with_no_file_is_a_result():
    files, manifest = write_set()
    plan = [{"plate": "P1", "well": "C3", "chain": "H", "pairKey": "P1\x00C3", "extra": 0}]
    sequences, set_aside, reads, nt, frames = reader.build(plan, manifest, files)
    check("kept as a no-sequence result", sequences[0]["source"], "none")
    check("nothing to set aside without a file", set_aside, [])


def test_main_writes_the_whole_contract():
    import json
    files, manifest = write_set()
    tmp = files.parent
    (tmp / "traces.json").write_text(json.dumps(manifest))
    (tmp / "sequences.json").write_text(json.dumps([
        {"plate": "P1", "well": "A1", "chain": "H", "pairKey": "P1\x00A1",
         "forward": "t00000", "extra": 0}]))
    cwd = pathlib.Path.cwd()
    import os
    os.chdir(tmp)
    try:
        reader.main(["read_fasta.py", str(files), "traces.json", "sequences.json"])
        check("nucleotide fasta exists", (tmp / "sequences.fasta").exists(), True)
        check("frames fasta exists", (tmp / "frames.fasta").exists(), True)
        check("peaks is empty", (tmp / "peaks.json").read_text(), "{}")
        check("reads tsv is header only",
              (tmp / "reads.tsv").read_text(), "readKey\tplate\tmeanQuality\tusableLength\n")
        report = json.loads((tmp / "report.json").read_text())
        check("report has one sequence", len(report["sequences"]), 1)
        check("report has one read row", len(report["reads"]), 1)
    finally:
        os.chdir(cwd)


def test_a_combined_file_yields_one_sequence_per_record_by_index():
    tmp = pathlib.Path(tempfile.mkdtemp())
    files = tmp / "fasta"; files.mkdir()
    (files / "f0").write_text(">rec0 name=A\n%s\n>rec1 name=B\n%s\n" % (HEAVY, HEAVY))
    manifest = {"f0": {"path": "combined.fasta", "plate": ""}}
    plan = [
        {"name": "A", "chain": "", "pairKey": "A", "forward": "f0", "recordIndex": 0, "extra": 0},
        {"name": "B", "chain": "", "pairKey": "B", "forward": "f0", "recordIndex": 1, "extra": 0},
    ]
    sequences, set_aside, reads, nt, frames = reader.build(plan, manifest, files, True)
    check("two records -> two sequences", len(sequences), 2)
    check("reads keyed by file#index", [r["path"] for r in reads], ["combined.fasta#0", "combined.fasta#1"])
    check("first record read", sequences[0]["id"], "s00000")
    check("second record read", sequences[1]["id"], "s00001")
    check("two nucleotide records", len(nt), 2)
    check("nothing set aside", set_aside, [])


def write_fastq_set():
    tmp = pathlib.Path(tempfile.mkdtemp())
    files = tmp / "fasta"
    files.mkdir()
    # Q40 everywhere: the whole read clears the floor.
    (files / "t00000").write_text("@VH1 heavy\n%s\n+\n%s\n" % (HEAVY, "I" * len(HEAVY)))
    # Q0 everywhere: noise end to end, nothing survives trimming.
    (files / "t00001").write_text("@VH2\n%s\n+\n%s\n" % (HEAVY, "!" * len(HEAVY)))
    manifest = {
        "t00000": {"path": "VH1_H.fastq", "plate": "P1"},
        "t00001": {"path": "VH2_H.fastq", "plate": "P1"},
    }
    return files, manifest


def test_a_fastq_read_carries_real_quality_and_a_nucleotide():
    files, manifest = write_fastq_set()
    plan = [{"plate": "P1", "well": "A1", "chain": "H", "pairKey": "P1\x00A1",
             "forward": "t00000", "extra": 0}]
    sequences, set_aside, reads, nt, frames = reader.build(
        plan, manifest, files, fastq=True, floor=20)
    check("one sequence", len(sequences), 1)
    check("high quality read kept whole", reads[0]["usableLength"], len(HEAVY))
    check("mean quality reported", reads[0]["meanQuality"], 40.0)
    check("quality source is the read", reads[0]["qualitySource"], "read")
    check("sequence carries the mean quality", sequences[0]["meanQuality"], 40.0)
    check("nucleotide written for MiXCR", nt[0].startswith(">s00000\n"), True)
    check("at least one frame", len(frames) >= 1, True)
    check("nothing set aside", set_aside, [])


def test_a_fastq_read_below_the_floor_is_set_aside():
    files, manifest = write_fastq_set()
    plan = [{"plate": "P1", "well": "B2", "chain": "H", "pairKey": "P1\x00B2",
             "forward": "t00001", "extra": 0}]
    sequences, set_aside, reads, nt, frames = reader.build(
        plan, manifest, files, fastq=True, floor=20)
    check("set aside with a reason", len(set_aside), 1)
    check("the sequence is kept as a result", sequences[0]["source"], "none")
    check("no nucleotide for it", nt, [])


def test_a_combined_fastq_writes_distinct_read_keys():
    # A combined file stages once under one id, so the read-quality table must key
    # each record by its path (file#index), not the shared file id.
    import json
    import os
    tmp = pathlib.Path(tempfile.mkdtemp())
    files = tmp / "fasta"
    files.mkdir()
    hi = "I" * len(HEAVY)
    (files / "f0").write_text("@recA\n%s\n+\n%s\n@recB\n%s\n+\n%s\n" % (HEAVY, hi, HEAVY, hi))
    (tmp / "traces.json").write_text(json.dumps({"f0": {"path": "combined.fastq", "plate": ""}}))
    (tmp / "sequences.json").write_text(json.dumps([
        {"well": "A1", "chain": "", "pairKey": "A1", "forward": "f0", "recordIndex": 0, "extra": 0},
        {"well": "A2", "chain": "", "pairKey": "A2", "forward": "f0", "recordIndex": 1, "extra": 0}]))
    cwd = pathlib.Path.cwd()
    os.chdir(tmp)
    try:
        reader.main(["read_fasta.py", str(files), "traces.json", "sequences.json",
                     "--fastq", "--combined", "--floor", "20"])
        keys = [r.split("\t")[0] for r in (tmp / "reads.tsv").read_text().splitlines()[1:]]
        check("two read rows", len(keys), 2)
        check("keys are distinct", len(set(keys)), 2)
        check("keyed by file#index", sorted(keys), ["combined.fastq#0", "combined.fastq#1"])
    finally:
        os.chdir(cwd)


def test_a_rejected_combined_record_keeps_its_record_path():
    # A low-quality record in a combined file must be set aside under its own
    # file#index key, the one its Files-table row looks up, not the bare file path.
    tmp = pathlib.Path(tempfile.mkdtemp())
    files = tmp / "fasta"
    files.mkdir()
    hi, lo = "I" * len(HEAVY), "!" * len(HEAVY)
    (files / "f0").write_text("@recA\n%s\n+\n%s\n@recB\n%s\n+\n%s\n" % (HEAVY, hi, HEAVY, lo))
    manifest = {"f0": {"path": "combined.fastq", "plate": ""}}
    plan = [
        {"well": "A1", "chain": "", "pairKey": "A1", "forward": "f0", "recordIndex": 0, "extra": 0},
        {"well": "A2", "chain": "", "pairKey": "A2", "forward": "f0", "recordIndex": 1, "extra": 0}]
    sequences, set_aside, reads, nt, frames = reader.build(
        plan, manifest, files, combined=True, fastq=True, floor=20)
    check("the good record is kept", len(reads), 1)
    check("the bad record is set aside", len(set_aside), 1)
    check("set aside keyed by file#index", set_aside[0]["path"], "combined.fastq#1")


def test_a_gzipped_fastq_is_read_transparently():
    import gzip
    tmp = pathlib.Path(tempfile.mkdtemp())
    files = tmp / "fasta"
    files.mkdir()
    (files / "t00000").write_bytes(gzip.compress(
        ("@VH1 heavy\n%s\n+\n%s\n" % (HEAVY, "I" * len(HEAVY))).encode()))
    manifest = {"t00000": {"path": "VH1_H.fastq.gz", "plate": "P1"}}
    plan = [{"plate": "P1", "well": "A1", "chain": "H", "pairKey": "P1\x00A1",
             "forward": "t00000", "extra": 0}]
    sequences, set_aside, reads, nt, frames = reader.build(
        plan, manifest, files, fastq=True, floor=20)
    check("the gzipped read is parsed", len(sequences), 1)
    check("decompressed and kept whole", reads[0]["usableLength"], len(HEAVY))
    check("nucleotide written for MiXCR", nt[0].startswith(">s00000\n"), True)


# A variable domain as protein, which is what an amino-acid FASTA carries.
PROTEIN = ("QVQLVESGGGLVQPGGSLRLSCAASGFTFSSYAMSWVRQAPGKGLEWVSAISGSGGSTYYADSVKG"
           "RFTISRDNSKNTLYLQMNSLRAEDTAVYYCAKDIGGFDYWGQGTLVTVSS")


def test_amino_acid_record_is_one_frame_and_no_nucleotide():
    tmp = pathlib.Path(tempfile.mkdtemp())
    files = tmp / "fasta"
    files.mkdir()
    (files / "t00000").write_text(">VH1 heavy\n%s\n" % PROTEIN)
    manifest = {"t00000": {"path": "VH1_H.fasta", "plate": "P1"}}
    plan = [{"plate": "P1", "well": "A1", "chain": "H", "pairKey": "P1\x00A1",
             "forward": "t00000", "extra": 0}]
    sequences, set_aside, reads, nt, frames = reader.build(
        plan, manifest, files, amino_acid=True)
    check("one sequence", len(sequences), 1)
    check("no nucleotide written", nt, [])
    check("one frame for the protein", len(frames), 1)
    check("the protein is frame 0", frames[0].split("\n")[0], ">s00000|0")
    check("the frame carries the protein", frames[0].split("\n")[1], PROTEIN)
    check("length is the protein length", sequences[0]["length"], len(PROTEIN))
    check("one read row", len(reads), 1)
    check("quality is inert", reads[0]["qualitySource"], "none")


for name, fn in sorted(globals().items()):
    if name.startswith("test_"):
        fn()

if FAILURES:
    print("FAILED:\n  " + "\n  ".join(FAILURES))
    raise SystemExit(1)
print("ok")
