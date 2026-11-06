"""Region boundaries from ANARCI numbering."""

import re
from typing import Dict, List, Optional, Tuple

REGIONS = ["FR1", "CDR1", "FR2", "CDR2", "FR3", "CDR3", "FR4"]

# The whole numbered domain, FR1 through FR4. Named the way the V(D)J vocabulary
# names it, so it reads the same as everywhere else in the platform.
WHOLE = "VDJRegion"
FEATURES = [WHOLE] + REGIONS

STATUS_ANNOTATED = "Annotated"
STATUS_FAILED = "Failed"

# Heavy and light draw their boundaries differently under Kabat and Chothia, and
# identically under IMGT. The bucket ANARCI wrote the record to decides which
# column of this table applies.
REGION_RANGES = {
    "imgt": {
        "H": {"FR1": (1, 26), "CDR1": (27, 38), "FR2": (39, 55), "CDR2": (56, 65),
              "FR3": (66, 104), "CDR3": (105, 117), "FR4": (118, 129)},
        "KL": {"FR1": (1, 26), "CDR1": (27, 38), "FR2": (39, 55), "CDR2": (56, 65),
               "FR3": (66, 104), "CDR3": (105, 117), "FR4": (118, 129)},
    },
    "kabat": {
        "H": {"FR1": (1, 30), "CDR1": (31, 35), "FR2": (36, 49), "CDR2": (50, 65),
              "FR3": (66, 94), "CDR3": (95, 102), "FR4": (103, 113)},
        "KL": {"FR1": (1, 23), "CDR1": (24, 34), "FR2": (35, 49), "CDR2": (50, 56),
               "FR3": (57, 88), "CDR3": (89, 97), "FR4": (98, 107)},
    },
    "chothia": {
        "H": {"FR1": (1, 25), "CDR1": (26, 32), "FR2": (33, 52), "CDR2": (53, 55),
              "FR3": (56, 94), "CDR3": (95, 102), "FR4": (103, 113)},
        "KL": {"FR1": (1, 23), "CDR1": (24, 34), "FR2": (35, 49), "CDR2": (50, 56),
               "FR3": (57, 88), "CDR3": (89, 97), "FR4": (98, 107)},
    },
}

SCHEMES = sorted(REGION_RANGES)

# ANARCI writes one CSV per chain class it recognised. T-cell buckets are listed
# so TCR material needs no change here.
BUCKETS = ["H", "KL", "A", "B", "G", "D"]

# Every T-cell bucket numbers like a light chain under Kabat and Chothia.
BUCKET_TABLE = {"H": "H", "KL": "KL", "A": "KL", "B": "KL", "G": "KL", "D": "KL"}


def position_columns(header: List[str]) -> List[str]:
    """ANARCI's CSV carries metadata columns first, then one per position.

    Position columns are the ones whose header starts with a digit: `1`, `2`, `111A`.
    """
    for i, field in enumerate(header):
        if re.match(r"^\d", field):
            return header[i:]
    return []


def position_number(label: str) -> Optional[int]:
    """`111A` -> 111. An insertion code shares the number it follows."""
    m = re.match(r"^(\d+)", label)
    return int(m.group(1)) if m else None


def _is_gap(residue: Optional[str]) -> bool:
    return (residue or "").strip() in {"", "-", "."}


def build_regions(
    labels: List[str],
    residues: List[str],
    ranges: Dict[str, Tuple[int, int]],
    codon=None,
    first_index: int = 0,
) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Amino acids and nucleotides per feature, both ungapped.

    `codon(i)` returns the three bases behind the residue at index `i` of the
    protein ANARCI was given. Each non-gap residue consumes one position,
    counting from `first_index`, which is ANARCI's `seqstart_index`. Deriving
    the nucleotide this way rather than from a second set of boundaries is what
    keeps the two alphabets describing the same stretch.

    Positions outside every range are dropped. Pass no `codon` for amino acids
    alone.
    """
    amino: Dict[str, List[str]] = {f: [] for f in FEATURES}
    bases: Dict[str, List[str]] = {f: [] for f in FEATURES}

    index = first_index
    for label, residue in zip(labels, residues):
        if _is_gap(residue):
            continue
        at = index
        index += 1
        num = position_number(label)
        if num is None:
            continue
        for region in REGIONS:
            start, end = ranges[region]
            if start <= num <= end:
                amino[region].append(residue.strip())
                amino[WHOLE].append(residue.strip())
                if codon is not None:
                    three = codon(at)
                    bases[region].append(three)
                    bases[WHOLE].append(three)
                break

    return (
        {f: "".join(amino[f]) for f in FEATURES},
        {f: "".join(bases[f]) for f in FEATURES},
    )
