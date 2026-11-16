"""Read one nucleotide FASTA record per molecule into the shared reads-stage
contract.

Each staged file holds one record. There is no basecalling, no merge and no
quality: a FASTA carries letters only. The output files are named and shaped
like the trace driver's, so the shared annotate -> pair -> collapse -> emit tail
reads them the same way.

Usage: read_fasta.py <files-dir> <manifest.json> <plan.json>
"""

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


def read_records(path):
    """Every record's bases from a FASTA file, in file order, upper-cased and
    with whitespace removed. One file holds one record for a per-file set and
    many for a combined file; the record index picks which one."""
    if not path.exists():
        return []
    records, bases, seen = [], [], False
    for line in path.read_text().splitlines():
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


def build(plan, manifest, files, combined=False):
    """One sequence per plan entry, plus the per-record reads for the Files table
    and the nucleotide and six-frame protein FASTA records the tail needs."""
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
        bases = None
        if file_id is not None:
            if file_id not in cache:
                cache[file_id] = read_records(files / file_id)
            recs = cache[file_id]
            if 0 <= record_index < len(recs) and recs[record_index]:
                bases = recs[record_index]
        if bases is None:
            if file_id is not None and file_id in manifest:
                set_aside.append({"path": manifest[file_id]["path"],
                                  "plate": manifest[file_id]["plate"],
                                  "reason": "No sequence in the file"})
            sequences.append(dict(base, source="none", reads=[],
                                  reason="No sequence"))
            continue

        path = manifest[file_id]["path"]
        plate = manifest[file_id]["plate"]
        # A combined file holds many records, so each read is keyed by file and
        # record index; a per-file set keys by the file path, as the Files table
        # matches it.
        read_path = ("%s#%d" % (path, record_index)) if combined else path
        sequences.append(dict(base, source="forward", reads=[read_path],
                              length=len(bases), qualityScale="none"))
        # One read row per record so the Files table shows its length and status.
        # No quality: a FASTA carries letters only, so the quality columns hide.
        reads.append({"id": file_id, "path": read_path, "plate": plate,
                      "length": len(bases), "usableLength": len(bases),
                      "kept": True, "qualitySource": "none"})
        nucleotides.append(">%s\n%s\n" % (seq_id, bases))
        reverse = bases.translate(COMPLEMENT)[::-1]
        for frame in range(6):
            protein = translate((bases if frame < 3 else reverse)[frame % 3:])
            if len(protein) >= MIN_PROTEIN:
                frames.append(">%s|%d\n%s\n" % (seq_id, frame, protein))
    return sequences, set_aside, reads, nucleotides, frames


def extract_headers(files_dir, count):
    """Only the `>` header ids of each staged file, in file order. Cheap: the
    sequences are not kept. One list per file, so the UI can key records back to
    their file without reading the bytes itself."""
    files = pathlib.Path(files_dir)
    out = []
    for i in range(int(count)):
        path = files / ("f%05d" % i)
        headers = []
        if path.exists():
            for line in path.read_text().splitlines():
                if line.startswith(">"):
                    body = line[1:].strip()
                    headers.append(body.split()[0] if body else "")
        out.append(headers)
    pathlib.Path("headers.json").write_text(json.dumps(out))
    return 0


def main(argv):
    if len(argv) > 1 and argv[1] == "--headers":
        return extract_headers(argv[2], argv[3])

    files = pathlib.Path(argv[1])
    manifest = json.loads(pathlib.Path(argv[2]).read_text())
    plan = json.loads(pathlib.Path(argv[3]).read_text())
    combined = "--combined" in argv

    sequences, set_aside, reads, nucleotides, frames = build(plan, manifest, files, combined)

    pathlib.Path("sequences.fasta").write_text("".join(nucleotides))
    pathlib.Path("frames.fasta").write_text("".join(frames))
    pathlib.Path("report.json").write_text(json.dumps({
        "reads": sorted(reads, key=lambda r: r["path"]),
        "setAside": sorted(set_aside, key=lambda s: s["path"]),
        "sequences": sequences,
    }, indent=2))
    # No peaks: a FASTA carries no signal. The reads table drives the read
    # quality charts, which are off for a form with no quality, so it is empty.
    pathlib.Path("peaks.json").write_text("{}")
    pathlib.Path("reads.tsv").write_text("readKey\tplate\tmeanQuality\tusableLength\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
