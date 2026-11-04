"""Checks for the Tracy driver that lives inside workflow/src/tracy.lib.tengo.

The driver is Python inside a Tengo string, so it is cut out of that file and
loaded as a module. Standard library only. Run it by hand from this directory:

    python3 test_driver.py

Every input is invented: a quality list, a Tracy table, a minimal ABIF file.
"""

import importlib.util
import os
import pathlib
import struct
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
TENGO = HERE.parent / "workflow" / "src" / "tracy.lib.tengo"

source = TENGO.read_text().split("driverScript := `", 1)[1].split("`\n\nexport", 1)[0]
module_path = pathlib.Path(tempfile.mkdtemp()) / "driver.py"
module_path.write_text(source)
spec = importlib.util.spec_from_file_location("driver", module_path)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

FAILURES = []


def check(name, got, want):
    if got != want:
        FAILURES.append("%s\n     got  %r\n     want %r" % (name, got, want))


def test_one_weak_base_does_not_cut_a_good_read():
    quality = [5] * 10 + [40] * 50 + [15] + [40] * 50 + [5] * 10
    check("bridged", driver.trim(quality, 20), (10, 111))


def test_a_long_weak_stretch_still_cuts():
    quality = [40] * 50 + [8] * 30 + [40] * 120
    check("keeps the longer good side", driver.trim(quality, 20), (80, 200))


def test_nothing_above_the_floor_keeps_nothing():
    start, end = driver.trim([10] * 100, 20)
    check("empty", end - start, 0)


def test_a_higher_floor_trims_harder():
    quality = [40] * 20 + [22] * 20 + [40] * 20
    check("Q20 keeps the Q22 stretch", driver.trim(quality, 20), (0, 60))
    check("Q30 drops it", driver.trim(quality, 30), (0, 20))


def abif(entries):
    """A minimal ABIF file: header, then data, then the directory."""
    data, directory = b"", b""
    offset = 34
    blobs = []
    for name, number, payload in entries:
        blobs.append((name, number, payload, offset if len(payload) > 4 else None))
        if len(payload) > 4:
            data += payload
            offset += len(payload)
    dir_offset = offset
    for name, number, payload, where in blobs:
        field = (struct.unpack(">i", payload.ljust(4, b"\0"))[0] if where is None else where)
        directory += struct.pack(">4sihhiiii", name, number, 2, 1, len(payload), len(payload),
                                 field, 0)
    header = b"ABIF" + struct.pack(">h", 101) + struct.pack(
        ">4sihhiiii", b"tdir", 1, 1023, 28, len(blobs), 28 * len(blobs), dir_offset, 0)
    return header + data + directory


def test_the_instrument_quality_is_read_from_pcon_2():
    work = pathlib.Path(tempfile.mkdtemp())
    path = work / "a.ab1"
    path.write_bytes(abif([(b"PBAS", 2, b"ACGTACGT"), (b"PCON", 1, bytes([9] * 8)),
                           (b"PCON", 2, bytes([10, 20, 30, 40, 50, 60, 15, 25]))]))
    check("PCON 2, not PCON 1", driver.instrument_quality(path), [10, 20, 30, 40, 50, 60, 15, 25])

    short = work / "b.ab1"
    short.write_bytes(abif([(b"PCON", 2, bytes([33, 44]))]))
    check("four bytes or fewer sit in the offset field", driver.instrument_quality(short), [33, 44])

    scf = work / "c.scf"
    scf.write_bytes(b".scf" + b"\0" * 100)
    check("SCF has none", driver.instrument_quality(scf), None)


def test_quality_follows_the_base_number():
    work = pathlib.Path(tempfile.mkdtemp())
    table = work / "calls.tsv"
    table.write_text(
        "pos\tpeakA\tpeakC\tpeakG\tpeakT\tbasenum\tprimary\tsecondary\tconsensus\tqual\ttrim\n"
        "1\t0\t0\t0\t0\tNA\tNA\tNA\tNA\tNA\tNA\n"
        "5\t9\t0\t0\t0\t1\tA\tA\tA\t55\tN\n"
        "9\t0\t9\t0\t5\t2\tC\tY\tN\t50\tN\n"
        "12\t0\t0\t9\t0\t3\tG\tG\tG\t60\tN\n")
    bases, qual, mixed = driver.read_calls(table, [12, 7, 33])
    check("bases are Tracy's", bases, "ACG")
    check("quality is the instrument's", [ord(c) - 33 for c in qual], [12, 7, 33])
    check("mixed call kept", mixed, [1])
    _, own, _ = driver.read_calls(table)
    check("without the instrument, Tracy's", [ord(c) - 33 for c in own], [55, 50, 60])


def test_every_kept_read_the_sequence_did_not_use_becomes_a_candidate():
    calls = pathlib.Path(tempfile.mkdtemp())
    for tid in ("t1", "t2"):
        (calls / (tid + ".fastq")).write_text("@x\nACGT\n+\nIIII\n")
    reads = {tid: {"path": tid + ".ab1", "usableLength": 4, "meanQuality": 40.0} for tid in ("t1", "t2")}

    merged = {"id": "s00000", "source": "merged"}
    driver.add_alternatives(merged, {"forward": "t1", "reverse": "t2"}, reads, calls)
    check("both reads", [a["id"] for a in merged["alternatives"]], ["s00000.forward", "s00000.reverse"])
    check("written for ANARCI", (calls / "s00000.forward.fastq").exists(), True)

    fallback = {"id": "s00001", "source": "forward"}
    driver.add_alternatives(fallback, {"forward": "t1", "reverse": "t2"}, reads, calls)
    check("only the other read", [a["source"] for a in fallback["alternatives"]], ["reverse"])

    alone = {"id": "s00002", "source": "forward"}
    driver.add_alternatives(alone, {"forward": "t1"}, reads, calls)
    check("nothing to offer", "alternatives" in alone, False)


for name, fn in sorted(globals().items()):
    if name.startswith("test_"):
        fn()

if FAILURES:
    print("FAILED:\n  " + "\n  ".join(FAILURES))
    sys.exit(1)
print("ok")
