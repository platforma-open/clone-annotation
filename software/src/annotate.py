"""Join what ANARCI numbered and what MiXCR aligned onto each molecule.

The two run independently. ANARCI finds the reading frame and the chain from the
shape of the sequence, so regions survive with no reference at all; MiXCR adds
the germline, and only when a reference covers the material. A molecule MiXCR
could not place keeps everything ANARCI gave it.

Usage: annotate.py --report report.json --scheme imgt --out annotation.json
                   [--csv_h F] [--csv_kl F] [--csv_a F] [--csv_b F] [--csv_g F]
                   [--csv_d F] [--mixcr F]
"""

import argparse
import csv
import json
import pathlib
import sys

from regions import (
    FEATURES,
    BUCKET_TABLE,
    BUCKETS,
    REGION_RANGES,
    SCHEMES,
    STATUS_ANNOTATED,
    STATUS_FAILED,
    build_regions,
    position_columns,
)

COMPLEMENT = str.maketrans("ACGTNacgtn", "TGCANtgcan")

# What the file name's chain label means, in ANARCI's buckets. Only a label this
# knows is evidence; anything else is a name we cannot read, not a contradiction.
DECLARED_CLASS = {
    "igh": "H", "h": "H", "heavy": "H", "vh": "H", "hc": "H",
    "igl": "KL", "igk": "KL", "l": "KL", "k": "KL", "light": "KL",
    "vl": "KL", "vk": "KL", "lc": "KL",
    "tra": "A", "alpha": "A", "trb": "B", "beta": "B",
    "trg": "G", "gamma": "G", "trd": "D", "delta": "D",
}

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


def pair_up(annotations, declared):
    """Hold a clone's two chains together, and say so when they cannot be.

    `declared` is whether the set states a chain at all. Where it does not, the
    material is already one molecule and nothing is held up waiting for a
    partner it was never going to have (R20).
    """
    # A set that names no chain, or names only one across every file, holds no
    # pairs to make. Calling those clones unpaired would report a whole
    # heavy-only plate as ninety-six failures (R20).
    labels = {e["declaredChain"].strip().lower() for e in annotations}
    labels.discard("")
    if not declared or len(labels) < 2:
        for entry in annotations:
            entry["pairStatus"] = SINGLE_DOMAIN
        return [], []

    groups = {}
    for entry in annotations:
        groups.setdefault(entry.get("pairKey", ""), []).append(entry)

    unpaired, mismatched = [], []
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
                one["pairedWith"] = clone_key(other)
        elif len(candidates) > 1:
            # Two of the same chain, or more than two. Pairing one of them with
            # a neighbour would be a guess.
            for member in candidates:
                member["pairStatus"] = AMBIGUOUS
                unpaired.append(where(member))

    for entry in annotations:
        declared_as = DECLARED_CLASS.get(entry["declaredChain"].strip().lower(), "")
        observed = entry.get("observedChain", "")
        # Only a clear contradiction counts. An unread label on either side is
        # not evidence of anything.
        if declared_as and observed and declared_as != observed:
            entry["chainMismatch"] = True
            mismatched.append("%s (name says %s, sequence says %s)"
                              % (where(entry), entry["declaredChain"], observed))

    return sorted(unpaired), sorted(mismatched)


def where(entry):
    return " ".join(x for x in (entry["plate"], entry["well"], entry["declaredChain"]) if x)


# Read by header name. The preset contributes its own columns first and the
# fields the workflow asks for are appended after them, so a column's position
# is not ours to predict.
MIXCR_FIELDS = {
    "id": "descrsR1",
    "chains": "topChains",
    "vHit": "bestVHit",
    "dHit": "bestDHit",
    "jHit": "bestJHit",
    "vScore": "bestVHitScore",
    "vAlignment": "bestVAlignment",
}


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

    out = {}
    for row in rows[1:]:
        if not row:
            continue
        record = {name: row[i] if i < len(row) else "" for name, i in where.items()}
        # `descrsR1` carries the FASTA header, which is the molecule id.
        key = record["id"].split()
        if key:
            out[key[0]] = record
    return out


