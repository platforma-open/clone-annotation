---
"@platforma-open/milaboratories.clone-annotation.software": minor
"@platforma-open/milaboratories.clone-annotation.workflow": minor
"@platforma-open/milaboratories.clone-annotation.ui": minor
"@platforma-open/milaboratories.clone-annotation.block": minor
---

Support scFv reads. A read that carries a whole heavy and a whole light domain in one reading frame is split into two chains of one clone, each with its own regions and germline. An scFv run exports its clones with `pl7.app/vdj/pairing: construct`.

The clone table now shows the J gene of each chain by default, in place of the C gene and isotype. The import dialog closes when a set is imported without it.
