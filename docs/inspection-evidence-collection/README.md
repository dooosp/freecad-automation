# Inspection Evidence Collection Guides

These non-canonical guides help a human collect real physical or supplier
inspection measurements for the canonical example packages. They are not
inspection evidence, and they do not satisfy `inspection_evidence` by
themselves.

- [`quality-pass-bracket`](./quality-pass-bracket.md)
- [`plate-with-holes`](./plate-with-holes.md)
- [`motor-mount`](./motor-mount.md)
- [`controller-housing-eol`](./controller-housing-eol.md)
- [`hinge-block`](./hinge-block.md)

Completed real JSON must be written later under the matching
`docs/examples/<package>/inspection/inspection_evidence.json` target and attached
through `review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>`.

Generated quality, drawing, readiness, review-pack, and synthetic fixture files
must not be used as package inspection evidence. The canonical packages remain
`needs_more_evidence` until genuine inspection evidence is attached and the
selected readiness artifacts are regenerated through the canonical flow.

See [`../inspection-evidence-contract.md`](../inspection-evidence-contract.md)
for the schema and validation contract.