def pick_frame(mol_id, by_bucket):
    """The frame and bucket ANARCI numbered best.

    Six frames go in and at most one is a variable domain, so the winner is the
    frame the molecule is actually in. That is the reading frame decided by
    shape rather than by a reference.
    """
    best = None
    for bucket, numbering in by_bucket.items():
        for frame in range(6):
            found = numbering.get("%s|%d" % (mol_id, frame))
            if found is None:
                continue
            if best is None or found[2] > best[3]:
                best = (bucket, frame, found, found[2])
    return best


# A clone is one plate, one well, one chain. The same key the p-frame axis uses.
def clone_key(entry):
    return "|".join([entry["plate"], entry["well"], entry["declaredChain"]])


def write_table(path, annotations, molecules, properties):
    """One row per clone, flat, ready for xsv to turn into p-columns."""
    by_id = {m["id"]: m for m in molecules}
    names = [p["name"] for p in properties]
    header = (
        ["cloneKey", "plate", "well", "chain", "pairStatus", "pairedWith", "chainMismatch",
         "source", "length", "meanQuality", "qualityScale", "mismatches", "extraReads",
         "note", "regionStatus", "observedChain", "frame", "vGene", "dGene", "jGene",
         "mixcrChains", "vAlignment"]
        + ["aa_%s" % f for f in FEATURES]
        + ["nt_%s" % f for f in FEATURES]
        + ["prop_%d" % i for i in range(len(names))]
    )

    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        for entry in annotations:
            molecule = by_id.get(entry["id"], {})
            amino = entry.get("aa", {})
            bases = entry.get("nt", {})
            # The sheet measures a well, so both chains of one well carry it.
            well_key = entry["plate"] + "\u0000" + entry["well"]
            writer.writerow(
                [clone_key(entry), entry["plate"], entry["well"], entry["declaredChain"],
                 entry.get("pairStatus", ""), entry.get("pairedWith", ""),
                 "yes" if entry.get("chainMismatch") else "",
                 molecule.get("source", ""), molecule.get("length", ""),
                 molecule.get("meanQuality", ""), molecule.get("qualityScale", ""),
                 molecule.get("mismatches") if molecule.get("mismatches") is not None else "",
                 molecule.get("extraReads", ""), molecule.get("reason", ""),
                 entry.get("status", ""), entry.get("observedChain", ""),
                 entry.get("frame", ""), entry.get("vGene", ""), entry.get("dGene", ""),
                 entry.get("jGene", ""), entry.get("mixcrChains", ""),
                 entry.get("vAlignment", "")]
                + [amino.get(f, "") for f in FEATURES]
                + [bases.get(f, "") for f in FEATURES]
                + [p["values"].get(well_key, "") for p in properties]
            )


# Which side of the molecule a chain class sits on. For a T-cell receptor the
# heavy side is beta or delta and the light side alpha or gamma; the per-side
# chain column carries whatever the files actually called it.
SIDES = {"H": "heavy", "B": "heavy", "D": "heavy",
         "KL": "light", "A": "light", "G": "light"}

# Mirrored on both sides of a molecule. Identity stays unprefixed.
PER_SIDE = ["chain", "source", "length", "meanQuality", "regionStatus",
            "vGene", "dGene", "jGene"]


def molecule_columns():
    cols = []
    for side in ("heavy", "light"):
        cols += ["%s_%s" % (side, f) for f in PER_SIDE]
        cols += ["%s_aa_%s" % (side, f) for f in FEATURES]
        cols += ["%s_nt_%s" % (side, f) for f in FEATURES]
    return cols


def side_cells(entry, by_id):
    """One side of a molecule, flat: its facts, then every region twice over."""
    m = by_id.get(entry["id"], {}) if entry else {}
    amino = (entry or {}).get("aa", {})
    bases = (entry or {}).get("nt", {})
    cells = [
        (entry or {}).get("declaredChain", ""), m.get("source", ""),
        m.get("length", ""), m.get("meanQuality", ""),
        (entry or {}).get("status", ""), (entry or {}).get("vGene", ""),
        (entry or {}).get("dGene", ""), (entry or {}).get("jGene", ""),
    ]
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


