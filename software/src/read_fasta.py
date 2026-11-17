"""Read FASTA or FASTQ records into the shared reads-stage contract.

One record per molecule, from per-file sets or a combined file. A FASTA carries
letters only; an amino-acid FASTA is the protein already (--amino-acid); a FASTQ
carries real Phred and is trimmed by the quality floor (--fastq --floor). A
gzipped file is decompressed by its magic bytes. The output files are named and
shaped like the trace driver's, so the shared annotate -> pair -> collapse ->
emit tail reads them the same way. There is no basecalling and no read merge.

Usage: read_fasta.py <files-dir> <manifest.json> <plan.json> [--fastq] [--amino-acid]
       [--combined] [--floor N]   or   read_fasta.py --headers <dir> <count> [--fastq]
"""

import gzip
import json
import pathlib
import sys

CODONS = {}
_BASES = "TCAG"
_AMINO = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
for _i, _aa in enumerate(_AMINO):
    CODONS[_BASES[_i // 16] + _BASES[_i // 4 % 4] + _BASES[_i % 4]] = _aa

COMPLEMENT = str.maketrans("ACGTNacgtn", "TGCANtgcan")

# A frame shorter than this cannot hold a variable domain, so it is not scanned.
MIN_PROTEIN = 50


def read_file_text(path):
    """A staged file's text, transparently decompressing a gzip member. Sequencing
    reads often arrive gzipped; the magic bytes, not the name, decide."""
    data = path.read_bytes()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return data.decode("utf-8", "replace")


def open_text(path):
    """A line stream over a staged file, decompressing a gzip member on the fly.

    Used where only the headers are needed, so a large combined file is never held
    in memory whole: a gzipped file expands to many times its upload size."""
    with open(path, "rb") as probe:
        gzipped = probe.read(2) == b"\x1f\x8b"
    opener = gzip.open if gzipped else open
    return opener(path, "rt", encoding="utf-8", errors="replace")


def read_records(path):
    """Every record's bases from a FASTA file, in file order, upper-cased and
    with whitespace removed. One file holds one record for a per-file set and
    many for a combined file; the record index picks which one."""
    if not path.exists():
        return []
    records, bases, seen = [], [], False
    for line in read_file_text(path).splitlines():
        if line.startswith(">"):
            if seen:
                records.append("".join(bases).upper())
            bases, seen = [], True
            continue
        bases.append(line.strip())
    if seen:
        records.append("".join(bases).upper())
    return records


def translate(nucleotide):
    return "".join(
        CODONS.get(nucleotide[i:i + 3].upper(), "X")
        for i in range(0, len(nucleotide) - 2, 3)
    )


# A usable stretch shorter than this holds no variable domain, so a read trimmed
# below it is set aside. Matches the trace driver.
MIN_USABLE = 100


def read_fastq_records(path):
    """Every record's (bases, quality) from a FASTQ file, in file order. A record
    is four lines: @header, bases, +, quality. One record per file for a per-file
    set, many for a combined file."""
    if not path.exists():
        return []
    lines = read_file_text(path).splitlines()
    records = []
    for i in range(0, len(lines) - 3, 4):
        if lines[i].startswith("@"):
            records.append((lines[i + 1].strip().upper(), lines[i + 3].strip()))
    return records


def mean_quality(qual):
    return round(sum(ord(c) - 33 for c in qual) / len(qual), 1) if qual else 0.0


def trim(quality, floor):
    """Start and end of the stretch Mott's method keeps at this floor.

    Each base adds (limit - its error probability), with the limit from the floor:
    Q20 gives 0.01. The kept stretch is the one with the largest sum, so a single
    weak base inside a good run costs ~ten good bases rather than cutting the read.
    """
    limit = 10 ** (-floor / 10)
    best = run = 0.0
    best_start = best_end = start = 0
    for i, q in enumerate(quality):
        run += limit - 10 ** (-q / 10)
        if run <= 0:
            run, start = 0.0, i + 1
        elif run > best:
            best, best_start, best_end = run, start, i + 1
    return best_start, best_end


def build(plan, manifest, files, combined=False, amino_acid=False, fastq=False, floor=20):
    """One sequence per plan entry, plus the per-record reads for the Files table
    and the protein FASTA the tail needs.

    A nucleotide record writes `sequences.fasta` and is translated into six frames
    for ANARCI. An amino-acid record is the protein already: it writes no nucleotide
    and goes into `frames.fasta` as one frame, `|0`. A FASTQ record carries real
    Phred: it is trimmed to the stretch at the quality floor, and that stretch's
    mean quality travels with it."""
    sequences, set_aside, reads = [], [], []
    nucleotides, frames = [], []
    cache = {}
    for index, entry in enumerate(plan):
        seq_id = "s%05d" % index
        base = {
            "id": seq_id,
            "plate": entry.get("plate", ""),
            "well": entry.get("well", ""),
            "chain": entry.get("chain", ""),
            "pairKey": entry.get("pairKey", ""),
            "extraReads": entry.get("extra", 0),
        }
        file_id = entry.get("forward") or entry.get("reverse")
        # A per-file set reads record 0; a combined file reads by the record index.
        record_index = entry.get("recordIndex", 0)
        # A combined file holds many records, so each record's read is keyed by file
        # and record index; a per-file set keys by the file path. Built before the
        # set-aside branch so a rejected record carries the same key its Files-table
        # row looks up.
        path = plate = read_path = None
        if file_id is not None and file_id in manifest:
            path = manifest[file_id]["path"]
            plate = manifest[file_id]["plate"]
            read_path = ("%s#%d" % (path, record_index)) if combined else path
        record = None
        if file_id is not None:
            if file_id not in cache:
                cache[file_id] = (read_fastq_records if fastq else read_records)(files / file_id)
            recs = cache[file_id]
            if 0 <= record_index < len(recs) and recs[record_index]:
                record = recs[record_index]

        # A FASTQ record is trimmed by the quality floor; a FASTA record is kept
        # whole. `read_row` carries the per-read quality where the form has it.
        bases, read_row, reason = None, None, "No sequence"
        if record is not None:
            if fastq:
                full, qual = record
                start, end = trim([ord(c) - 33 for c in qual], floor)
                if end - start >= MIN_USABLE:
                    bases = full[start:end]
                    kept = qual[start:end]
                    read_row = {"length": len(qual), "usableLength": end - start,
                                "meanQuality": mean_quality(kept), "qualitySource": "read",
                                "trimmed": (start, len(qual) - end)}
                    sequence_extra = {"length": end - start, "meanQuality": read_row["meanQuality"],
                                      "qualityScale": "read"}
                else:
                    reason = "Trimming at Q%g leaves %d bases, %d needed" % (floor, end - start, MIN_USABLE)
            else:
                bases = record
                read_row = {"length": len(bases), "usableLength": len(bases), "qualitySource": "none"}
                sequence_extra = {"length": len(bases), "qualityScale": "none"}

        if bases is None:
            if read_path is not None:
                set_aside.append({"path": read_path, "plate": plate, "reason": reason})
            sequences.append(dict(base, source="none", reads=[],
                                  reason=reason))
            continue

        sequences.append(dict(base, source="forward", reads=[read_path], **sequence_extra))
        # One read row per record so the Files table shows its length and status.
        reads.append(dict(read_row, id=file_id, path=read_path, plate=plate, kept=True))
        if amino_acid:
            # The record is the protein. ANARCI finds the reading frame by shape,
            # but there is only one: the sequence as it stands, frame 0.
            frames.append(">%s|0\n%s\n" % (seq_id, bases))
            continue
        nucleotides.append(">%s\n%s\n" % (seq_id, bases))
        reverse = bases.translate(COMPLEMENT)[::-1]
        for frame in range(6):
            protein = translate((bases if frame < 3 else reverse)[frame % 3:])
            if len(protein) >= MIN_PROTEIN:
                frames.append(">%s|%d\n%s\n" % (seq_id, frame, protein))
    return sequences, set_aside, reads, nucleotides, frames


def extract_headers(files_dir, count, fastq=False):
    """Only the header ids of each staged file, in file order. Cheap: the
    sequences are not kept. One list per file, so the UI can key records back to
    their file without reading the bytes itself. FASTA headers start with `>`;
    FASTQ headers are every fourth line and start with `@`."""
    files = pathlib.Path(files_dir)
    out = []
    for i in range(int(count)):
        path = files / ("f%05d" % i)
        headers = []
        if path.exists():
            with open_text(path) as handle:
                if fastq:
                    # A FASTQ header is every fourth line; a quality line may also
                    # start with @, so the line number decides, not the first char.
                    for j, line in enumerate(handle):
                        if j % 4 == 0 and line.startswith("@"):
                            body = line[1:].strip()
                            headers.append(body.split()[0] if body else "")
                else:
                    for line in handle:
                        if line.startswith(">"):
                            body = line[1:].strip()
                            headers.append(body.split()[0] if body else "")
        out.append(headers)
    pathlib.Path("headers.json").write_text(json.dumps(out))
    return 0


def main(argv):
    fastq = "--fastq" in argv
    if len(argv) > 1 and argv[1] == "--headers":
        return extract_headers(argv[2], argv[3], fastq)

    files = pathlib.Path(argv[1])
    manifest = json.loads(pathlib.Path(argv[2]).read_text())
    plan = json.loads(pathlib.Path(argv[3]).read_text())
    combined = "--combined" in argv
    amino_acid = "--amino-acid" in argv
    floor = float(argv[argv.index("--floor") + 1]) if "--floor" in argv else 20.0

    sequences, set_aside, reads, nucleotides, frames = build(
        plan, manifest, files, combined, amino_acid, fastq, floor)

    pathlib.Path("sequences.fasta").write_text("".join(nucleotides))
    pathlib.Path("frames.fasta").write_text("".join(frames))
    pathlib.Path("report.json").write_text(json.dumps({
        "reads": sorted(reads, key=lambda r: r["path"]),
        "setAside": sorted(set_aside, key=lambda s: s["path"]),
        "sequences": sequences,
    }, indent=2))
    # No peaks: neither FASTA nor a single FASTQ read carries a second-peak signal.
    pathlib.Path("peaks.json").write_text("{}")
    # The read-quality charts read this table. A FASTA or amino-acid set has no
    # quality, so it stays header-only; a FASTQ set writes one row per read.
    # Keyed by the read path, not the file id: a combined file stages once under
    # one id, so every record would collide on it; the path carries the record index.
    with open("reads.tsv", "w") as handle:
        handle.write("readKey\tplate\tmeanQuality\tusableLength\n")
        if fastq:
            for r in sorted(reads, key=lambda r: r["path"]):
                handle.write("%s\t%s\t%s\t%d\n"
                             % (r["path"], r["plate"], r["meanQuality"], r["usableLength"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