def write_molecules(path, annotations, molecules):
    """One row per molecule: the two chains of a clone, side by side.

    R18 asks for the molecule to be what goes forward rather than its parts.
    A group with only one side still gets a row, with that side filled — the
    other half is missing, which is a fact about the clone, not a reason to
    leave it out.
    """
    by_id = {m["id"]: m for m in molecules}
    header = ["moleculeKey", "plate", "well", "pairStatus"] + molecule_columns()
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
                [unique(key), pairing["plate"], pairing["well"], pairing["status"]]
                + side_cells(pairing["heavy"], by_id) + side_cells(pairing["light"], by_id)
            )


def summarise(values):
    """What a set of numbers can honestly be reduced to.

    R14 says the right summary depends on what was measured, and nothing in the
    data says whether a reading is a titre, a count or a date. So all four are
    carried and the scientist sorts on the one that fits; the maximum is the one
    shown, because a well that read low has usually failed rather than measured.
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


def variant_columns(properties):
    cols = ["wells", "wellCount", "pairStatus"] + molecule_columns()
    for i in range(len(properties)):
        cols += ["prop_%d_values" % i, "prop_%d_disagrees" % i]
        cols += ["prop_%d_%s" % (i, s) for s in ("min", "median", "max", "mean")]
    return cols


def write_abundance(path, annotations):
    """Wells per plate, per variant: the long shape an abundance column needs.

    The sample is the plate, so a variant seen on two plates carries a count
    for each rather than one total.
    """
    groups = {}
    for pairing in candidate_pairings(annotations):
        key = variant_key_of(pairing)
        if key is None:
            continue
        groups.setdefault(key, []).append(pairing)

    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["sampleId", "variantKey", "wellCount"])
        for n, members in enumerate(sorted(groups.values(), key=lambda g: -len(g)), start=1):
            per_plate = {}
            for m in members:
                per_plate[m["plate"]] = per_plate.get(m["plate"], 0) + 1
            for plate in sorted(per_plate):
                writer.writerow([plate or "set", "v%05d" % n, per_plate[plate]])


def variant_key_of(pairing):
    """Exact identity: the nucleotide of both chains, letter for letter."""
    key = "\u0000".join([
        ((pairing["heavy"] or {}).get("nt", {}) or {}).get("VDJRegion", ""),
        ((pairing["light"] or {}).get("nt", {}) or {}).get("VDJRegion", ""),
    ])
    return None if key == "\u0000" else key


def write_variants(path, annotations, molecules, properties, counts=None):
    """One row per distinct molecule, with every well it was seen in.

    Identity is the nucleotide of both chains, letter for letter, and nothing
    looser (R17). After collapse a molecule is not in a well; it was observed
    in several, so the wells travel with it and so does everything measured on
    each of them (R12).
    """
    by_id = {m["id"]: m for m in molecules}
    groups = {}
    for pairing in candidate_pairings(annotations):
        key = variant_key_of(pairing)
        if key is None:
            continue
        groups.setdefault(key, []).append(pairing)

    header = ["variantKey"] + variant_columns(properties)
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        if counts is not None:
            counts["moleculesIn"] = sum(len(g) for g in groups.values())
            counts["variantsOut"] = len(groups)
        for n, members in enumerate(sorted(groups.values(),
                                           key=lambda g: -len(g)), start=1):
            first = members[0]
            wells = [" ".join(x for x in (m["plate"], m["well"]) if x) for m in members]
            row = ["v%05d" % n, ", ".join(wells), len(members), first["status"]]
            row += side_cells(first["heavy"], by_id) + side_cells(first["light"], by_id)

            for i, prop in enumerate(properties):
                seen = []
                for m in members:
                    v = prop["values"].get(m["plate"] + "\u0000" + m["well"])
                    if v is not None and v != "":
                        seen.append(v)
                # R15: six wells reading differently is a result in itself, and
                # one summarised number hides it. A molecule whose wells agree
                # carries no mark.
                disagrees = "yes" if len(set(seen)) > 1 else ""
                summary = summarise(seen)
                row += [", ".join(seen), disagrees]
                row += [summary[s] if summary else "" for s in ("min", "median", "max", "mean")]
            writer.writerow(row)


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--report", required=True, help="The trace report, for the molecule list")
    p.add_argument("--molecules", required=False, help="Molecule nucleotide FASTA")
    p.add_argument("--scheme", required=True, choices=SCHEMES)
    p.add_argument("--mixcr", required=False, help="MiXCR exportAlignments TSV")
    p.add_argument("--out", required=True)
    p.add_argument("--out_tsv", required=False, help="One row per clone, for the p-frame")
    p.add_argument("--out_molecules_tsv", required=False,
                   help="One row per molecule, the two chains side by side")
    p.add_argument("--out_variants_tsv", required=False,
                   help="One row per distinct molecule, with the wells behind it")
    p.add_argument("--out_abundance_tsv", required=False,
                   help="Wells per plate, per variant")
    p.add_argument("--properties", required=False, help="Mapped sheet columns, as JSON")
    p.add_argument("--chains-declared", action="store_true",
                   help="The set states which chain each file holds, so pairing applies")
    for bucket in BUCKETS:
        p.add_argument("--csv_%s" % bucket.lower(), required=False)
    args = p.parse_args(argv)

    molecules = json.loads(pathlib.Path(args.report).read_text())["molecules"]
    by_bucket = {b: read_anarci(getattr(args, "csv_%s" % b.lower())) for b in BUCKETS}
    aligned = read_mixcr(args.mixcr)
    nucleotides = read_fasta(args.molecules)

    annotations, not_numbered, not_aligned = [], [], []
    for molecule in molecules:
        mol_id = molecule["id"]
        where = "%s %s %s" % (molecule["plate"], molecule["well"], molecule["chain"])
        entry = {
            "id": mol_id,
            "plate": molecule["plate"],
            "well": molecule["well"],
            "declaredChain": molecule["chain"],
            "pairKey": molecule.get("pairKey", ""),
        }

        best = pick_frame(mol_id, by_bucket)
        if best is None:
            entry["status"] = STATUS_FAILED
            # Only a molecule that had a sequence can fail to be numbered. One
            # that never had a read is already accounted for upstream.
            if molecule.get("source") != "none":
                not_numbered.append(where.strip())
        else:
            bucket, frame, (labels, residues, _, start), _ = best
            entry["frame"] = frame
            entry["observedChain"] = bucket
            nucleotide = nucleotides.get(mol_id)
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
            entry["status"] = STATUS_ANNOTATED if any(amino.values()) else STATUS_FAILED

        hit = aligned.get(mol_id)
        if hit is not None:
            # MiXCR writes "-" where it found no hit. An absent gene is absent,
            # not a gene called "-".
            for field, name in (("vHit", "vGene"), ("dHit", "dGene"),
                                ("jHit", "jGene"), ("chains", "mixcrChains"),
                                ("vAlignment", "vAlignment")):
                value = hit.get(field, "")
                if value not in ("", "-"):
                    entry[name] = value
        elif args.mixcr and molecule.get("source") != "none":
            # R31: no germline is not a failed annotation. The molecule keeps its
            # regions, its chain and its translation.
            not_aligned.append(where.strip())

        annotations.append(entry)

    unpaired, mismatched = pair_up(annotations, args.chains_declared)

    properties = (
        json.loads(pathlib.Path(args.properties).read_text()) if args.properties else []
    )
    if args.out_tsv:
        write_table(args.out_tsv, annotations, molecules, properties)
    if args.out_molecules_tsv:
        write_molecules(args.out_molecules_tsv, annotations, molecules)
    collapse = {}
    if args.out_variants_tsv:
        write_variants(args.out_variants_tsv, annotations, molecules, properties, collapse)
    if args.out_abundance_tsv:
        write_abundance(args.out_abundance_tsv, annotations)

    pathlib.Path(args.out).write_text(
        json.dumps(
            {
                "scheme": args.scheme,
                "annotations": annotations,
                "notNumbered": not_numbered,
                "notAligned": not_aligned,
                "unpaired": unpaired,
                "chainMismatch": mismatched,
                "collapse": collapse,
            },
            indent=2,
        )
    )
    print(
        "%d clones, %d numbered, %d aligned"
        % (
            len(annotations),
            sum(1 for a in annotations if a["status"] == STATUS_ANNOTATED),
            len(aligned),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
